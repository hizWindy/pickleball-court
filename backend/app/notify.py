"""Optional Telegram alerts for the host. Off unless TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.

Two things are worth a ping on a phone that isn't looking at the desk:

* a booking just went Late (the host's quiet restore window is only a few minutes), and
* rain is forecast during paid bookings (time to think about a rain delay).

Each alert is sent once: `notices_sent` remembers which ones went out. The network call happens outside any
database transaction, and a failure is logged and ignored (the desk shows the same information).
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


def check_late(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Tell the host about bookings that just went Late and can still be restored."""
    if not enabled():
        return 0
    now = now or clock.now()
    since = to_iso(now - timedelta(minutes=settings.restore_window_minutes))
    rows = conn.execute(
        """SELECT b.code, b.customer_name, b.customer_phone, b.start_at, b.late_at, c.name AS court
           FROM bookings b JOIN courts c ON c.id = b.court_id
           WHERE b.status = 'confirmed' AND b.source != 'blocked' AND b.weather_hold_at IS NULL AND b.late_at >= ?""",
        (since,),
    ).fetchall()
    sent = 0
    for r in rows:
        key = f"late:{r['code']}"
        if not _unsent(conn, key):
            continue
        text = (
            f"⏰ {r['customer_name']} is late for {r['court']} at {_hour(from_iso(r['start_at']))}. "
            f"The court was released. Open the desk to restore it if they turn up"
            + (f", or call {r['customer_phone']}." if r["customer_phone"] else ".")
        )
        if send(text):
            _mark(conn, key, now)
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
        """SELECT code, start_at, hours FROM bookings
           WHERE status = 'confirmed' AND source != 'blocked' AND late_at IS NULL AND weather_hold_at IS NULL
             AND start_at < ? AND start_at >= ? ORDER BY start_at""",
        (to_iso(now + timedelta(hours=48)), to_iso(now - timedelta(hours=1))),
    ).fetchall()
    by_day: dict[str, list[tuple[int, datetime]]] = {}
    for r in rows:
        start = from_iso(r["start_at"])
        peak = weather.peak(hours, start, start + timedelta(hours=r["hours"]))
        if peak is not None and peak >= settings.rain_warn_percent:
            by_day.setdefault(start.astimezone(MANILA).strftime("%Y-%m-%d"), []).append((peak, start))
    sent = 0
    for day, items in by_day.items():
        key = f"rain:{day}"
        if not _unsent(conn, key):
            continue
        worst = max(p for p, _ in items)
        first = min(s for _, s in items)
        label = first.astimezone(MANILA).strftime("%a %b %d").replace(" 0", " ")
        text = (
            f"🌧 Rain is likely ({worst}%) on {label}, around {_hour(first)}. "
            f"{len(items)} paid booking{'s' if len(items) != 1 else ''} may be affected. "
            "Open the desk → Weather to call a rain delay."
        )
        if send(text):
            _mark(conn, key, now)
            sent += 1
    return sent
