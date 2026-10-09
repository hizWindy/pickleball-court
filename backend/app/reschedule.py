"""Guests moving their own booking.

Bookings can't be cancelled, so rescheduling is the one flexibility a paid booking has:

* once per booking, at least `reschedule_min_hours` (48) before the start;
* same length; the new date within `reschedule_window_days` (30) of the original one;
* a slot that costs more than the booking already paid is refused (the host can handle those by hand),
  one that costs less is allowed and the difference is not refunded;
* a rain delay called by the host (`weather_hold_at`) is always allowed and doesn't use up the one reschedule;
* proof of ownership is the booking code plus the mobile number on it, or this device's booking token.

The move happens in one transaction: the old hours are given up and the new ones taken, or nothing changes.
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


def _owned(conn: sqlite3.Connection, data: RescheduleLookupIn, token: str | None) -> sqlite3.Row:
    """The booking, if the caller can prove it is theirs. One answer for every way of being wrong."""
    if token:
        try:
            return core.authorized(conn, data.code, token)
        except NotFound:
            pass  # a stale token on this device: fall back to the mobile number
    if data.customer_phone:
        row = conn.execute("SELECT * FROM bookings WHERE code = ?", (core.normalize_code(data.code),)).fetchone()
        if row is not None and row["customer_phone"] and hmac.compare_digest(row["customer_phone"], data.customer_phone):
            return row
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
        state = core.reschedule_state(row, now)
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

        court_id = data.court_id or row["court_id"]
        court = conn.execute("SELECT * FROM courts WHERE id = ? AND active = 1", (court_id,)).fetchone()
        if court is None:
            raise BookingError("court_invalid", "That court isn't available.")

        earliest, latest = _date_range(row, now)
        if latest < earliest or not earliest <= data.date <= latest:
            raise BookingError(
                "reschedule_date_out_of_range",
                f"Pick a date within {settings.reschedule_window_days} days of your original date (up to {settings.booking_window_days} days from today).",
            )
        start = slot_start(data.date, data.hour)
        if start <= now:
            raise Conflict("slot_past", "That time has already started. Please pick a later slot.")
        if (court["id"], to_iso(start)) == (row["court_id"], row["start_at"]) and not row["weather_hold_at"]:
            raise BookingError("same_slot", "That's the time you already have. Pick a different one.")

        items = price_hours(start, row["hours"], court["day_rate"], court["night_rate"])
        new_cost = sum(i.rate for i in items)
        if new_cost > row["court_cost"]:
            raise BookingError(
                "costs_more",
                f"That time costs ₱{new_cost - row['court_cost']:,} more than your booking. "
                "Pick a time at the same or a lower rate, or message the host.",
            )

        old = (row["court_id"], row["start_at"])
        core.release_slots(conn, row["id"])  # a rain-delayed booking has none: that's fine
        core.claim_slots(conn, court["name"], court["id"], items, row["id"])  # a clash rolls the whole move back
        weather = bool(row["weather_hold_at"])
        conn.execute(
            """UPDATE bookings SET court_id = ?, start_at = ?, reschedule_count = reschedule_count + ?,
                   weather_hold_at = NULL, late_at = NULL, arrived_at = NULL WHERE id = ?""",
            (court["id"], to_iso(start), 0 if weather else 1, row["id"]),
        )
        kept = f" (kept ₱{row['court_cost']:,} paid; the new slot costs ₱{new_cost:,})" if new_cost < row["court_cost"] else ""
        core.record_event(
            conn, row["code"], "rain_rescheduled" if weather else "guest_rescheduled",
            f"{_label(conn, old[0], old[1])} → {court['name']} · {_stamp(to_iso(start))}{kept}", now,
        )
        row = conn.execute("SELECT * FROM bookings WHERE id = ?", (row["id"],)).fetchone()
    return core.to_view(conn, row, now)


def _stamp(iso: str) -> str:
    local = from_iso(iso).astimezone(clock.MANILA)
    return local.strftime("%b %d, %I:%M %p").replace(" 0", " ")


def _label(conn: sqlite3.Connection, court_id: str, start_iso: str) -> str:
    court = conn.execute("SELECT name FROM courts WHERE id = ?", (court_id,)).fetchone()
    return f"{court['name'] if court else court_id} · {_stamp(start_iso)}"
