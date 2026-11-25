"""Load test: a real server, many players and the admin desk all grabbing the same court-hours at the same instant.

Run it from backend/ (it starts its own server on a throwaway database, so the dev database is never touched):

    .venv\\Scripts\\python scripts\\stress_double_booking.py

Pass: one winner per court-hour, and no court-hour owned by two bookings (checked from the bookings themselves, not
from the slot table that is supposed to prevent it). Two-court bookings (release 4) race one-court bookings for the same
hours: a two-court booking gets both courts or nothing. 2026-11-25: 98 requests, zero overlaps (before release 4); then
177 requests with two-court bookings, zero overlaps and no two-court booking left with one court.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
from app.booking_service import HOLDS_COURT_SQL  # noqa: E402  (one definition of "owns its hours", shared with the app)

PORT = int(os.getenv("STRESS_PORT", "8799"))
BASE = f"http://127.0.0.1:{PORT}"
PASSWORD = "stress-test-only"
MANILA = timezone(timedelta(hours=8))


def start_server(data: Path) -> subprocess.Popen:
    env = dict(os.environ)
    env.update(
        DATA_DIR=str(data), ADMIN_PASSWORD=PASSWORD, ADMIN_PASSWORD_HASH="", MAX_HOLDS_PER_IP="1000",
        PROOF_MODE="reference", OCR_ENABLED="0", WEATHER_ENABLED="0", TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="",
        FRONTEND_DIST=str(data / "no-frontend"),
    )
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--proxy-headers",
         "--forwarded-allow-ips=*", "--log-level", "warning"],
        cwd=BACKEND, env=env,
    )
    for _ in range(150):
        try:
            if httpx.get(f"{BASE}/api/health", timeout=1).status_code == 200:
                return server
        except httpx.HTTPError:
            time.sleep(0.2)
    server.terminate()
    raise SystemExit("The server did not start.")


def fire(label: str, jobs: list) -> list[int]:
    """Release every request at the same instant, each from its own connection."""
    barrier = threading.Barrier(len(jobs))
    results: list[int] = [0] * len(jobs)

    def run(i: int, job) -> None:
        with httpx.Client(timeout=30) as c:
            barrier.wait()
            results[i] = job(c).status_code

    threads = [threading.Thread(target=run, args=(i, j)) for i, j in enumerate(jobs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print(f"{label}: {len(jobs)} requests at once -> {dict(Counter(results))}")
    return results


def overlaps(db_path: Path) -> tuple[list, int, int]:
    """Court-hours claimed by two bookings that should own their hours, the hours owned, and the slot table's rows."""
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    rows = db.execute(f"SELECT code, court_id, start_at, hours FROM bookings WHERE {HOLDS_COURT_SQL}").fetchall()
    owners: dict = {}
    clashes = []
    for r in rows:
        start = datetime.strptime(r["start_at"], "%Y-%m-%dT%H:%M:%SZ")
        for i in range(r["hours"]):
            key = (r["court_id"], start + timedelta(hours=i))
            if key in owners:
                clashes.append((key, owners[key], r["code"]))
            owners[key] = r["code"]
    guard_rows = db.execute("SELECT COUNT(*) FROM booking_slots").fetchone()[0]
    db.close()
    return clashes, len(owners), guard_rows


def half_pairs(db_path: Path) -> list:
    """Two-court bookings that ended up with only one court: there must be none (both courts or nothing)."""
    db = sqlite3.connect(db_path)
    rows = db.execute("SELECT group_id FROM bookings WHERE group_id IS NOT NULL GROUP BY group_id HAVING COUNT(*) != 2").fetchall()
    db.close()
    return [r[0] for r in rows]


