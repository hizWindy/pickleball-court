"""Demo bookings for your own computer, so you can see every state on the desk and the site without waiting for one.

    cd backend
    .venv\\Scripts\\python -m app.seed_demo            # every state, plus the hours that are easy to get wrong
    .venv\\Scripts\\python -m app.seed_demo --many     # ...and 270 more walk-ins, to try "Show more" past 200

It goes through the same code as a real booking (hold, reference number, desk, rain delay), under one demo phone number
(blocks carry a demo note instead, as they have no phone), so running it again first removes the previous demo bookings
and makes fresh ones. Real bookings are never touched. It refuses to run on the live server.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
from datetime import date, timedelta

from app import admin_service, clock
from app import booking_service as core
from app.admin_schemas import AdminCreateIn, RainDelayIn
from app.clock import MANILA, to_iso
from app.config import settings
from app.db import connect, init_db, write_transaction
from app.errors import BookingError, Conflict
from app.schemas import CreateBookingIn, ReferenceProofIn
from app.slots import PLAY_DAY_HOURS, current_play_date, play_date_of

DEMO_PHONE = "0999 000 0001"
DEMO_PHONE_STORED = "09990000001"  # how it is saved: 09XXXXXXXXX
DEMO_NOTE = "Demo data (python -m app.seed_demo)"
COURTS = ("court-1", "court-2")
MANY = 270  # walk-ins added by --many: more than the 200 the server sends at once


class NotHere(RuntimeError):
    """Refused: this does not look like a development computer."""


def _guard() -> None:
    if os.getenv("RENDER") or str(settings.data_dir).replace("\\", "/").startswith("/var/data"):
        raise NotHere("This looks like the live server. Demo data is for your own computer only.")


def _remove_old(conn: sqlite3.Connection) -> int:
    with write_transaction(conn):
        gone = conn.execute(
            "DELETE FROM bookings WHERE customer_phone = ? OR admin_note = ?", (DEMO_PHONE_STORED, DEMO_NOTE)
        ).rowcount
    return gone


def _label(d: date, h: int, n: int = 1) -> str:
    return f"{d.strftime('%a %b')} {d.day}, {h % 12 or 12}{'AM' if h < 12 else 'PM'}" + (f" ({n} h)" if n > 1 else "")


class _Seeder:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.n = 0
        self.rows: list[tuple[str, str, str, str]] = []  # (code, who, when, what you will see)

    def book(self, name: str, day: date, hour: int, hours: int = 1, paddles: bool = False) -> tuple[str, str, int, int]:
        """Hold a slot, trying the next free hour/court if that one is taken (a real dev database is rarely empty)."""
        last: Exception | None = None
        first = PLAY_DAY_HOURS.index(hour)
        for i in range(first, min(first + 12, len(PLAY_DAY_HOURS) - hours + 1)):  # never past the end of the play day
            h = PLAY_DAY_HOURS[i]
            for court in COURTS:
                self.n += 1
                try:
                    booking, token = core.create_booking(
                        self.conn,
                        CreateBookingIn(
                            court_id=court, date=day, hour=h, hours=hours, paddles=paddles, customer_name=name,
                            customer_phone=DEMO_PHONE, payment_method="gcash", consent=True,
                            consent_version=settings.consent_version,
                        ),
                        ip=f"demo-{self.n}",
                    )
                    return booking.code, token, h, hours
                except (Conflict, BookingError) as exc:  # slot taken: try the next one
                    last = exc
        raise RuntimeError(f"No free slot found for {name} on {day}: {last}")

    def demo_reference(self) -> str:
        """A made-up 13-digit reference that starts 9990 (so it is easy to spot) and passes the same checks a real one must."""
        return f"9990{(self.n * 7919 + 4817305) % 10**9:09d}"

    def paid(self, name: str, day: date, hour: int, **kw) -> tuple[str, int, int]:
        code, token, h, hours = self.book(name, day, hour, **kw)
        core.submit_reference(self.conn, code, token, ReferenceProofIn(reference_number=self.demo_reference(), payer_name=name))
        return code, h, hours

    def desk(self, name: str, day: date, hour: int, hours: int = 1, court: str = "court-1", kind: str = "walk_in") -> str | None:
        """Added at the desk (a walk-in, a phone booking or a block). None when that court-hour is already taken."""
        try:
            return admin_service.create(self.conn, AdminCreateIn(
                kind=kind, court_id=court, date=day, hour=hour, hours=hours, customer_name=name,
                customer_phone="" if kind == "block" else DEMO_PHONE, payment_method="cash", note=DEMO_NOTE,
            )).code
        except Conflict:
            return None

    def add(self, code: str | None, who: str, when: str, sees: str) -> None:
        if code:
            self.rows.append((code, who, when, sees))


def run(many: bool = False) -> list[tuple[str, str, str, str]]:
    """Make the demo bookings. Returns (code, player, when, what you will see) for each."""
    _guard()
    init_db()
    now = clock.now()
    today = current_play_date(now)
    tomorrow, later = today + timedelta(days=1), today + timedelta(days=2)
    conn = connect()
    try:
        _remove_old(conn)
        s = _Seeder(conn)

        # Paid and normal: the people "All of tomorrow" on the Weather page would ask to rebook.
        for name, hour, hours, paddles in (("Maria Santos", 9, 1, False), ("Pedro Penduko", 10, 2, False),
                                           ("Ana Reyes", 12, 1, True), ("Carlo Dizon", 19, 1, False)):
            code, h, n = s.paid(name, tomorrow, hour, hours=hours, paddles=paddles)
            s.add(code, name, _label(tomorrow, h, n), "Confirmed (rebooking opens only if you call it)")

        code, h, n = s.paid("Liza Tan", later, 8)
        s.add(code, "Liza Tan", _label(later, h, n), "Confirmed")

        # Two guests whose booking was rain-delayed: they see "Rebook now".
        rainy = [s.paid("Juan dela Cruz", tomorrow, 15), s.paid("Grace Lim", tomorrow, 16, hours=2)]
        start = min(h for _, h, _ in rainy)
        end = max(h + n for _, h, n in rainy)
        admin_service.rain_delay(
            conn, RainDelayIn(date=tomorrow, from_hour=start, hours=end - start, codes=[c for c, _, _ in rainy], note="Demo: heavy rain")
        )
        for (code, h, n), name in zip(rainy, ("Juan dela Cruz", "Grace Lim")):
            s.add(code, name, _label(tomorrow, h, n), "REBOOK NOW (rain delay called): guest sees a Rebook now button")

        # An unpaid slot still on hold, and one whose time ran out.
        code, _, h, n = s.book("Ben Ocampo", later, 14)
        s.add(code, "Ben Ocampo", _label(later, h, n), f"Awaiting payment (a hold lasts {settings.hold_minutes} minutes, then it expires)")

        code, _, h, n = s.book("Ella Cruz", later, 16)
        conn.execute("UPDATE bookings SET hold_expires_at = ? WHERE code = ?", (to_iso(now - timedelta(hours=1)), code))
        with write_transaction(conn):
            core.release_expired(conn, now)
        s.add(code, "Ella Cruz", _label(later, h, n), "Expired (the payment time ran out; under More → Expired)")

        # The hours that are easy to get wrong, on both courts: the first (5 AM) and last (4 AM) of the play day, the
        # busiest (7 PM), and one that runs past midnight. Each must sit in the row with its own label on the Schedule.
        for hour in (5, 19, 4):
            for court in COURTS:
                name = f"Edge {_label(later, hour)} {court[-1]}"
                s.add(s.desk(name, later, hour, court=court), name, _label(later, hour), f"Walk-in on Court {court[-1]}: check its Schedule row")
        s.add(s.desk("Night Owls", later, 23, hours=3, court="court-1"), "Night Owls", _label(later, 23, 3), "Walk-in, 11 PM - 2 AM: runs past midnight")

        # A court closed for repairs, and a group that never showed up.
        s.add(s.desk("Net repair", tomorrow, 6, hours=2, court="court-2", kind="block"), "Net repair", _label(tomorrow, 6, 2), "Blocked (under More → Blocked)")
        started = (now - timedelta(minutes=settings.late_after_minutes + 1)).astimezone(MANILA).replace(minute=0, second=0, microsecond=0)
        late = s.desk("No-show group", play_date_of(started), started.hour, hours=3, court="court-2")
        if late:  # added for a time that has begun, so the desk takes them as here: undo that, and let them go Late
            conn.execute("UPDATE bookings SET arrived_at = NULL WHERE code = ?", (late,))
            with write_transaction(conn):
                core.release_expired(conn, now)
        s.add(late, "No-show group", _label(play_date_of(started), started.hour, 3), "Late (nobody tapped Arrived)")

        if many:  # enough walk-ins to page past the 200 the server sends at once, before and after today
            added = 0
            for back in range(-20, 11):
                day = today + timedelta(days=back)
                for hour in (6, 7, 8, 9, 10):
                    for court in COURTS:
                        if added < MANY and s.desk(f"Regular {added + 1}", day, hour, court=court):
                            added += 1
            s.add("—", f"{added} regulars", f"{_label(today - timedelta(days=20), 6)} on", "Walk-ins, for paging")
        return s.rows
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Demo bookings for your own computer.")
    parser.add_argument("--many", action="store_true", help=f"also add {MANY} walk-ins, to try paging past 200")
    args = parser.parse_args()
    try:
        rows = run(many=args.many)
    except NotHere as exc:
        raise SystemExit(str(exc))
    print(f"Demo bookings are ready in {settings.db_path}\n")
    width = max(len(r[1]) for r in rows)
    for code, who, when, sees in rows:
        print(f"  {code:<14} {who:<{width}}  {when:<24} {sees}")
    print(
        f"\nTry it:\n"
        f"  Guest : open the site > Check my booking > a code above + mobile {DEMO_PHONE}\n"
        f"  Admin : /admin > Schedule (the edge hours) and Bookings (every chip)\n"
        f"          /admin > Weather > Rebook guests > All of tomorrow (asks the 'Confirmed' guests to rebook)\n"
        f"Run this again any time for fresh demo bookings."
    )


if __name__ == "__main__":
    main()
