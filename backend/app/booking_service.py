"""Booking rules.

Lifecycle:

    held ──(receipt / reference, full amount)──▶ confirmed ──(host spots a problem)──▶ rejected
     │  │                                           │
     │  └─(receipt short / unreadable)──▶ pending_verification ──(host decides)──▶ confirmed | rejected
     │                                              │
     │                       (group not there 15 min after the start: still `confirmed`, but `late_at`
     │                        is set and the hours are released. The host can restore it.)
     ├─(hold runs out)──▶ expired
     └─(player releases an unpaid hold)──▶ cancelled

* There is no cancellation of a paid booking. The only way out is to reschedule (see `reschedule.py`).
* Payment proof confirms the booking straight away *if the amount is right*. A receipt image is read
  on the server (amount, reference, date, recipient). A receipt that is short, or whose amount can't be
  read although the OCR worked, waits for the host (`pending_verification`); anything else that doesn't
  fit the booking is saved as review flags. The same payment (image or reference number) can never
  confirm two bookings.

* A booking occupies one `booking_slots` row per court-hour from the moment it
  is held. The table's primary key makes double booking impossible.
* The hold deadline lives in the database; clients only display a countdown to it.
* Expired holds and late bookings are released lazily on every request and by a background sweep.
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

from app import clock, ocr, receipt_reader, receipts
from app.clock import MANILA, from_iso, to_iso
from app.config import settings
from app.db import write_transaction
from app.errors import BookingError, Conflict, Gone, NotFound, TooMany
from app.schemas import (
    AvailabilityOut,
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
from app.validation import mask_phone, normalize_reference

log = logging.getLogger("housepickle")

ACTIVE_STATUSES = ("held", "pending_verification", "confirmed")
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"  # no 0/O, 1/I/L, U


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
    """Free the slots nobody is using any more: unpaid holds past their deadline, and bookings whose
    group hasn't shown up in time. Returns the number of holds expired. Must run inside a write transaction."""
    now = now or clock.now()
    cutoff = to_iso(now - timedelta(seconds=settings.hold_grace_seconds))
    rows = conn.execute(
        "SELECT id FROM bookings WHERE status = 'held' AND hold_expires_at <= ?", (cutoff,)
    ).fetchall()
    for row in rows:
        conn.execute(
            "UPDATE bookings SET status = 'expired', closed_at = ?, close_reason = 'hold_timeout', client_ip = NULL WHERE id = ?",
            (to_iso(now), row["id"]),
        )
        release_slots(conn, row["id"])
    release_late(conn, now)
    return len(rows)


def release_late(conn: sqlite3.Connection, now: datetime) -> int:
    """House rule: a group that isn't there `late_after_minutes` after its start is Late and its hours open up.

    The booking stays `confirmed` (it was paid, and nothing is refunded); `late_at` records when it went late.
    The host can still restore it for a short while (see `restore_window_minutes`), but guests never hear of that.
    Blocks, rain-delayed bookings and groups that have checked in are never late."""
    cutoff = to_iso(now - timedelta(minutes=settings.late_after_minutes))
    rows = conn.execute(
        """SELECT id, code, start_at FROM bookings
           WHERE status = 'confirmed' AND source != 'blocked' AND arrived_at IS NULL
             AND late_at IS NULL AND weather_hold_at IS NULL AND start_at <= ?""",
        (cutoff,),
    ).fetchall()
    for row in rows:
        # The moment it became late, not the moment we noticed: the host's restore window counts from here.
        late_at = from_iso(row["start_at"]) + timedelta(minutes=settings.late_after_minutes)
        conn.execute("UPDATE bookings SET late_at = ? WHERE id = ?", (to_iso(late_at), row["id"]))
        release_slots(conn, row["id"])
        record_event(conn, row["code"], "went_late", f"Not there {settings.late_after_minutes} min after the start; hours released", now)
        log.info("booking %s went late", row["code"])
    return len(rows)


def sweep(conn: sqlite3.Connection) -> int:
    with write_transaction(conn):
        return release_expired(conn)