def main() -> None:
    data = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="housepickle-stress-"))
    shutil.rmtree(data, ignore_errors=True)
    data.mkdir(parents=True)
    server = start_server(data)
    try:
        play_today = (datetime.now(MANILA) - timedelta(hours=5)).date()
        day = (play_today + timedelta(days=1)).isoformat()  # tomorrow's play day: every hour is still ahead

        login = httpx.post(f"{BASE}/api/admin/login", json={"password": PASSWORD})
        assert login.status_code == 200, login.text
        cookies = dict(login.cookies)
        desk_headers = {"X-HP-Admin": "1"}
        counter = iter(range(1, 10_000))

        def player(court: str | list[str], hour: int, hours: int):
            """One court ("court-1"), or both at once (["court-1", "court-2"])."""
            n = next(counter)
            ip = f"10.0.{n // 250}.{n % 250 + 1}"  # a different phone each time
            body = {
                "date": day, "hour": hour, "hours": hours, "paddles": False,
                "customerName": f"Player {n}", "customerPhone": "0917 123 4567", "paymentMethod": "gcash",
                "consent": True, "consentVersion": "2026-10-v1",
                **({"courtIds": court} if isinstance(court, list) else {"courtId": court}),
            }
            return lambda c: c.post(f"{BASE}/api/bookings", json=body, headers={"X-Forwarded-For": ip})

        both = ["court-1", "court-2"]

        def desk_add(court: str, hour: int, hours: int, kind: str = "walk_in"):
            body = {"kind": kind, "courtId": court, "date": day, "hour": hour, "hours": hours,
                    "customerName": f"Desk {kind} {hour}", "customerPhone": "", "paymentMethod": "cash"}
            return lambda c: c.post(f"{BASE}/api/admin/bookings", json=body, headers=desk_headers, cookies=cookies)

        def desk_move(code: str, **changes):
            return lambda c: c.patch(f"{BASE}/api/admin/bookings/{code}", json=changes, headers=desk_headers, cookies=cookies)

        # Wave 1: 40 phones and 10 desk taps all want Court 1 at 7 PM.
        w1 = fire("Wave 1 (one court-hour, players + desk)", [player("court-1", 19, 1) for _ in range(40)] + [desk_add("court-1", 19, 1) for _ in range(10)])
        assert w1.count(201) == 1, "more than one booking won Court 1 at 7 PM"

        # Wave 2: overlapping lengths on Court 2, players and desk (walk-ins and blocks) mixed.
        jobs = []
        for _ in range(6):
            jobs += [player("court-2", 18, 3), player("court-2", 19, 2), player("court-2", 20, 1), player("court-2", 20, 2), player("court-2", 21, 1)]
        jobs += [desk_add("court-2", 17, 3), desk_add("court-2", 19, 1), desk_add("court-2", 20, 3, "block"), desk_add("court-2", 21, 2)] * 3
        w2 = fire("Wave 2 (overlapping 1-3 h bookings on Court 2)", jobs)

        # Wave 3: the desk moves a booking onto 10 PM while 15 phones book Court 1 at 10 PM.
        with httpx.Client() as c:
            existing = desk_add("court-1", 10, 1)(c).json()["code"]
        w3 = fire("Wave 3 (desk edit vs players for Court 1, 10 PM)", [desk_move(existing, hour=22)] + [player("court-1", 22, 1) for _ in range(15)])
        assert sum(1 for s in w3 if s in (200, 201)) == 1, "more than one booking won Court 1 at 10 PM"

        # Wave 4: both courts at once (8-10 AM) against one-court bookings inside those hours, on either court.
        jobs = [player(both, 8, 2) for _ in range(20)]
        jobs += [player("court-1", 9, 1) for _ in range(8)] + [player("court-2", 8, 1) for _ in range(8)] + [desk_add("court-2", 9, 1)] * 4
        w4 = fire("Wave 4 (two courts vs one court, 8-10 AM)", jobs)
        pairs_won = sum(1 for s in w4[:20] if s == 201)
        assert pairs_won <= 1, "two bookings of both courts won the same hours"
        if pairs_won:  # then nothing else got in
            assert sum(1 for s in w4[20:] if s == 201) == 0, "a one-court booking got in beside a two-court one"

        # Wave 5: two-court bookings of different lengths overlapping each other and one-court bookings, 12-3 PM.
        jobs = []
        for _ in range(5):
            jobs += [player(both, 12, 1), player(both, 12, 2), player(both, 13, 2), player("court-1", 14, 1), player("court-2", 13, 1)]
        jobs += [desk_add("court-1", 12, 1), desk_add("court-2", 14, 1, "block")] * 2
        w5 = fire("Wave 5 (overlapping two-court bookings, 12-3 PM)", jobs)

        clashes, owned, guard_rows = overlaps(data / "housepickle.db")
        broken = half_pairs(data / "housepickle.db")
        fired = len(w1) + len(w2) + len(w3) + len(w4) + len(w5)
        print(f"\nRequests fired: {fired} | court-hours owned: {owned} | slot-table rows: {guard_rows}")
        print("Court-hours owned by two bookings:", clashes or "none")
        print("Two-court bookings left with one court:", broken or "none")
        assert not clashes and guard_rows == owned and not broken
        print("RESULT: no double booking under simultaneous load.")
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    main()
