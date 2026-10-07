"""What the host can do from the admin desk.

Reads (list, schedule, overview) never change anything. Writes go through the same
`booking_slots` table the public flow uses, so an edit, a restore or a walk-in can never
double book a court-hour: a clash raises Conflict and the whole change is rolled back.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta

from app import booking_service as core
from app import clock, receipts
from app.clock import MANILA, from_iso, to_iso
from app.config import settings
from app.db import write_transaction
from app.errors import BookingError, Conflict, NotFound
from app.admin_schemas import (
    AdminBookingDetail,
    AdminBookingList,
    AdminBookingOut,
    AdminCreateIn,
    AdminSchedule,
    AdminUpdateIn,
    CourtPoint,
    DayPoint,
    EventOut,
    FlagOut,
    Funnel,
    Kpis,
    MethodPoint,
    NavCounts,
    OverviewOut,
    Pipeline,
    RatePoint,
    ScanOut,
    StatusCounts,
    TopCustomer,
    WeekdayPoint,
)
from app.schemas import LineItemOut
from app.slots import current_play_date, play_date_of, price_hours, slot_start
from app.validation import normalize_ph_mobile

STATUSES = ("held", "pending_verification", "confirmed", "rejected", "expired", "cancelled")
ACTIVE = core.ACTIVE_STATUSES
PAGE_SIZE_MAX = 200
# Paid online and confirmed automatically, but the host hasn't looked yet (plus any left over
# from before automatic confirmation).
REVIEW_SQL = (
    "((status = 'confirmed' AND source = 'online' AND submitted_at IS NOT NULL AND checked_at IS NULL)"
    " OR status = 'pending_verification')"
)
FLAGGED_SQL = f"({REVIEW_SQL} AND review_flags IS NOT NULL AND review_flags != '[]')"

SORTS = {
    "start_desc": "start_at DESC",
    "start_asc": "start_at ASC",
    "created_desc": "created_at DESC",
}


# ── Helpers ───────────────────────────────────────────────────────────────────
def _event(conn: sqlite3.Connection, code: str, action: str, detail: str | None, now: datetime) -> None:
    conn.execute(
        "INSERT INTO admin_events (booking_code, action, detail, created_at) VALUES (?, ?, ?, ?)",
        (code, action, detail, to_iso(now)),
    )


def _row(conn: sqlite3.Connection, code: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM bookings WHERE code = ?", (core.normalize_code(code),)).fetchone()
    if row is None:
        raise NotFound("not_found", "Booking not found.")
    return row


def _court_names(conn: sqlite3.Connection) -> dict[str, str]:
    return {c["id"]: c["name"] for c in conn.execute("SELECT id, name FROM courts")}


def _court(conn: sqlite3.Connection, court_id: str) -> sqlite3.Row:
    court = conn.execute("SELECT * FROM courts WHERE id = ? AND active = 1", (court_id,)).fetchone()
    if court is None:
        raise BookingError("court_invalid", "That court isn't available.")
    return court


def _flags(row: sqlite3.Row) -> list[FlagOut]:
    try:
        return [FlagOut(**f) for f in json.loads(row["review_flags"] or "[]")]
    except (ValueError, TypeError):
        return []


def _needs_review(row: sqlite3.Row) -> bool:
    if row["status"] == "pending_verification":
        return True
    return row["status"] == "confirmed" and row["source"] == "online" and bool(row["submitted_at"]) and not row["checked_at"]


def to_admin(row: sqlite3.Row, courts: dict[str, str]) -> AdminBookingOut:
    start = from_iso(row["start_at"])
    return AdminBookingOut(
        code=row["code"],
        status=row["status"],
        source=row["source"],
        court_id=row["court_id"],
        court_name=courts.get(row["court_id"], row["court_id"]),
        play_date=play_date_of(start),
        hour=start.astimezone(MANILA).hour,
        start_at=row["start_at"],
        end_at=to_iso(start + timedelta(hours=row["hours"])),
        hours=row["hours"],
        customer_name=row["customer_name"],
        customer_phone=row["customer_phone"],
        payment_method=row["payment_method"],
        paddles=bool(row["paddles"]),
        court_cost=row["court_cost"],
        addons_cost=row["addons_cost"],
        total=row["total"],
        custom_price=row["total"] != row["court_cost"] + row["addons_cost"],
        created_at=row["created_at"],
        submitted_at=row["submitted_at"],
        decided_at=row["decided_at"],
        closed_at=row["closed_at"],
        close_reason=row["close_reason"],
        hold_expires_at=row["hold_expires_at"],
        proof_type=row["proof_type"],
        has_receipt=bool(row["receipt_path"]),
        reference_number=row["reference_number"],
        paid_at=row["paid_at"],
        payer_name=row["payer_name"],
        admin_note=row["admin_note"],
        checked_at=row["checked_at"],
        review_flags=_flags(row),
        needs_review=_needs_review(row),
    )


def _detail(conn: sqlite3.Connection, row: sqlite3.Row) -> AdminBookingDetail:
    base = to_admin(row, _court_names(conn))
    court = conn.execute("SELECT day_rate, night_rate FROM courts WHERE id = ?", (row["court_id"],)).fetchone()
    items = price_hours(from_iso(row["start_at"]), row["hours"], court["day_rate"], court["night_rate"])
    events = conn.execute(
        "SELECT action, detail, created_at FROM admin_events WHERE booking_code = ? ORDER BY id DESC LIMIT 30",
        (row["code"],),
    ).fetchall()
    s = conn.execute("SELECT * FROM receipt_scans WHERE booking_id = ?", (row["id"],)).fetchone()
    scan = None
    if s:
        scan = ScanOut(
            engine=s["engine"], provider=s["provider"],
            amount=s["amount_centavos"] / 100 if s["amount_centavos"] is not None else None,
            reference=s["reference"], paid_at=s["paid_at"], recipient_name=s["recipient_name"],
            recipient_number=s["recipient_number"], success=None if s["success"] is None else bool(s["success"]),
            raw_text=s["raw_text"], duration_ms=s["duration_ms"],
        )
    return AdminBookingDetail(
        **base.model_dump(),
        line_items=[LineItemOut(start_at=to_iso(i.start), rate=i.rate, rate_type=i.rate_type) for i in items],
        events=[EventOut(action=e["action"], detail=e["detail"], created_at=e["created_at"]) for e in events],
        scan=scan,
    )


def _refreshed(conn: sqlite3.Connection, code: str) -> AdminBookingDetail:
    return _detail(conn, _row(conn, code))


def _check_date(play_date: date, now: datetime) -> None:
    today = current_play_date(now)
    if play_date < today - timedelta(days=60) or play_date > today + timedelta(days=365):
        raise BookingError("date_range", "Pick a date within the last 60 days or the next year.")


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


# ── Reads ─────────────────────────────────────────────────────────────────────
def nav_counts(conn: sqlite3.Connection) -> NavCounts:
    with write_transaction(conn):
        core.release_expired(conn)
    row = conn.execute(
        f"""SELECT (SELECT COUNT(*) FROM bookings WHERE {REVIEW_SQL}) AS to_review,
                   (SELECT COUNT(*) FROM bookings WHERE {FLAGGED_SQL}) AS flagged,
                   (SELECT COUNT(*) FROM bookings WHERE status = 'held') AS held"""
    ).fetchone()
    return NavCounts(to_review=row["to_review"], flagged=row["flagged"], held=row["held"])


def list_bookings(
    conn: sqlite3.Connection,
    *,
    q: str | None,
    status: str | None,
    review: str | None = None,
    date_from: date | None,
    date_to: date | None,
    court_id: str | None,
    sort: str,
    page: int,
    page_size: int,
) -> AdminBookingList:
    with write_transaction(conn):
        core.release_expired(conn)

    where: list[str] = []
    args: list[object] = []
    if q and q.strip():
        term = q.strip()
        clauses = [
            "code LIKE ? ESCAPE '\\'", "customer_name LIKE ? ESCAPE '\\'",
            "customer_phone LIKE ? ESCAPE '\\'", "reference_number LIKE ? ESCAPE '\\'",
        ]
        args += [_like(term.upper()), _like(term), _like(term), _like(term)]
        try:  # "+63 917 123 4567" should find 09171234567
            phone = normalize_ph_mobile(term)
        except ValueError:
            phone = None
        if phone:
            clauses.append("customer_phone = ?")
            args.append(phone)
        where.append("(" + " OR ".join(clauses) + ")")
    if date_from:
        where.append("start_at >= ?")
        args.append(to_iso(slot_start(date_from, 6)))
    if date_to:
        where.append("start_at < ?")
        args.append(to_iso(slot_start(date_to + timedelta(days=1), 6)))
    if court_id:
        where.append("court_id = ?")
        args.append(court_id)
    base_sql = (" WHERE " + " AND ".join(where)) if where else ""

    counts = {s: 0 for s in STATUSES}
    for r in conn.execute(f"SELECT status, COUNT(*) AS n FROM bookings{base_sql} GROUP BY status", args):
        counts[r["status"]] = r["n"]
    joiner = " AND" if where else " WHERE"
    to_review = conn.execute(f"SELECT COUNT(*) FROM bookings{base_sql}{joiner} {REVIEW_SQL}", args).fetchone()[0]
    flagged = conn.execute(f"SELECT COUNT(*) FROM bookings{base_sql}{joiner} {FLAGGED_SQL}", args).fetchone()[0]

    filtered_sql, filtered_args = base_sql, list(args)
    if status and status != "all":
        if status not in STATUSES:
            raise BookingError("bad_status", "Unknown status filter.")
        filtered_sql += (" AND" if filtered_sql else " WHERE") + " status = ?"
        filtered_args.append(status)
    if review:
        if review not in ("unchecked", "flagged"):
            raise BookingError("bad_review", "Unknown review filter.")
        filtered_sql += (" AND " if filtered_sql else " WHERE ") + (REVIEW_SQL if review == "unchecked" else FLAGGED_SQL)

    order = SORTS.get(sort, SORTS["start_desc"])
    page_size = max(1, min(page_size, PAGE_SIZE_MAX))
    page = max(1, page)
    total = conn.execute(f"SELECT COUNT(*) FROM bookings{filtered_sql}", filtered_args).fetchone()[0]
    rows = conn.execute(
        f"SELECT * FROM bookings{filtered_sql} ORDER BY {order}, id LIMIT ? OFFSET ?",
        [*filtered_args, page_size, (page - 1) * page_size],
    ).fetchall()
    courts = _court_names(conn)
    return AdminBookingList(
        items=[to_admin(r, courts) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        counts=StatusCounts(all=sum(counts.values()), to_review=to_review, flagged=flagged, **counts),
    )


def get_detail(conn: sqlite3.Connection, code: str) -> AdminBookingDetail:
    with write_transaction(conn):
        core.release_expired(conn)
    return _detail(conn, _row(conn, code))


def receipt_file(conn: sqlite3.Connection, code: str):
    """Absolute path of the receipt image, guaranteed to sit inside the receipts folder."""
    row = _row(conn, code)
    if not row["receipt_path"]:
        raise NotFound("no_receipt", "There's no receipt image for this booking.")
    path = (settings.data_dir / row["receipt_path"]).resolve()
    if settings.receipts_dir.resolve() not in path.parents or not path.is_file():
        raise NotFound("no_receipt", "The receipt image is no longer stored.")
    return path


def schedule(conn: sqlite3.Connection, play_date: date) -> AdminSchedule:
    now = clock.now()
    with write_transaction(conn):
        core.release_expired(conn, now)
    first = to_iso(slot_start(play_date, 6))
    last = to_iso(slot_start(play_date, 5))  # 5 AM next calendar day is the final hour of the play day
    rows = conn.execute(
        """SELECT * FROM bookings WHERE id IN (
               SELECT DISTINCT booking_id FROM booking_slots WHERE slot_start BETWEEN ? AND ?)
           ORDER BY start_at""",
        (first, last),
    ).fetchall()
    courts = _court_names(conn)
    return AdminSchedule(date=play_date, server_now=to_iso(now), bookings=[to_admin(r, courts) for r in rows])


# ── Writes ────────────────────────────────────────────────────────────────────
def create(conn: sqlite3.Connection, data: AdminCreateIn) -> AdminBookingDetail:
    now = clock.now()
    _check_date(data.date, now)
    block = data.kind == "block"
    start = slot_start(data.date, data.hour)
    with write_transaction(conn):
        core.release_expired(conn, now)
        court = _court(conn, data.court_id)
        items = price_hours(start, data.hours, court["day_rate"], court["night_rate"])
        court_cost = 0 if block else sum(i.rate for i in items)
        addons = settings.paddle_fee if (data.paddles and not block) else 0
        total = 0 if block else (data.total if data.total is not None else court_cost + addons)
        booking_id = str(uuid.uuid4())
        code = core.new_code(conn)
        conn.execute(
            """INSERT INTO bookings (
                   id, code, status, source, court_id, start_at, hours, customer_name, customer_phone,
                   payment_method, paddles, court_cost, addons_cost, total, consent_at, consent_version,
                   created_at, hold_expires_at, submitted_at, decided_at, admin_note)
               VALUES (?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?)""",
            (
                booking_id, code, "blocked" if block else "walk_in", court["id"], to_iso(start), data.hours,
                data.customer_name, "" if block else data.customer_phone,
                "none" if block else data.payment_method, int(data.paddles and not block), court_cost, addons, total,
                to_iso(now), to_iso(now), to_iso(now), to_iso(now), to_iso(now), (data.note or "").strip() or None,
            ),
        )
        core.claim_slots(conn, court["name"], court["id"], items, booking_id)
        _event(conn, code, "blocked" if block else "walk_in_added", f"{court['name']} · {data.hours}h", now)
    return _refreshed(conn, code)


def update(conn: sqlite3.Connection, code: str, data: AdminUpdateIn) -> AdminBookingDetail:
    now = clock.now()
    sent = data.model_fields_set
    with write_transaction(conn):
        core.release_expired(conn, now)
        row = _row(conn, code)
        block = row["source"] == "blocked"
        old_start = from_iso(row["start_at"])

        court_id = data.court_id if "court_id" in sent and data.court_id else row["court_id"]
        court = _court(conn, court_id)
        hours = data.hours if "hours" in sent and data.hours else row["hours"]
        if ("date" in sent and data.date) or ("hour" in sent and data.hour is not None):
            play_date = data.date if "date" in sent and data.date else play_date_of(old_start)
            hour = data.hour if "hour" in sent and data.hour is not None else old_start.astimezone(MANILA).hour
            _check_date(play_date, now)
            start = slot_start(play_date, hour)
        else:
            start = old_start
        paddles = bool(data.paddles) if "paddles" in sent and data.paddles is not None else bool(row["paddles"])
        if block:
            paddles = False

        items = price_hours(start, hours, court["day_rate"], court["night_rate"])
        court_cost = 0 if block else sum(i.rate for i in items)
        addons = settings.paddle_fee if paddles else 0
        computed = court_cost + addons
        was_custom = row["total"] != row["court_cost"] + row["addons_cost"]
        if block:
            total = 0
        elif "total" in sent:
            total = data.total if data.total is not None else computed
        else:
            total = row["total"] if was_custom else computed

        schedule_changed = (court["id"], to_iso(start), hours) != (row["court_id"], row["start_at"], row["hours"])
        if schedule_changed and row["status"] in ACTIVE:
            core.release_slots(conn, row["id"])
            core.claim_slots(conn, court["name"], court["id"], items, row["id"])

        name = data.customer_name if "customer_name" in sent and data.customer_name else row["customer_name"]
        phone = data.customer_phone if "customer_phone" in sent and data.customer_phone is not None else row["customer_phone"]
        method = data.payment_method if "payment_method" in sent and data.payment_method else row["payment_method"]
        note = ((data.note or "").strip() or None) if "note" in sent else row["admin_note"]
        if block:
            phone, method = "", "none"

        conn.execute(
            """UPDATE bookings SET court_id = ?, start_at = ?, hours = ?, paddles = ?, court_cost = ?, addons_cost = ?,
                   total = ?, customer_name = ?, customer_phone = ?, payment_method = ?, admin_note = ? WHERE id = ?""",
            (court["id"], to_iso(start), hours, int(paddles), court_cost, addons, total, name, phone, method, note, row["id"]),
        )
        changed = [
            label for label, before, after in (
                ("schedule", (row["court_id"], row["start_at"], row["hours"]), (court["id"], to_iso(start), hours)),
                ("name", row["customer_name"], name), ("phone", row["customer_phone"], phone),
                ("paddles", bool(row["paddles"]), paddles), ("payment method", row["payment_method"], method),
                ("price", row["total"], total), ("note", row["admin_note"], note),
            ) if before != after
        ]
        if changed:
            _event(conn, row["code"], "edited", ", ".join(changed), now)
    return _refreshed(conn, code)


def confirm(conn: sqlite3.Connection, code: str) -> AdminBookingDetail:
    now = clock.now()
    with write_transaction(conn):
        core.release_expired(conn, now)
        row = _row(conn, code)
        if row["status"] != "confirmed":
            reopened = row["status"] not in ACTIVE
            if reopened:  # a rejected / expired / cancelled booking gave its hours up, so take them back
                court = _court(conn, row["court_id"])
                items = price_hours(from_iso(row["start_at"]), row["hours"], court["day_rate"], court["night_rate"])
                core.claim_slots(conn, court["name"], court["id"], items, row["id"])
            conn.execute(
                """UPDATE bookings SET status = 'confirmed', decided_at = ?, checked_at = ?, closed_at = NULL, close_reason = NULL
                   WHERE id = ?""",
                (to_iso(now), to_iso(now), row["id"]),
            )
            _event(conn, row["code"], "confirmed", f"was {row['status']}" if reopened else None, now)
        elif not row["checked_at"]:
            conn.execute("UPDATE bookings SET checked_at = ? WHERE id = ?", (to_iso(now), row["id"]))
            _event(conn, row["code"], "checked", None, now)
    return _refreshed(conn, code)


def mark_checked(conn: sqlite3.Connection, code: str) -> AdminBookingDetail:
    """The host looked at an automatically confirmed payment and it's fine."""
    return confirm(conn, code)


