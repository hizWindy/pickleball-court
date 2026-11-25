"""Guests moving their own booking.

Bookings can't be cancelled. A paid booking moves in two ways:

* the host calls a rebooking for bad weather (`weather_hold_at`): always allowed, free, any time. This is the only way
  unless `GUEST_RESCHEDULE=1` (the default is off: the host is the one watching the weather);
* with `GUEST_RESCHEDULE=1` only, a guest's own move:
* once per booking, at least `reschedule_min_hours` (48) before the start;
* same length; the new date within `reschedule_window_days` (30) of the original one;
* a slot that costs more than the booking already paid is refused (the host can handle those by hand),
  one that costs less is allowed and the difference is not refunded;
* a rain delay called by the host (`weather_hold_at`) is always allowed and doesn't use up the one reschedule;
* proof of ownership is the booking code plus the mobile number on it, or this device's booking token.

The move happens in one transaction: the old hours are given up and the new ones taken, or nothing changes.
A two-court booking moves as one: both courts to the new time (the court choice is for one-court bookings), or neither.
"""

from __future__ import annotations

import hmac
import sqlite3
from datetime import timedelta

from app import booking_service as core
from app import clock
from app.clock import from_iso, to_iso
from app.config import settings
from app.db import write_transaction
from app.errors import BookingError, Conflict, NotFound
from app.schemas import BookingOut, RescheduleIn, RescheduleLookupIn, RescheduleLookupOut
from app.slots import current_play_date, play_date_of, price_hours, slot_start

_NOT_FOUND = "We couldn't find a booking with that code and mobile number."
_TAKEN_BOTH = "{court} at {time} is taken, so neither court was moved. Please choose another time."


def _owned(conn: sqlite3.Connection, data: RescheduleLookupIn, token: str | None) -> sqlite3.Row:
    """The booking, if the caller can prove it is theirs. One answer for every way of being wrong. For two courts, the
    lead row, whichever court's code was given: the player knows the booking by one code."""
    if token:
        try:
            return core.lead_row(conn, core.authorized(conn, data.code, token))
        except NotFound:
            pass  # a stale token on this device: fall back to the mobile number
    if data.customer_phone:
        row = conn.execute("SELECT * FROM bookings WHERE code = ?", (core.normalize_code(data.code),)).fetchone()
        if row is not None and row["customer_phone"] and hmac.compare_digest(row["customer_phone"], data.customer_phone):
            return core.lead_row(conn, row)
    raise NotFound("not_found", _NOT_FOUND)


def _date_range(row: sqlite3.Row, now) -> tuple:
    today = current_play_date(now)
    original = play_date_of(from_iso(row["start_at"]))
    earliest = max(today, original - timedelta(days=settings.reschedule_window_days))
    latest = min(today + timedelta(days=settings.booking_window_days), original + timedelta(days=settings.reschedule_window_days))
    return earliest, latest


def lookup(conn: sqlite3.Connection, data: RescheduleLookupIn, token: str | None) -> RescheduleLookupOut:
    now = clock.now()
    with write_transaction(conn):
        core.release_expired(conn, now)
        row = _owned(conn, data, token)
        issued = token if token and _token_matches(conn, row, token) else core._issue_token(conn, row["id"], now)
    earliest, latest = _date_range(row, now)
    return RescheduleLookupOut(
        booking=core.to_view(conn, row, now), access_token=issued, earliest_date=earliest, latest_date=max(earliest, latest)
    )


def _token_matches(conn: sqlite3.Connection, row: sqlite3.Row, token: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM booking_access WHERE booking_id = ? AND token_hash = ?", (row["id"], core._hash_token(token))
    ).fetchone() is not None