def claim_slots(conn: sqlite3.Connection, court_name: str, court_id: str, items: list, booking_id: str) -> None:
    """Take one `booking_slots` row per hour. The primary key turns a clash into a clean Conflict."""
    for item in items:
        try:
            conn.execute(
                "INSERT INTO booking_slots (court_id, slot_start, booking_id) VALUES (?, ?, ?)",
                (court_id, to_iso(item.start), booking_id),
            )
        except sqlite3.IntegrityError:
            label = item.start.astimezone(MANILA).strftime("%I:%M %p").lstrip("0")
            raise Conflict("slot_taken", f"{court_name} at {label} was just taken. Please choose another time or court.") from None


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
    """Can the guest move this booking? `open` (once, 48 h ahead), `weather` (host called a rain delay,
    always possible), `used`, `too_late`, or `unavailable` (not a paid, upcoming booking)."""
    if row["status"] != "confirmed" or row["source"] == "blocked":
        return "unavailable"
    if row["weather_hold_at"]:
        return "weather"
    if row["late_at"] or row["arrived_at"]:
        return "unavailable"
    start = from_iso(row["start_at"])
    if start <= now:
        return "unavailable"
    if row["reschedule_count"] >= 1:
        return "used"
    if start - now < timedelta(hours=settings.reschedule_min_hours):
        return "too_late"
    return "open"


def can_check_in(row: sqlite3.Row, now: datetime) -> bool:
    if row["status"] != "confirmed" or row["source"] == "blocked" or row["arrived_at"] or row["late_at"] or row["weather_hold_at"]:
        return False
    start = from_iso(row["start_at"])
    return start - timedelta(minutes=settings.checkin_opens_minutes) <= now < start + timedelta(hours=row["hours"])


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
    if "amount_missing" in codes:
        return "amount_unreadable", amount
    return None, amount