def reject(conn: sqlite3.Connection, code: str, reason: str | None) -> AdminBookingDetail:
    now = clock.now()
    with write_transaction(conn):
        core.release_expired(conn, now)
        row = _row(conn, code)
        if row["status"] == "rejected":
            return _detail(conn, row)
        paid_online = row["source"] == "online" and bool(row["submitted_at"])
        if not (row["status"] in ("held", "pending_verification") or (row["status"] == "confirmed" and paid_online)):
            raise Conflict("cannot_reject", "Only an online payment can be rejected. Cancel the booking instead.")
        conn.execute(
            """UPDATE bookings SET status = 'rejected', closed_at = ?, decided_at = ?, checked_at = ?,
                   close_reason = 'admin_rejected' WHERE id = ?""",
            (to_iso(now), to_iso(now), to_iso(now), row["id"]),
        )
        core.release_slots(conn, row["id"])
        _event(conn, row["code"], "rejected", (reason or "").strip() or None, now)
    return _refreshed(conn, code)


def cancel(conn: sqlite3.Connection, code: str, reason: str | None) -> AdminBookingDetail:
    now = clock.now()
    with write_transaction(conn):
        core.release_expired(conn, now)
        row = _row(conn, code)
        if row["status"] in ("cancelled", "expired", "rejected"):
            return _detail(conn, row)
        conn.execute(
            "UPDATE bookings SET status = 'cancelled', closed_at = ?, close_reason = 'admin_cancelled' WHERE id = ?",
            (to_iso(now), row["id"]),
        )
        core.release_slots(conn, row["id"])
        _event(conn, row["code"], "cancelled", (reason or "").strip() or None, now)
    return _refreshed(conn, code)