def reschedule(conn: sqlite3.Connection, data: RescheduleIn, token: str | None) -> BookingOut:
    now = clock.now()
    with write_transaction(conn):
        core.release_expired(conn, now)
        row = _owned(conn, data, token)
        # The courts that move: every court of the booking still on (the host may have ended one on its own)
        rows = core.current_rows(core.group_rows(conn, row))
        rows = core.lead_first(rows, next((r for r in rows if r["id"] == row["id"]), rows[0]))
        state = core.booking_reschedule_state(rows, now)
        if state == "used":
            raise Conflict("reschedule_used", "This booking was already rescheduled once. Please message the host.")
        if state == "too_late":
            raise Conflict(
                "reschedule_too_late",
                f"Rescheduling closes {settings.reschedule_min_hours} hours before your start time. "
                "Please message the host; exceptions are at the host's discretion.",
            )
        if state == "unavailable":
            raise Conflict("reschedule_unavailable", "This booking can't be rescheduled online. Please message the host.")

        both = len(rows) > 1
        moves = []  # (row, court it goes to)
        for r in rows:
            court_id = data.court_id if data.court_id and not both else r["court_id"]  # two courts keep their courts
            court = conn.execute("SELECT * FROM courts WHERE id = ? AND active = 1", (court_id,)).fetchone()
            if court is None:
                raise BookingError("court_invalid", "That court isn't available.")
            moves.append((r, court))

        earliest, latest = _date_range(row, now)
        if latest < earliest or not earliest <= data.date <= latest:
            raise BookingError(
                "reschedule_date_out_of_range",
                f"Pick a date within {settings.reschedule_window_days} days of your original date (up to {settings.booking_window_days} days from today).",
            )
        start = slot_start(data.date, data.hour)
        if start <= now:
            raise Conflict("slot_past", "That time has already started. Please pick a later slot.")
        weather = any(r["weather_hold_at"] for r in rows)
        if all((c["id"], to_iso(start)) == (r["court_id"], r["start_at"]) for r, c in moves) and not weather:
            raise BookingError("same_slot", "That's the time you already have. Pick a different one.")

        priced = [(r, c, price_hours(start, r["hours"], c["day_rate"], c["night_rate"])) for r, c in moves]
        new_cost = sum(i.rate for _, _, items in priced for i in items)
        paid = sum(r["court_cost"] for r in rows)
        if new_cost > paid:
            raise BookingError(
                "costs_more",
                f"That time costs ₱{new_cost - paid:,} more than your booking. "
                "Pick a time at the same or a lower rate, or message the host.",
            )

        # The old hours go and the new ones are taken in one step (a rain-delayed booking keeps its old hours until now,
        # unless the host opened them already: then there are none to give back, and that's fine). All the old hours go
        # first, so a booking can move onto hours it held itself.
        for r in rows:
            core.release_slots(conn, r["id"])
        for r, court, items in priced:
            # a clash rolls the whole move back
            core.claim_slots(conn, court["name"], court["id"], items, r["id"], taken=_TAKEN_BOTH if both else core.TAKEN)
            conn.execute(
                """UPDATE bookings SET court_id = ?, start_at = ?, reschedule_count = reschedule_count + ?,
                       weather_hold_at = NULL, late_at = NULL, released_at = NULL, arrived_at = NULL WHERE id = ?""",
                (court["id"], to_iso(start), 0 if weather else 1, r["id"]),
            )
            own = sum(i.rate for i in items)
            kept = f" (kept ₱{r['court_cost']:,} paid; the new slot costs ₱{own:,})" if own < r["court_cost"] else ""
            core.record_event(
                conn, r["code"], "rain_rescheduled" if weather else "guest_rescheduled",
                f"{_label(conn, r['court_id'], r['start_at'])} → {court['name']} · {_stamp(to_iso(start))}{kept}", now,
            )
        row = conn.execute("SELECT * FROM bookings WHERE id = ?", (row["id"],)).fetchone()
    return core.to_view(conn, row, now)


def _stamp(iso: str) -> str:
    local = from_iso(iso).astimezone(clock.MANILA)
    return local.strftime("%b %d, %I:%M %p").replace(" 0", " ")


def _label(conn: sqlite3.Connection, court_id: str, start_iso: str) -> str:
    court = conn.execute("SELECT name FROM courts WHERE id = ?", (court_id,)).fetchone()
    return f"{court['name'] if court else court_id} · {_stamp(start_iso)}"
