"""Booking rules.

Lifecycle:

    held ──(receipt or reference)──▶ confirmed ──(host spots a problem)──▶ rejected
     │                                    │
     │                       (group not there 15 min after the start: still `confirmed`, `late_at` is set and it
     │                        keeps its hours until the host decides: Arrived, or Release court (`released_at`).)
     ├─(hold runs out)──▶ expired ──(paid within LATE_PAYMENT_MINUTES, hours still free)──▶ confirmed
     │                       └─(paid then, but someone else has the hours: stays expired, `paid_late_at`, for the host)
     └─(player or host releases an unpaid hold)──▶ deleted: an unpaid hold that was let go leaves no record

* There is no cancellation of a paid booking. The only way out is to reschedule (see `reschedule.py`).
* Payment proof confirms the booking straight away: paid is Paid, and the host checks every payment in the
  GCash / GoTyme app anyway. By default (`PROOF_MODE=reference`) the player types the reference number and the
  sender's name; the host sees the window the payment fell in (booking made .. proof sent). With
  `PROOF_MODE=receipt` a receipt image is uploaded and read on the server (amount, reference, date, sender);
  whatever doesn't fit the booking is kept as notes for the host. The same payment (image or reference
  number) can never confirm two bookings. (`pending_verification` is no longer used.)

* A booking occupies one `booking_slots` row per court-hour from the moment it
  is held. The table's primary key makes double booking impossible.
* The hold deadline lives in the database; clients only display a countdown to it.
* Expired holds and late bookings are released lazily on every request and by a background sweep.

Two courts at once (plan item 11): each court is its own row, as at the desk (Schedule, Arrived, Late, rain delay and
the per-court figures work as for any booking), and the rows share a `group_id`: the id of the first court's row, the
"lead". The player sees one booking under the lead's code and pays once for all of it; the payment (reference or
receipt) is stored on the lead row only, so one payment still backs one booking. The rows are created together or not
at all, share one timer, and expire, are paid and are let go together. The host can still end one court on its own.
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import time
import sqlite3
import uuid
from datetime import date, datetime, timedelta

from app import clock, ocr, ratelimit, receipt_reader, receipts
from app.clock import MANILA, from_iso, to_iso
from app.config import settings
from app.db import write_transaction
from app.errors import BookingError, Conflict, Gone, NotFound, TooMany
from app.schemas import (
    AvailabilityOut,
    BookingCourtOut,
    BookingOut,
    ConfigOut,
    CourtOut,
    CreateBookingIn,
    LineItemOut,
    PaymentAccountOut,
    ReferenceProofIn,
    SlotOut,
)
from app.slots import PLAY_DAY_HOURS, current_play_date, is_night_hour, period_for_hour, play_date_of, price_hours, slot_start
from app.validation import REFERENCE_REJECTED, ReferenceRejected, clean_reference, mask_phone, normalize_reference

log = logging.getLogger("housepickle")

ACTIVE_STATUSES = ("held", "pending_verification", "confirmed")
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"  # no 0/O, 1/I/L, U

# Which bookings own their court-hours right now: an unpaid hold that is still running and a paid booking, Late and
# rain-delayed ones included, until the host gives the hours back (`released_at`). `booking_slots` must hold exactly
# these bookings' hours; the scripted-day test and the load test check that from the bookings themselves. Keep the two
# versions in step.
HOLDS_COURT_SQL = "(status IN ('held', 'pending_verification', 'confirmed') AND released_at IS NULL)"


def holds_court(row: sqlite3.Row | dict) -> bool:
    """`HOLDS_COURT_SQL` for one booking row."""
    return row["status"] in ACTIVE_STATUSES and not row["released_at"]


# ── Two courts at once ────────────────────────────────────────────────────────
# What only the lead row stores: the payment itself. The unique indexes on these keep one payment to one booking.
PAYMENT_FIELDS = ("reference_number", "receipt_path", "receipt_sha256")


def group_rows(conn: sqlite3.Connection, row: sqlite3.Row) -> list[sqlite3.Row]:
    """Every court of the booking this row belongs to, in court order: just the row itself for a one-court booking."""
    if not row["group_id"]:
        return [row]
    return conn.execute(
        """SELECT b.* FROM bookings b JOIN courts c ON c.id = b.court_id
           WHERE b.group_id = ? ORDER BY c.sort_order, b.court_id""",
        (row["group_id"],),
    ).fetchall()


def lead_row(conn: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row:
    """The row a booking is known by: for two courts, the first court's (its code is the one the player has, and the
    payment is stored on it). The row itself for a one-court booking, or when the host has deleted the lead."""
    if not row["group_id"] or row["group_id"] == row["id"]:
        return row
    return conn.execute("SELECT * FROM bookings WHERE id = ?", (row["group_id"],)).fetchone() or row


def lead_first(rows: list[sqlite3.Row], lead: sqlite3.Row) -> list[sqlite3.Row]:
    return sorted(rows, key=lambda r: r["id"] != lead["id"])  # stable: the others keep their court order


def same_state(conn: sqlite3.Connection, lead: sqlite3.Row) -> list[sqlite3.Row]:
    """The lead and every other court of its booking in the same state (all held, all expired...), lead first: the rows
    one payment or one "let go" acts on. Courts the host ended on their own are left alone."""
    return lead_first([r for r in group_rows(conn, lead) if r["status"] == lead["status"]], lead)


def current_rows(rows: list[sqlite3.Row]) -> list[sqlite3.Row]:
    """The courts a booking stands for now: those still on (held or paid), or all of them when none is."""
    return [r for r in rows if r["status"] in ACTIVE_STATUSES] or list(rows)


# ── Helpers ───────────────────────────────────────────────────────────────────
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_code(conn: sqlite3.Connection) -> str:
    for _ in range(10):
        raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
        code = f"HPC-{raw[:4]}-{raw[4:]}"
        if not conn.execute("SELECT 1 FROM bookings WHERE code = ?", (code,)).fetchone():
            return code
    raise RuntimeError("could not allocate a unique booking code")


def _issue_token(conn: sqlite3.Connection, booking_id: str, now: datetime) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO booking_access (token_hash, booking_id, created_at) VALUES (?, ?, ?)",
        (_hash_token(token), booking_id, to_iso(now)),
    )
    return token


def normalize_code(code: str) -> str:
    c = code.strip().upper().replace(" ", "")
    if not c.startswith("HPC-") and len(c.replace("-", "")) == 8:
        raw = c.replace("-", "")
        c = f"HPC-{raw[:4]}-{raw[4:]}"
    return c


def _courts(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM courts WHERE active = 1 ORDER BY sort_order").fetchall()


def release_slots(conn: sqlite3.Connection, booking_id: str) -> None:
    conn.execute("DELETE FROM booking_slots WHERE booking_id = ?", (booking_id,))


def record_event(conn: sqlite3.Connection, code: str, action: str, detail: str | None, now: datetime) -> None:
    """What happened to a booking, for the host's timeline. Rows outlive the booking they refer to."""
    conn.execute(
        "INSERT INTO admin_events (booking_code, action, detail, created_at) VALUES (?, ?, ?, ?)",
        (code, action, detail, to_iso(now)),
    )