def delete(conn: sqlite3.Connection, code: str) -> None:
    now = clock.now()
    with write_transaction(conn):
        row = _row(conn, code)
        summary = f"{row['customer_name']} · {play_date_of(from_iso(row['start_at']))} · ₱{row['total']} · was {row['status']}"
        conn.execute("DELETE FROM bookings WHERE id = ?", (row["id"],))  # slots and access tokens cascade
        _event(conn, row["code"], "deleted", summary, now)
    if row["receipt_path"]:
        receipts.delete(row["receipt_path"])


# ── Overview ──────────────────────────────────────────────────────────────────
def _pct_or_none(num: int, den: int) -> float | None:
    return round(100 * num / den, 1) if den else None


def overview(conn: sqlite3.Connection, days: int) -> OverviewOut:
    now = clock.now()
    with write_transaction(conn):
        core.release_expired(conn, now)
    days = max(1, min(days, 365))
    today = current_play_date(now)
    start_date = today - timedelta(days=days - 1)
    prev_start = start_date - timedelta(days=days)
    lo, mid, hi = (to_iso(slot_start(d, 6)) for d in (prev_start, start_date, today + timedelta(days=1)))
    courts = [dict(c) for c in conn.execute("SELECT * FROM courts WHERE active = 1 ORDER BY sort_order")]
    rate_of = {c["id"]: (c["day_rate"], c["night_rate"]) for c in courts}

    sold = conn.execute(
        "SELECT * FROM bookings WHERE status = 'confirmed' AND source != 'blocked' AND start_at >= ? AND start_at < ?",
        (lo, hi),
    ).fetchall()
    current = [r for r in sold if r["start_at"] >= mid]
    previous = [r for r in sold if r["start_at"] < mid]

    daily = {start_date + timedelta(days=i): [0, 0, 0] for i in range(days)}  # revenue, bookings, hours
    by_hour = [0] * 24
    weekday = [[0, 0] for _ in range(7)]
    by_court: dict[str, list[int]] = {c["id"]: [0, 0, 0] for c in courts}  # revenue, hours, bookings
    by_method: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_rate = {"standard": [0, 0], "night_owl": [0, 0]}  # revenue, hours
    elapsed_hours = 0
    customers: dict[str, dict] = {}

    for r in current:
        start = from_iso(r["start_at"])
        pd = play_date_of(start)
        d = daily.setdefault(pd, [0, 0, 0])
        d[0] += r["total"]
        d[1] += 1
        d[2] += r["hours"]
        weekday[pd.weekday()][0] += r["total"]
        weekday[pd.weekday()][1] += 1
        bc = by_court.setdefault(r["court_id"], [0, 0, 0])
        bc[0] += r["total"]
        bc[1] += r["hours"]
        bc[2] += 1
        bm = by_method[r["payment_method"]]
        bm[0] += r["total"]
        bm[1] += 1
        day_rate, night_rate = rate_of.get(r["court_id"], (0, 0))
        for item in price_hours(start, r["hours"], day_rate, night_rate):
            by_hour[item.hour] += 1
            by_rate[item.rate_type][0] += item.rate
            by_rate[item.rate_type][1] += 1
            if item.start < now:
                elapsed_hours += 1
        key = r["customer_phone"] or r["customer_name"].lower()
        c = customers.setdefault(key, {"name": r["customer_name"], "phone": r["customer_phone"], "bookings": 0, "hours": 0, "spent": 0})
        c["bookings"] += 1
        c["hours"] += r["hours"]
        c["spent"] += r["total"]

    window_start = slot_start(start_date, 6)
    window_end = min(now, slot_start(today + timedelta(days=1), 6))
    capacity = max(0, int((window_end - window_start).total_seconds() // 3600)) * len(courts)

    # Outcome of online bookings created in this window (walk-ins have no payment step to measure).
    funnel_counts = {s: 0 for s in STATUSES}
    for r in conn.execute("SELECT status, COUNT(*) AS n FROM bookings WHERE source = 'online' AND created_at >= ? GROUP BY status", (mid,)):
        funnel_counts[r["status"]] = r["n"]
    closed = funnel_counts["confirmed"] + funnel_counts["rejected"] + funnel_counts["expired"] + funnel_counts["cancelled"]

    pending = conn.execute(
        f"""SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount,
                   (SELECT COUNT(*) FROM bookings WHERE {FLAGGED_SQL}) AS flagged
            FROM bookings WHERE {REVIEW_SQL}"""
    ).fetchone()
    names = _court_names(conn)
    upcoming = conn.execute(
        """SELECT * FROM bookings WHERE status IN ('confirmed', 'pending_verification') AND source != 'blocked'
           AND start_at >= ? ORDER BY start_at LIMIT 5""",
        (to_iso(now - timedelta(hours=1)),),  # include a session that is under way
    ).fetchall()
    upcoming = [r for r in upcoming if from_iso(r["start_at"]) + timedelta(hours=r["hours"]) > now]

    revenue = sum(r["total"] for r in current)
    top = sorted(customers.values(), key=lambda c: (-c["spent"], -c["bookings"]))[:5]
    return OverviewOut(
        days=days,
        date_from=start_date,
        date_to=today,
        today=today,
        server_now=to_iso(now),
        kpis=Kpis(
            revenue=revenue,
            revenue_prev=sum(r["total"] for r in previous),
            bookings=len(current),
            bookings_prev=len(previous),
            hours=sum(r["hours"] for r in current),
            avg_booking=round(revenue / len(current)) if current else 0,
            paddle_revenue=sum(r["addons_cost"] for r in current),
            utilisation_pct=round(100 * min(1.0, elapsed_hours / capacity), 1) if capacity else 0.0,
            court_hours_available=capacity,
            conversion_pct=_pct_or_none(funnel_counts["confirmed"], closed) if closed >= 5 else None,
            repeat_customers=sum(1 for c in customers.values() if c["bookings"] > 1),
            customers=len(customers),
        ),
        daily=[DayPoint(date=d, revenue=v[0], bookings=v[1], hours=v[2]) for d, v in sorted(daily.items())],
        by_hour=by_hour,
        by_weekday=[WeekdayPoint(weekday=i, revenue=v[0], bookings=v[1]) for i, v in enumerate(weekday)],
        by_court=[CourtPoint(court_id=cid, name=names.get(cid, cid), revenue=v[0], hours=v[1], bookings=v[2]) for cid, v in by_court.items()],
        by_method=[MethodPoint(method=m, revenue=v[0], bookings=v[1]) for m, v in sorted(by_method.items(), key=lambda kv: -kv[1][0])],
        by_rate=[RatePoint(rate_type=k, revenue=v[0], hours=v[1]) for k, v in by_rate.items()],
        funnel=Funnel(**funnel_counts),
        pending=Pipeline(count=pending["n"], amount=pending["amount"], flagged=pending["flagged"]),
        up_next=[to_admin(r, names) for r in upcoming],
        top_customers=[TopCustomer(**c) for c in top],
    )