def to_view(conn: sqlite3.Connection, row: sqlite3.Row, now: datetime | None = None) -> BookingOut:
    now = now or clock.now()
    court = conn.execute("SELECT * FROM courts WHERE id = ?", (row["court_id"],)).fetchone()
    start = from_iso(row["start_at"])
    items = price_hours(start, row["hours"], court["day_rate"], court["night_rate"])
    pending_reason, amount_paid = _pending_info(conn, row)
    return BookingOut(
        code=row["code"],
        status=row["status"],
        court_id=row["court_id"],
        court_name=court["name"],
        play_date=play_date_of(start),
        start_at=row["start_at"],
        end_at=to_iso(start + timedelta(hours=row["hours"])),
        hours=row["hours"],
        customer_name=row["customer_name"],
        customer_phone_masked=mask_phone(row["customer_phone"]),
        payment_method=row["payment_method"],
        paddles=bool(row["paddles"]),
        line_items=[LineItemOut(start_at=to_iso(i.start), rate=i.rate, rate_type=i.rate_type) for i in items],
        court_cost=row["court_cost"],
        addons_cost=row["addons_cost"],
        total=row["total"],
        created_at=row["created_at"],
        hold_expires_at=row["hold_expires_at"],
        submitted_at=row["submitted_at"],
        proof_type=row["proof_type"],
        closed_at=row["closed_at"],
        server_now=to_iso(now),
        arrived=bool(row["arrived_at"]),
        late=row["status"] == "confirmed" and bool(row["late_at"]) and not row["weather_hold_at"],
        weather_hold=row["status"] == "confirmed" and bool(row["weather_hold_at"]),
        can_check_in=can_check_in(row, now),
        reschedule=reschedule_state(row, now),
        reschedule_count=row["reschedule_count"],
        pending_reason=pending_reason,
        amount_paid=amount_paid,
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
                enabled=a.enabled,
            )
            for a in (settings.gcash, settings.gotyme)
        ],
        paddle_fee=settings.paddle_fee,
        hold_minutes=settings.hold_minutes,
        max_hours=settings.max_hours,
        booking_window_days=settings.booking_window_days,
        late_after_minutes=settings.late_after_minutes,
        reschedule_min_hours=settings.reschedule_min_hours,
        reschedule_window_days=settings.reschedule_window_days,
        consent_version=settings.consent_version,
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
    with write_transaction(conn):
        release_expired(conn, now)

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
    with write_transaction(conn):
        release_expired(conn, now)
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

        court = conn.execute("SELECT * FROM courts WHERE id = ? AND active = 1", (data.court_id,)).fetchone()
        if court is None:
            raise BookingError("court_invalid", "That court isn't available.")

        holds_by_phone = conn.execute(
            "SELECT COUNT(*) FROM bookings WHERE status = 'held' AND customer_phone = ?", (data.customer_phone,)
        ).fetchone()[0]
        if holds_by_phone >= settings.max_active_holds_per_phone:
            raise TooMany(
                "hold_exists",
                "This mobile number already has a booking waiting for payment. Finish it or release the slot first.",
            )
        holds_by_ip = conn.execute(
            "SELECT COUNT(*) FROM bookings WHERE status = 'held' AND client_ip = ?", (ip,)
        ).fetchone()[0]
        if holds_by_ip >= settings.max_active_holds_per_ip:
            raise TooMany("hold_limit", "Too many bookings are waiting for payment from this device. Finish one first.")

        items = price_hours(start, data.hours, court["day_rate"], court["night_rate"])
        court_cost = sum(i.rate for i in items)
        addons_cost = settings.paddle_fee if data.paddles else 0
        booking_id = str(uuid.uuid4())
        code = new_code(conn)
        conn.execute(
            """INSERT INTO bookings (
                   id, code, status, court_id, start_at, hours, customer_name, customer_phone,
                   payment_method, paddles, court_cost, addons_cost, total, consent_at, consent_version,
                   marketing_opt_in, client_ip, created_at, hold_expires_at)
               VALUES (?, ?, 'held', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                booking_id, code, court["id"], to_iso(start), data.hours, data.customer_name, data.customer_phone,
                data.payment_method, int(data.paddles), court_cost, addons_cost, court_cost + addons_cost,
                to_iso(now), data.consent_version, int(data.marketing_opt_in), ip, to_iso(now),
                to_iso(now + timedelta(minutes=settings.hold_minutes)),
            ),
        )
        claim_slots(conn, court["name"], court["id"], items, booking_id)
        token = _issue_token(conn, booking_id, now)
        row = conn.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
    return to_view(conn, row, now), token


def _held_for_proof(conn: sqlite3.Connection, code: str, token: str | None, now: datetime) -> sqlite3.Row:
    release_expired(conn, now)
    row = _authorized(conn, code, token)
    if row["status"] == "expired":
        raise Gone("hold_expired", f"Your {settings.hold_minutes}-minute hold ran out, so the slot was released. Please book again.")
    if row["submitted_at"] and row["status"] in ("pending_verification", "confirmed"):
        raise Conflict("already_submitted", "Payment proof was already submitted for this booking.")
    if row["status"] != "held":
        raise Conflict("not_held", "This booking is no longer waiting for payment.")
    return row


def _confirm_with_proof(
    conn: sqlite3.Connection, booking_id: str, now: datetime, flags: list, *, status: str = "confirmed", **fields: object
) -> None:
    """Proof in hand. A payment that adds up confirms the booking now; one that doesn't (`pending_verification`)
    keeps the slot and waits for the host. What looked off is kept either way."""
    cols = ", ".join(f"{k} = ?" for k in fields)
    decided = to_iso(now) if status == "confirmed" else None
    conn.execute(
        f"""UPDATE bookings SET status = ?, submitted_at = ?, decided_at = ?, client_ip = NULL,
               review_flags = ?, {cols} WHERE id = ?""",
        (status, to_iso(now), decided, json.dumps([{"code": f.code, "message": f.message} for f in flags]), *fields.values(), booking_id),
    )


def _last4(value: str) -> str | None:
    digits = "".join(c for c in value or "" if c.isdigit())
    return digits[-4:] if len(digits) >= 4 else None


def expected_payment(row: sqlite3.Row, now: datetime) -> receipt_reader.Expected:
    """A genuine payment for this booking: its total, made during the hold, to one of the club's accounts."""
    accounts = [a for a in (settings.gcash, settings.gotyme) if a.enabled]
    return receipt_reader.Expected(
        total=row["total"],
        window_start=from_iso(row["created_at"]),
        window_end=now,
        tolerance=timedelta(minutes=settings.paid_time_tolerance_minutes),
        recipient_names=[a.account_name for a in accounts if a.account_name],
        recipient_last4={d for a in accounts for d in (_last4(a.account_number), _last4(a.account_hint)) if d},
    )


def submit_receipt(
    conn: sqlite3.Connection, code: str, token: str | None, data: bytes, payer_name: str | None
) -> BookingOut:
    ext, digest = receipts.validate(data)
    # Read the receipt before taking the write lock: OCR takes a second or two.
    started = time.monotonic()
    lines = ocr.read_lines(data)
    reading = receipt_reader.read(lines) if lines else None
    took_ms = int((time.monotonic() - started) * 1000)

    now = clock.now()
    stored = None
    try:
        with write_transaction(conn):
            row = _held_for_proof(conn, code, token, now)
            if conn.execute("SELECT 1 FROM bookings WHERE receipt_sha256 = ?", (digest,)).fetchone():
                raise Conflict(
                    "receipt_used", "This receipt was already used for another booking. Upload the receipt for this payment."
                )
            ref = reading.reference if reading else None
            if ref and conn.execute("SELECT 1 FROM bookings WHERE reference_number = ? AND id != ?", (ref, row["id"])).fetchone():
                raise Conflict(
                    "payment_used",
                    "This payment was already used for another booking. Upload the receipt for this booking's payment.",
                )
            flags = receipt_reader.assess(reading, expected_payment(row, now), engine_ran=lines is not None)
            stored = receipts.save(row["id"], data, ext, digest)
            # Full payment confirms a booking. A receipt that is short, or whose amount can't be read although
            # the OCR worked, keeps the slot but waits for the host; it never confirms by itself.
            waits = any(f.code in receipt_reader.HOLD_FOR_HOST for f in flags)
            _confirm_with_proof(
                conn, row["id"], now, flags, status="pending_verification" if waits else "confirmed",
                proof_type="receipt", receipt_path=stored.path, receipt_sha256=stored.sha256,
                payer_name=payer_name, reference_number=ref,
                paid_at=to_iso(reading.paid_at) if reading and reading.paid_at else None,
            )
            conn.execute(
                """INSERT OR REPLACE INTO receipt_scans (booking_id, engine, provider, amount_centavos, reference, paid_at,
                       recipient_name, recipient_number, success, raw_text, duration_ms, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    row["id"], "rapidocr" if lines is not None else "none",
                    reading.provider if reading else None, reading.amount_centavos if reading else None, ref,
                    to_iso(reading.paid_at) if reading and reading.paid_at else None,
                    reading.recipient_name if reading else None, reading.recipient_number if reading else None,
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


def submit_reference(conn: sqlite3.Connection, code: str, token: str | None, data: ReferenceProofIn) -> BookingOut:
    now = clock.now()
    with write_transaction(conn):
        row = _held_for_proof(conn, code, token, now)
        try:
            ref = normalize_reference(row["payment_method"], data.reference_number)
        except ValueError as exc:
            raise BookingError("reference_invalid", str(exc)) from None
        paid_at = _resolve_paid_time(data.paid_time, from_iso(row["created_at"]), now)
        if conn.execute("SELECT 1 FROM bookings WHERE reference_number = ?", (ref,)).fetchone():
            raise Conflict("reference_used", "This reference number was already used for another booking.")
        _confirm_with_proof(
            conn, row["id"], now, receipt_reader.typed_flags(), proof_type="reference", reference_number=ref,
            paid_at=to_iso(paid_at), payer_name=data.payer_name,
        )
        row = conn.execute("SELECT * FROM bookings WHERE id = ?", (row["id"],)).fetchone()
    return to_view(conn, row, now)


def release_hold(conn: sqlite3.Connection, code: str, token: str | None) -> BookingOut:
    """Let go of a slot that hasn't been paid for. A paid booking is final: there are no cancellations,
    only one reschedule (see reschedule.py)."""
    now = clock.now()
    with write_transaction(conn):
        release_expired(conn, now)
        row = _authorized(conn, code, token)
        if row["status"] in ("cancelled", "expired", "rejected"):
            return to_view(conn, row, now)
        if row["status"] != "held":
            raise Conflict(
                "bookings_final",
                "Paid bookings are final: there are no cancellations or refunds. You can reschedule once, at least "
                f"{settings.reschedule_min_hours} hours before your start time, or message the host.",
            )
        conn.execute(
            "UPDATE bookings SET status = 'cancelled', closed_at = ?, close_reason = 'customer', client_ip = NULL WHERE id = ?",
            (to_iso(now), row["id"]),
        )
        release_slots(conn, row["id"])
        row = conn.execute("SELECT * FROM bookings WHERE id = ?", (row["id"],)).fetchone()
    return to_view(conn, row, now)


def check_in(conn: sqlite3.Connection, code: str, token: str | None) -> BookingOut:
    """The group is here. Stops the booking from going Late; nothing else changes."""
    now = clock.now()
    with write_transaction(conn):
        release_expired(conn, now)
        row = _authorized(conn, code, token)
        if row["status"] != "confirmed" or row["source"] == "blocked":
            raise Conflict("not_confirmed", "Only a paid booking can check in.")
        if row["arrived_at"]:
            return to_view(conn, row, now)
        if row["weather_hold_at"]:
            raise Conflict("weather_hold", "This session was moved because of the weather. Please pick a new time.")
        if row["late_at"]:
            raise Conflict(
                "late",
                f"You're more than {settings.late_after_minutes} minutes past your start time, so the court was released. "
                "Please contact the host right away.",
            )
        start = from_iso(row["start_at"])
        if now < start - timedelta(minutes=settings.checkin_opens_minutes):
            raise Conflict("too_early", f"Check-in opens {settings.checkin_opens_minutes} minutes before your start time.")
        if now >= start + timedelta(hours=row["hours"]):
            raise Conflict("session_over", "This session has already ended.")
        conn.execute("UPDATE bookings SET arrived_at = ? WHERE id = ?", (to_iso(now), row["id"]))
        record_event(conn, row["code"], "checked_in", "Checked in on the pass", now)
        row = conn.execute("SELECT * FROM bookings WHERE id = ?", (row["id"],)).fetchone()
    return to_view(conn, row, now)