def release_expired(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Free the slots of unpaid holds past their deadline, and mark the groups that haven't shown up in time as Late.
    Returns the number of holds expired. Must run inside a write transaction."""
    now = now or clock.now()
    cutoff = to_iso(now - timedelta(seconds=settings.hold_grace_seconds))
    # The courts of a two-court booking share one timer: when one runs out, they all do.
    rows = conn.execute(
        """SELECT id FROM bookings WHERE status = 'held' AND (hold_expires_at <= ? OR group_id IN (
               SELECT group_id FROM bookings WHERE status = 'held' AND group_id IS NOT NULL AND hold_expires_at <= ?))""",
        (cutoff, cutoff),
    ).fetchall()
    for row in rows:
        conn.execute(
            "UPDATE bookings SET status = 'expired', closed_at = ?, close_reason = 'hold_timeout', client_ip = NULL WHERE id = ?",
            (to_iso(now), row["id"]),
        )
        release_slots(conn, row["id"])
    mark_late(conn, now)
    return len(rows)


def sweep_if_due(conn: sqlite3.Connection, now: datetime | None = None) -> None:
    """For read-only requests: free what is overdue, but look first. Taking the database's write lock on every
    read (the desk asks every few seconds) made reads queue behind real writes such as a payment upload; now the
    lock is only taken when a hold has run out or a group has gone Late."""
    now = now or clock.now()
    due = conn.execute(
        """SELECT 1 FROM bookings WHERE
               (status = 'held' AND hold_expires_at <= ?)
            OR (status = 'confirmed' AND source != 'blocked' AND arrived_at IS NULL AND late_at IS NULL
                AND weather_hold_at IS NULL AND start_at <= ?)
           LIMIT 1""",
        (
            to_iso(now - timedelta(seconds=settings.hold_grace_seconds)),
            to_iso(now - timedelta(minutes=settings.late_after_minutes)),
        ),
    ).fetchone()
    if due:
        with write_transaction(conn):
            release_expired(conn, now)


def mark_late(conn: sqlite3.Connection, now: datetime) -> int:
    """House rule: a group that isn't there `late_after_minutes` after its start is Late.

    The booking stays `confirmed` (it was paid, and nothing is refunded) and keeps its hours: the host decides, with
    Arrived (they're here after all: no longer Late) or Release court (the hours go to others). Giving the hours away
    by itself let two groups end up on one court when the busy host hadn't tapped Arrived (plan D1); an idle court
    costs less. `late_at` records when it went late. Blocks, rain-delayed bookings and groups the host has marked
    arrived are never late."""
    cutoff = to_iso(now - timedelta(minutes=settings.late_after_minutes))
    rows = conn.execute(
        """SELECT id, code, start_at FROM bookings
           WHERE status = 'confirmed' AND source != 'blocked' AND arrived_at IS NULL
             AND late_at IS NULL AND weather_hold_at IS NULL AND start_at <= ?""",
        (cutoff,),
    ).fetchall()
    for row in rows:
        # The moment it became late, not the moment we noticed.
        late_at = from_iso(row["start_at"]) + timedelta(minutes=settings.late_after_minutes)
        conn.execute("UPDATE bookings SET late_at = ? WHERE id = ?", (to_iso(late_at), row["id"]))
        record_event(
            conn, row["code"], "went_late",
            f"Not there {settings.late_after_minutes} min after the start; the court is held until you decide", now,
        )
        log.info("booking %s went late", row["code"])
    return len(rows)


def sweep(conn: sqlite3.Connection) -> int:
    with write_transaction(conn):
        return release_expired(conn)


TAKEN = "{court} at {time} was just taken. Please choose another time or court."
# A clash on either court of a two-court booking rolls back the whole write: the player is told which court and hour.
TAKEN_BOTH = "{court} at {time} was just taken, so neither court was booked. Please choose another time, or book one court."


def claim_slots(
    conn: sqlite3.Connection, court_name: str, court_id: str, items: list, booking_id: str, *, taken: str = TAKEN
) -> None:
    """Take one `booking_slots` row per hour. The primary key turns a clash into a clean Conflict (worded by `taken`),
    which rolls back the whole write."""
    for item in items:
        try:
            conn.execute(
                "INSERT INTO booking_slots (court_id, slot_start, booking_id) VALUES (?, ?, ?)",
                (court_id, to_iso(item.start), booking_id),
            )
        except sqlite3.IntegrityError:
            label = item.start.astimezone(MANILA).strftime("%I:%M %p").lstrip("0")
            raise Conflict("slot_taken", taken.format(court=court_name, time=label)) from None


def purge_old_receipts(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Delete receipt images once they are no longer needed: a few days after the host decided on the
    payment, or after a hard cap if nobody ever reviewed it. The sha256 stays so a receipt can't be reused."""
    now = now or clock.now()
    decided_cutoff = to_iso(now - timedelta(days=settings.receipt_keep_after_decision_days))
    hard_cutoff = to_iso(now - timedelta(days=settings.receipt_retention_days))
    with write_transaction(conn):
        rows = conn.execute(
            """SELECT id, receipt_path FROM bookings
               WHERE receipt_path IS NOT NULL
                 AND (COALESCE(decided_at, closed_at) <= ? OR submitted_at <= ?)""",
            (decided_cutoff, hard_cutoff),
        ).fetchall()
        for row in rows:
            conn.execute("UPDATE bookings SET receipt_path = NULL WHERE id = ?", (row["id"],))
            conn.execute("UPDATE receipt_scans SET raw_text = NULL WHERE booking_id = ?", (row["id"],))
    for row in rows:
        receipts.delete(row["receipt_path"])
    return len(rows)


def reschedule_state(row: sqlite3.Row, now: datetime) -> str:
    """Can the guest move this booking? `weather` (the host called a rebooking for bad weather: always possible) or,
    only when GUEST_RESCHEDULE is on, `open` (once, 48 h ahead), `used` and `too_late`. Otherwise `unavailable`:
    not a paid, upcoming booking, or nobody has called a weather rebooking for it."""
    if row["status"] != "confirmed" or row["source"] == "blocked":
        return "unavailable"
    if row["weather_hold_at"]:
        return "weather"
    if row["late_at"] or row["arrived_at"]:
        return "unavailable"
    start = from_iso(row["start_at"])
    if start <= now:
        return "unavailable"
    if not settings.guest_reschedule:
        return "unavailable"  # a booking moves only when the host calls a weather rebooking (handled above)
    if row["reschedule_count"] >= 1:
        return "used"
    if start - now < timedelta(hours=settings.reschedule_min_hours):
        return "too_late"
    return "open"


def booking_reschedule_state(rows: list[sqlite3.Row], now: datetime) -> str:
    """`reschedule_state` for a whole booking (its courts still on, the one it is shown by first). A rain delay on any of
    its courts lets the guest move it, and a move takes all of its courts along."""
    states = [reschedule_state(r, now) for r in rows]
    return "weather" if "weather" in states else states[0]


def _pending_info(conn: sqlite3.Connection, row: sqlite3.Row) -> tuple[str | None, float | None]:
    """Why a payment is waiting for the host, and the amount the receipt showed."""
    if row["status"] != "pending_verification":
        return None, None
    try:
        codes = {f.get("code") for f in json.loads(row["review_flags"] or "[]")}
    except (ValueError, TypeError, AttributeError):
        codes = set()
    scan = conn.execute("SELECT amount_centavos FROM receipt_scans WHERE booking_id = ?", (row["id"],)).fetchone()
    amount = scan["amount_centavos"] / 100 if scan and scan["amount_centavos"] is not None else None
    if "amount_short" in codes:
        return "amount_short", amount
    if "no_text" in codes or "amount_missing" in codes:
        return "amount_unreadable", amount
    return None, amount


def _is_late(row: sqlite3.Row) -> bool:
    return row["status"] == "confirmed" and bool(row["late_at"]) and not row["weather_hold_at"]


def to_view(conn: sqlite3.Connection, row: sqlite3.Row, now: datetime | None = None) -> BookingOut:
    """The booking as the player sees it: one booking, whether it is one court or two. Found by any of its courts, it
    is shown under the lead's code. If the host ended one court on its own, the booking describes the courts still on
    (`courts` lists each one with its own status)."""
    now = now or clock.now()
    lead = lead_row(conn, row)
    rows = group_rows(conn, lead)
    on = current_rows(rows)
    main = next((r for r in on if r["id"] == lead["id"]), on[0])  # the court the booking's own fields come from
    on = lead_first(on, main)
    courts = {c["id"]: c for c in conn.execute("SELECT * FROM courts")}
    start = from_iso(main["start_at"])
    items = [
        LineItemOut(start_at=to_iso(i.start), rate=i.rate, rate_type=i.rate_type, court_id=r["court_id"])
        for r in on
        for i in price_hours(from_iso(r["start_at"]), r["hours"], courts[r["court_id"]]["day_rate"], courts[r["court_id"]]["night_rate"])
    ]
    pending_reason, amount_paid = _pending_info(conn, lead)
    return BookingOut(
        code=lead["code"],
        status=main["status"],
        court_id=main["court_id"],
        court_name=" & ".join(courts[r["court_id"]]["name"] for r in on),
        courts=[
            BookingCourtOut(court_id=r["court_id"], court_name=courts[r["court_id"]]["name"], status=r["status"], total=r["total"])
            for r in rows
        ],
        play_date=play_date_of(start),
        start_at=main["start_at"],
        end_at=to_iso(start + timedelta(hours=main["hours"])),
        hours=main["hours"],
        customer_name=lead["customer_name"],
        customer_phone_masked=mask_phone(lead["customer_phone"]),
        payment_method=lead["payment_method"],
        paddles=bool(lead["paddles"]),
        line_items=items,
        court_cost=sum(r["court_cost"] for r in on),
        addons_cost=sum(r["addons_cost"] for r in on),
        total=sum(r["total"] for r in on),
        created_at=lead["created_at"],
        hold_expires_at=lead["hold_expires_at"],
        submitted_at=lead["submitted_at"] or main["submitted_at"],
        proof_type=lead["proof_type"] or main["proof_type"],
        closed_at=main["closed_at"],
        server_now=to_iso(now),
        arrived=any(r["arrived_at"] for r in on),
        late=all(_is_late(r) for r in on),  # Late only when no court of it is on time
        weather_hold=any(r["status"] == "confirmed" and r["weather_hold_at"] for r in on),
        paid_late=main["status"] == "expired" and bool(main["paid_late_at"]),
        reschedule=booking_reschedule_state(on, now),
        reschedule_count=main["reschedule_count"],
        pending_reason=pending_reason,
        amount_paid=amount_paid,
        payment_reference=lead["reference_number"] if lead["submitted_at"] else None,
    )


def _authorized(conn: sqlite3.Connection, code: str, token: str | None) -> sqlite3.Row:
    """Fetch a booking for the device holding `token`. Same 404 for wrong code or wrong token."""
    if not token:
        raise NotFound("not_found", "Booking not found.")
    row = conn.execute(
        """SELECT b.* FROM bookings b JOIN booking_access a ON a.booking_id = b.id
           WHERE b.code = ? AND a.token_hash = ?""",
        (normalize_code(code), _hash_token(token)),
    ).fetchone()
    if row is None:
        raise NotFound("not_found", "Booking not found.")
    return row


authorized = _authorized  # for modules that act on a booking the caller owns (reschedule.py)


# ── Read side ─────────────────────────────────────────────────────────────────
def get_config(conn: sqlite3.Connection) -> ConfigOut:
    now = clock.now()
    return ConfigOut(
        courts=[CourtOut(id=c["id"], name=c["name"], day_rate=c["day_rate"], night_rate=c["night_rate"]) for c in _courts(conn)],
        payment_accounts=[
            PaymentAccountOut(
                method=a.method, label=a.label, account_name=a.account_name,
                account_number=a.account_number, qr_image=a.qr_image, account_hint=a.account_hint,
                enabled=a.enabled, reference_digits=list(a.reference_digits),
            )
            for a in settings.payment_accounts
        ],
        paddle_fee=settings.paddle_fee,
        hold_minutes=settings.hold_minutes,
        late_payment_minutes=settings.late_payment_minutes,
        max_hours=settings.max_hours,
        quick_hours=min(settings.quick_hours, settings.max_hours),
        booking_window_days=settings.booking_window_days,
        late_after_minutes=settings.late_after_minutes,
        guest_reschedule=settings.guest_reschedule,
        reschedule_min_hours=settings.reschedule_min_hours,
        reschedule_window_days=settings.reschedule_window_days,
        consent_version=settings.consent_version,
        proof_mode=settings.proof_mode,
        today=current_play_date(now),
        server_now=to_iso(now),
    )


def _check_play_date(play_date: date, now: datetime) -> None:
    today = current_play_date(now)
    if play_date < today:
        raise BookingError("date_past", "That date has already passed.")
    if play_date > today + timedelta(days=settings.booking_window_days):
        raise BookingError(
            "date_too_far", f"You can book up to {settings.booking_window_days} days ahead."
        )


def availability(conn: sqlite3.Connection, play_date: date) -> AvailabilityOut:
    now = clock.now()
    _check_play_date(play_date, now)
    sweep_if_due(conn, now)

    courts = _courts(conn)
    starts = {h: slot_start(play_date, h) for h in PLAY_DAY_HOURS}
    first, last = to_iso(min(starts.values())), to_iso(max(starts.values()))
    taken: dict[tuple[str, str], str] = {}
    for r in conn.execute(
        """SELECT s.court_id, s.slot_start, b.status FROM booking_slots s
           JOIN bookings b ON b.id = s.booking_id
           WHERE s.slot_start BETWEEN ? AND ?""",
        (first, last),
    ):
        taken[(r["court_id"], r["slot_start"])] = "held" if r["status"] == "held" else "booked"

    slots = []
    for hour in PLAY_DAY_HOURS:
        start = starts[hour]
        key = to_iso(start)
        states = {}
        for c in courts:
            if start <= now:
                states[c["id"]] = "past"
            else:
                states[c["id"]] = taken.get((c["id"], key), "available")
        slots.append(
            SlotOut(
                hour=hour, start_at=key, period=period_for_hour(hour),
                rate_type="night_owl" if is_night_hour(hour) else "standard", courts=states,
            )
        )
    return AvailabilityOut(date=play_date, server_now=to_iso(now), slots=slots)


def get_booking(conn: sqlite3.Connection, code: str, token: str | None) -> BookingOut:
    now = clock.now()
    sweep_if_due(conn, now)
    return to_view(conn, _authorized(conn, code, token), now)


# ── Write side ────────────────────────────────────────────────────────────────
def create_booking(conn: sqlite3.Connection, data: CreateBookingIn, ip: str) -> tuple[BookingOut, str]:
    now = clock.now()
    _check_play_date(data.date, now)
    if data.hours > settings.max_hours:
        raise BookingError("too_long", f"Bookings can be up to {settings.max_hours} hours.")
    if not data.consent:
        raise BookingError("consent_required", "Please agree to the Privacy Notice to continue.")
    if data.consent_version != settings.consent_version:
        raise BookingError("consent_outdated", "The Privacy Notice was updated. Please review it and agree again.")
    account = settings.payment_account(data.payment_method)
    if account is None or not account.enabled:
        raise BookingError("payment_unavailable", "That payment method isn't available yet. Please choose another.")

    start = slot_start(data.date, data.hour)
    if start <= now:
        raise Conflict("slot_past", "That time has already started. Please pick a later slot.")

    with write_transaction(conn):
        release_expired(conn, now)

        courts = []
        for court_id in data.court_ids:
            court = conn.execute("SELECT * FROM courts WHERE id = ? AND active = 1", (court_id,)).fetchone()
            if court is None:
                raise BookingError("court_invalid", "That court isn't available.")
            courts.append(court)
        courts.sort(key=lambda c: (c["sort_order"], c["id"]))

        # A mobile number is not one player: families and groups share one, so it may hold several times.
        # The per-device cap below is what stops one visitor from sitting on many hours. Two courts are one booking.
        holds_by_ip = conn.execute(
            "SELECT COUNT(DISTINCT COALESCE(group_id, id)) FROM bookings WHERE status = 'held' AND client_ip = ?", (ip,)
        ).fetchone()[0]
        if holds_by_ip >= settings.max_active_holds_per_ip:
            raise TooMany("hold_limit", "Too many bookings are waiting for payment from this device. Finish one first.")

        # One row per court, all with the same hours, timer and player. Each court is priced on its own, and the paddle
        # rental is per court (plan D5): one payment pays the sum. Any clash rolls the whole booking back.
        ids = [str(uuid.uuid4()) for _ in courts]
        both = len(courts) > 1
        for booking_id, court in zip(ids, courts):
            items = price_hours(start, data.hours, court["day_rate"], court["night_rate"])
            court_cost = sum(i.rate for i in items)
            addons_cost = settings.paddle_fee if data.paddles else 0
            conn.execute(
                """INSERT INTO bookings (
                       id, code, status, court_id, start_at, hours, customer_name, customer_phone,
                       payment_method, paddles, court_cost, addons_cost, total, consent_at, consent_version,
                       marketing_opt_in, client_ip, created_at, hold_expires_at, group_id)
                   VALUES (?, ?, 'held', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    booking_id, new_code(conn), court["id"], to_iso(start), data.hours, data.customer_name,
                    data.customer_phone, data.payment_method, int(data.paddles), court_cost, addons_cost,
                    court_cost + addons_cost, to_iso(now), data.consent_version, int(data.marketing_opt_in), ip,
                    to_iso(now), to_iso(now + timedelta(minutes=settings.hold_minutes)), ids[0] if both else None,
                ),
            )
            claim_slots(conn, court["name"], court["id"], items, booking_id, taken=TAKEN_BOTH if both else TAKEN)
        token = _issue_token(conn, ids[0], now)
        row = conn.execute("SELECT * FROM bookings WHERE id = ?", (ids[0],)).fetchone()
    return to_view(conn, row, now), token


PAID_AFTER_EXPIRY = (
    "Your time ran out and someone else booked that slot. We've saved your payment and the host will contact you to "
    "move or refund it."
)


def _held_for_proof(
    conn: sqlite3.Connection, code: str, token: str | None, now: datetime
) -> tuple[list[sqlite3.Row], bool]:
    """The booking a payment is for (every court of it, lead first), and whether its hold has already run out. A
    payment that comes in up to `late_payment_minutes` after the deadline is still taken (see `_settle_late_payment`);
    later than that, the hold is simply over."""
    release_expired(conn, now)
    row = lead_row(conn, _authorized(conn, code, token))
    if row["status"] == "expired":
        if row["submitted_at"]:  # a late payment for it is already on record
            raise Conflict("already_submitted", "Payment proof was already submitted for this booking.")
        if now - from_iso(row["hold_expires_at"]) > timedelta(minutes=settings.late_payment_minutes):
            raise Gone("hold_expired", f"Your {settings.hold_minutes}-minute hold ran out, so the slot was released. Please book again.")
        return same_state(conn, row), True
    if row["submitted_at"] and row["status"] in ("pending_verification", "confirmed"):
        raise Conflict("already_submitted", "Payment proof was already submitted for this booking.")
    if row["status"] != "held":
        raise Conflict("not_held", "This booking is no longer waiting for payment.")
    return same_state(conn, row), False


def _settle_late_payment(conn: sqlite3.Connection, rows: list[sqlite3.Row], now: datetime) -> bool:
    """A payment arrived after the hold ran out (plan item 9). If the booking's hours are all still free (on every one
    of its courts), take them back: the booking is held again and the payment confirms it as usual (True). If someone
    else has any of them, nothing is taken (False): the caller keeps the payment on the expired booking for the host.
    Inside the write transaction, so nobody can take the hours between the look and the claim."""
    claims = []
    for row in rows:
        court = conn.execute("SELECT * FROM courts WHERE id = ?", (row["court_id"],)).fetchone()
        items = price_hours(from_iso(row["start_at"]), row["hours"], court["day_rate"], court["night_rate"])
        starts = [to_iso(i.start) for i in items]
        marks = ",".join("?" * len(starts))
        if conn.execute(f"SELECT 1 FROM booking_slots WHERE court_id = ? AND slot_start IN ({marks})", (court["id"], *starts)).fetchone():
            return False
        claims.append((row, court, items))
    for row, court, items in claims:
        claim_slots(conn, court["name"], court["id"], items, row["id"])  # all free: checked just above
        conn.execute("UPDATE bookings SET status = 'held', closed_at = NULL, close_reason = NULL WHERE id = ?", (row["id"],))
        record_event(conn, row["code"], "paid_after_timer", f"Paid {_late_by(row, now)} after the hold ran out; the hours were still free", now)
    return True


def _own_fields(fields: dict[str, object], lead: bool) -> dict[str, object]:
    """What one court's row stores of a payment: all of it on the lead row, all but the payment itself on the others."""
    return fields if lead else {k: v for k, v in fields.items() if k not in PAYMENT_FIELDS}


def _set(conn: sqlite3.Connection, booking_id: str, sql: str, args: tuple, fields: dict[str, object]) -> None:
    cols = "".join(f", {k} = ?" for k in fields)
    conn.execute(f"UPDATE bookings SET {sql}{cols} WHERE id = ?", (*args, *fields.values(), booking_id))


def _keep_late_payment(conn: sqlite3.Connection, rows: list[sqlite3.Row], now: datetime, **fields: object) -> None:
    """Someone else has the hours: the booking stays expired, but the payment is kept on it for the host to move it to
    a free time or refund it. The reference stays spent like any other. Every court of it shows Paid late."""
    for i, row in enumerate(rows):
        _set(conn, row["id"], "submitted_at = ?, paid_late_at = ?", (to_iso(now), to_iso(now)), _own_fields(fields, i == 0))
        record_event(
            conn, row["code"], "paid_late",
            f"Paid {_late_by(row, now)} after the hold ran out, but someone else had booked the slot. Move it to a free time or refund it.",
            now,
        )


def _late_by(row: sqlite3.Row, now: datetime) -> str:
    seconds = max(0, int((now - from_iso(row["hold_expires_at"])).total_seconds()))
    return f"{seconds // 60} min {seconds % 60} s" if seconds >= 60 else f"{seconds} s"


def _confirm_with_proof(conn: sqlite3.Connection, rows: list[sqlite3.Row], now: datetime, flags: list, **fields: object) -> None:
    """Proof in hand: the booking is confirmed now, every court of it (`rows`, lead first). The payment itself is
    stored on the lead row only. Anything that looked off is kept as notes for the host."""
    notes = json.dumps([{"code": f.code, "message": f.message} for f in flags])
    for i, row in enumerate(rows):
        _set(
            conn, row["id"], "status = 'confirmed', submitted_at = ?, decided_at = ?, client_ip = NULL, review_flags = ?",
            (to_iso(now), to_iso(now), notes), _own_fields(fields, i == 0),
        )


def payment_used(conn: sqlite3.Connection, *, reference: str | None = None, receipt_sha256: str | None = None, exclude_id: str | None = None) -> str | None:
    """The booking code a payment already backs (or backed, if that booking was deleted), else None.
    One payment, one booking, ever: even a rejected, voided or deleted booking keeps its payment."""
    for column, kind, value in (("reference_number", "reference", reference), ("receipt_sha256", "receipt", receipt_sha256)):
        if not value:
            continue
        row = conn.execute(f"SELECT code FROM bookings WHERE {column} = ? AND id IS NOT ?", (value, exclude_id)).fetchone()
        row = row or conn.execute("SELECT booking_code AS code FROM spent_payments WHERE kind = ? AND value = ?", (kind, value)).fetchone()
        if row:
            return row["code"]
    return None


def _last4(value: str) -> str | None:
    digits = "".join(c for c in value or "" if c.isdigit())
    return digits[-4:] if len(digits) >= 4 else None


def expected_payment(row: sqlite3.Row, now: datetime, total: int | None = None) -> receipt_reader.Expected:
    """A genuine payment for this booking: its total (`total`: all of its courts), made during the hold, to one of the
    club's accounts."""
    accounts = [a for a in settings.payment_accounts if a.enabled]
    return receipt_reader.Expected(
        total=row["total"] if total is None else total,
        window_start=from_iso(row["created_at"]),
        window_end=now,
        tolerance=timedelta(minutes=settings.paid_time_tolerance_minutes),
        recipient_names=[a.account_name for a in accounts if a.account_name],
        recipient_last4={d for a in accounts for d in (_last4(a.account_number), _last4(a.account_hint)) if d},
    )


def require_receipt_mode() -> None:
    if settings.proof_mode != "receipt":
        raise BookingError("receipt_disabled", "Receipt uploads are switched off. Type your reference number and name instead.")


def submit_receipt(
    conn: sqlite3.Connection, code: str, token: str | None, data: bytes, payer_name: str | None
) -> BookingOut:
    require_receipt_mode()
    ext, digest = receipts.validate(data)
    # Read the receipt before taking the write lock: OCR takes a second or two.
    started = time.monotonic()
    lines = ocr.read_lines(data)
    reading = receipt_reader.read(lines) if lines else None
    took_ms = int((time.monotonic() - started) * 1000)

    now = clock.now()
    stored = None
    kept_late = False
    try:
        with write_transaction(conn):
            rows, late = _held_for_proof(conn, code, token, now)
            row = rows[0]  # the lead: the receipt is stored on it
            if payment_used(conn, receipt_sha256=digest):
                raise Conflict(
                    "receipt_used", "This receipt was already used for another booking. Upload the receipt for this payment."
                )
            ref = reading.reference if reading else None
            if ref and payment_used(conn, reference=ref, exclude_id=row["id"]):
                raise Conflict(
                    "payment_used",
                    "This payment was already used for another booking. Upload the receipt for this booking's payment.",
                )
            total = sum(r["total"] for r in rows)
            flags = receipt_reader.assess(reading, expected_payment(row, now, total), engine_ran=lines is not None)
            stored = receipts.save(row["id"], data, ext, digest)
            proof = dict(
                proof_type="receipt", receipt_path=stored.path, receipt_sha256=stored.sha256, payer_name=payer_name,
                reference_number=ref, paid_at=to_iso(reading.paid_at) if reading and reading.paid_at else None,
            )
            if late and not _settle_late_payment(conn, rows, now):
                _keep_late_payment(conn, rows, now, review_flags=json.dumps([{"code": f.code, "message": f.message} for f in flags]), **proof)
                kept_late = True
            else:
                _confirm_with_proof(conn, rows, now, flags, **proof)
            conn.execute(
                """INSERT OR REPLACE INTO receipt_scans (booking_id, engine, provider, amount_centavos, reference, paid_at,
                       recipient_name, recipient_number, sender_name, sender_number, success, raw_text, duration_ms, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    row["id"], "rapidocr" if lines is not None else "none",
                    reading.provider if reading else None, reading.amount_centavos if reading else None, ref,
                    to_iso(reading.paid_at) if reading and reading.paid_at else None,
                    reading.recipient_name if reading else None, reading.recipient_number if reading else None,
                    reading.sender_name if reading else None, reading.sender_number if reading else None,
                    None if not reading or reading.success is None else int(reading.success),
                    reading.text if reading else None, took_ms, to_iso(now),
                ),
            )
            row = conn.execute("SELECT * FROM bookings WHERE id = ?", (row["id"],)).fetchone()
    except sqlite3.IntegrityError:  # two uploads of one payment raced past the check above
        if stored is not None:
            receipts.delete(stored.path)
        raise Conflict("payment_used", "This payment was already used for another booking.") from None
    except BaseException:
        if stored is not None:
            receipts.delete(stored.path)
        raise
    if kept_late:  # after the commit: the payment is on record, and the player is told what happens next
        raise Conflict("paid_after_expiry", PAID_AFTER_EXPIRY)
    return to_view(conn, row, now)


def _resolve_paid_time(paid_time: str, created_at: datetime, now: datetime) -> datetime:
    """Turn the HH:MM from the receipt into a datetime inside the hold window, or reject it."""
    hh, mm = (int(p) for p in paid_time.split(":"))
    if hh > 23 or mm > 59:
        raise BookingError("paid_time_invalid", "Enter the time shown on your receipt.")
    tol = timedelta(minutes=settings.paid_time_tolerance_minutes)
    lo, hi = created_at - tol, now + tol
    today = now.astimezone(MANILA).date()
    for d in (today, today - timedelta(days=1)):
        candidate = datetime(d.year, d.month, d.day, hh, mm, tzinfo=MANILA)
        if lo <= candidate <= hi:
            return candidate
    raise BookingError(
        "paid_time_outside_window",
        "That time is outside your booking window. Enter the exact time shown on this payment's receipt.",
    )


REFERENCE_USED = (
    "That reference number is already linked to another booking. Each payment can pay for only one booking, so please "
    "check that you typed the reference from the payment you just made for this booking."
)


REFERENCE_TRIES = 5  # turned-away tries one booking gets, then the host takes over
REFERENCE_TRIES_WINDOW = 15 * 60
REFERENCE_LOCKED = "Too many tries on this booking. Please call or text the host with your booking code and they'll sort it out."


def _refuse_reference(strike_key: str, booking_code: str, raw: str, reason: str) -> BookingError:
    """Count a turned-away try and build the reply. Everything we won't take for a reason that could tell someone what is
    already in the system (made-up, another day, a duplicate) gets the very same reply, status code and all."""
    ratelimit.add_strike(strike_key, REFERENCE_TRIES_WINDOW)
    log.info("reference turned away (%s) for %s: %s", reason, booking_code, clean_reference(raw)[:40])
    return BookingError("reference_rejected", REFERENCE_REJECTED)


def submit_reference(conn: sqlite3.Connection, code: str, token: str | None, data: ReferenceProofIn) -> BookingOut:
    now = clock.now()
    kept_late = False
    with write_transaction(conn):
        rows, late = _held_for_proof(conn, code, token, now)
        row = rows[0]  # the lead: the reference is stored on it, so one reference still backs one booking
        strike_key = f"reference:{row['code']}"
        if ratelimit.struck_out(strike_key, REFERENCE_TRIES, REFERENCE_TRIES_WINDOW):
            raise TooMany("reference_locked", REFERENCE_LOCKED)
        account = settings.payment_account(row["payment_method"])
        try:
            ref = normalize_reference(
                data.reference_number,
                booked_on=from_iso(row["created_at"]).astimezone(MANILA).date(),
                also_digits=account.reference_digits if account else (),
            )
        except ReferenceRejected as exc:
            raise _refuse_reference(strike_key, row["code"], data.reference_number, exc.reason) from None
        except ValueError as exc:  # a hint that depends only on what was typed
            ratelimit.add_strike(strike_key, REFERENCE_TRIES_WINDOW)
            raise BookingError("reference_invalid", str(exc)) from None
        # No time is asked for: the payment fell between the booking and this moment (the host sees that window).
        paid_at = _resolve_paid_time(data.paid_time, from_iso(row["created_at"]), now) if data.paid_time else None
        # One payment, one booking: a reference number is never reused, even by a booking that was later rejected, voided
        # or deleted.
        taken = payment_used(conn, reference=ref)
        if taken:
            raise _refuse_reference(strike_key, row["code"], ref, f"already on {taken}")
        # In reference mode every booking is typed in, so a note on each one would only be noise for the host.
        flags = receipt_reader.typed_flags() if settings.proof_mode == "receipt" else []
        proof = dict(proof_type="reference", reference_number=ref, paid_at=to_iso(paid_at) if paid_at else None, payer_name=data.payer_name)
        try:
            if late and not _settle_late_payment(conn, rows, now):
                _keep_late_payment(conn, rows, now, **proof)
                kept_late = True
            else:
                _confirm_with_proof(conn, rows, now, flags, **proof)
        except sqlite3.IntegrityError:  # the unique index is the last line of defence
            raise _refuse_reference(strike_key, row["code"], ref, "taken at the same moment") from None
        row = conn.execute("SELECT * FROM bookings WHERE id = ?", (row["id"],)).fetchone()
    if kept_late:  # after the commit: the payment is on record, and the player is told what happens next
        raise Conflict("paid_after_expiry", PAID_AFTER_EXPIRY)
    return to_view(conn, row, now)


def release_hold(conn: sqlite3.Connection, code: str, token: str | None) -> BookingOut:
    """Let go of a slot that hasn't been paid for. A paid booking is final: there are no cancellations,
    only one reschedule (see reschedule.py)."""
    now = clock.now()
    with write_transaction(conn):
        release_expired(conn, now)
        row = lead_row(conn, _authorized(conn, code, token))
        if row["status"] in ("cancelled", "expired", "rejected"):
            return to_view(conn, row, now)
        if row["status"] != "held":
            raise Conflict(
                "bookings_final",
                "Paid bookings are final: there are no cancellations or refunds. You can reschedule once, at least "
                f"{settings.reschedule_min_hours} hours before your start time, or message the host.",
            )
        rows = same_state(conn, row)  # every court of it: they were held together
        for r in rows:
            conn.execute(
                "UPDATE bookings SET status = 'cancelled', closed_at = ?, close_reason = 'customer', client_ip = NULL WHERE id = ?",
                (to_iso(now), r["id"]),
            )
        view = to_view(conn, conn.execute("SELECT * FROM bookings WHERE id = ?", (row["id"],)).fetchone(), now)
        for r in rows:
            forget_hold(conn, r["id"])
    return view


def forget_hold(conn: sqlite3.Connection, booking_id: str) -> None:
    """An unpaid hold that was let go never became a booking, so nothing of it is kept: the row goes, and its
    slots and access tokens with it (ON DELETE CASCADE). The hours are free the moment this commits."""
    conn.execute("DELETE FROM bookings WHERE id = ? AND status IN ('held', 'cancelled') AND submitted_at IS NULL", (booking_id,))
