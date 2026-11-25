"""Optional Telegram alerts for the host. Off unless TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.

Three things are worth a ping on a phone that isn't looking at the desk:

* a booking just went Late (its court is held until the host decides: here after all, or release the court),
* a payment came in after its hold ran out while someone else had the slot (move it or refund it), and
* rain is forecast during paid bookings (time to think about a rain delay).

Each alert is sent once: `notices_sent` remembers which ones went out. The network call happens outside any
database transaction, and a failure is logged and ignored (the desk shows the same information). Both courts of a
two-court booking that go Late, or are paid late, together make one message.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import urllib.request
from datetime import datetime, timedelta

from app import clock, weather
from app.clock import MANILA, from_iso, to_iso
from app.config import settings

log = logging.getLogger("housepickle.notify")


def enabled() -> bool:
    return bool(settings.telegram_bot_token and settings.telegram_chat_id)


def send(text: str) -> bool:
    """Send one message to the host. Returns whether Telegram accepted it."""
    if not enabled():
        return False
    body = json.dumps({"chat_id": settings.telegram_chat_id, "text": text}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
        data=body, headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as res:  # noqa: S310 (fixed https URL)
            return 200 <= res.status < 300
    except Exception:
        log.warning("Telegram message failed", exc_info=True)
        return False


def _unsent(conn: sqlite3.Connection, key: str) -> bool:
    return conn.execute("SELECT 1 FROM notices_sent WHERE key = ?", (key,)).fetchone() is None


def _mark(conn: sqlite3.Connection, key: str, now: datetime) -> None:
    conn.execute("INSERT OR IGNORE INTO notices_sent (key, sent_at) VALUES (?, ?)", (key, to_iso(now)))


def _hour(dt: datetime) -> str:
    return dt.astimezone(MANILA).strftime("%I:%M %p").lstrip("0")


def _by_booking(rows: list[sqlite3.Row]) -> list[list[sqlite3.Row]]:
    """Rows grouped per booking (both courts of a two-court booking together), in the order they came."""
    groups: dict[str, list[sqlite3.Row]] = {}
    for r in rows:
        groups.setdefault(r["group_id"] or r["code"], []).append(r)
    return list(groups.values())


def _courts(rows: list[sqlite3.Row]) -> str:
    return " & ".join(r["court"] for r in rows)


def check_late(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Tell the host about bookings that just went Late: the court is still theirs until the host decides."""
    if not enabled():
        return 0
    now = now or clock.now()
    since = to_iso(now - timedelta(hours=1))  # a ping about something long past would only confuse
    rows = conn.execute(
        """SELECT b.code, b.group_id, b.customer_name, b.customer_phone, b.start_at, b.late_at, c.name AS court
           FROM bookings b JOIN courts c ON c.id = b.court_id
           WHERE b.status = 'confirmed' AND b.source != 'blocked' AND b.weather_hold_at IS NULL AND b.released_at IS NULL
             AND b.late_at >= ?
           ORDER BY b.start_at, c.sort_order""",
        (since,),
    ).fetchall()
    sent = 0
    for group in _by_booking([r for r in rows if _unsent(conn, f"late:{r['code']}")]):
        r = group[0]
        one = len(group) == 1
        text = (
            f"⏰ {r['customer_name']} isn't marked here for {_courts(group)} at {_hour(from_iso(r['start_at']))} "
            f"({settings.late_after_minutes} min after the start). The court{'' if one else 's'} {'is' if one else 'are'} "
            f"still theirs. Open the desk: tap Arrived if they're playing, or Release court to open "
            f"{'it' if one else 'each one'} to others"
            + (f". Their number: {r['customer_phone']}." if r["customer_phone"] else ".")
        )
        if send(text):
            for g in group:
                _mark(conn, f"late:{g['code']}", now)
            sent += 1
    return sent


def check_paid_late(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Tell the host about a payment that came in after its hold ran out, while someone else had the slot."""
    if not enabled():
        return 0
    now = now or clock.now()
    rows = conn.execute(
        """SELECT b.id, b.code, b.group_id, b.customer_name, b.customer_phone, b.start_at, b.total, b.reference_number,
                  b.payer_name, b.payment_method, c.name AS court
           FROM bookings b JOIN courts c ON c.id = b.court_id
           WHERE b.status = 'expired' AND b.paid_late_at IS NOT NULL AND b.paid_late_at >= ?
           ORDER BY b.paid_late_at, c.sort_order""",
        (to_iso(now - timedelta(days=1)),),
    ).fetchall()
    sent = 0
    for group in _by_booking([r for r in rows if _unsent(conn, f"paid_late:{r['code']}")]):
        # The payment is on the lead row (the code the player has); the courts were paid for together.
        r = next((g for g in group if g["id"] == g["group_id"]), group[0])
        start = from_iso(r["start_at"]).astimezone(MANILA)
        text = (
            f"💸 {r['customer_name']} paid ₱{sum(g['total'] for g in group):,} after their time ran out, and someone else "
            f"had booked {_courts(group)} on {start.strftime('%a %b %d').replace(' 0', ' ')} at {_hour(start)}. "
            f"Ref {r['reference_number'] or '-'}, sent by {r['payer_name'] or '-'}. "
            f"Open the desk ({r['code']}) to move it to a free time or refund it"
            + (f". Their number: {r['customer_phone']}." if r["customer_phone"] else ".")
        )
        if send(text):
            for g in group:
                _mark(conn, f"paid_late:{g['code']}", now)
            sent += 1
    return sent


def check_rain(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """One alert per play date when rain is forecast during paid bookings in the next two days."""
    if not enabled():
        return 0
    now = now or clock.now()
    hours = weather.forecast(now)
    if not hours:
        return 0
    rows = conn.execute(
        """SELECT id, group_id, start_at, hours FROM bookings
           WHERE status = 'confirmed' AND source != 'blocked' AND late_at IS NULL AND weather_hold_at IS NULL
             AND start_at < ? AND start_at >= ? ORDER BY start_at""",
        (to_iso(now + timedelta(hours=48)), to_iso(now - timedelta(hours=1))),
    ).fetchall()
    by_day: dict[str, list[tuple[int, datetime, str]]] = {}
    for r in rows:
        start = from_iso(r["start_at"])
        peak = weather.peak(hours, start, start + timedelta(hours=r["hours"]))
        if peak is not None and peak >= settings.rain_warn_percent:
            by_day.setdefault(start.astimezone(MANILA).strftime("%Y-%m-%d"), []).append((peak, start, r["group_id"] or r["id"]))
    sent = 0
    for day, items in by_day.items():
        key = f"rain:{day}"
        if not _unsent(conn, key):
            continue
        worst = max(p for p, _, _ in items)
        first = min(s for _, s, _ in items)
        count = len({b for _, _, b in items})  # both courts of one booking are one booking
        label = first.astimezone(MANILA).strftime("%a %b %d").replace(" 0", " ")
        text = (
            f"🌧 Rain is likely ({worst}%) on {label}, around {_hour(first)}. "
            f"{count} paid booking{'s' if count != 1 else ''} may be affected. "
            "Open the desk → Weather to call a rain delay."
        )
        if send(text):
            _mark(conn, key, now)
            sent += 1
    return sent
