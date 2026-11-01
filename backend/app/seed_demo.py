"""Demo bookings for your own computer, so you can see rebooking and "Check my booking" without waiting for rain.

    cd backend
    .venv\\Scripts\\python -m app.seed_demo

It goes through the same code as a real booking (hold, reference number, rain delay), under one demo phone number, so
running it again first removes the previous demo bookings and makes fresh ones. Real bookings are never touched.
It refuses to run on the live server.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import date, timedelta

from app import admin_service, clock
from app import booking_service as core
from app.admin_schemas import RainDelayIn
from app.config import settings
from app.db import connect, init_db, write_transaction
from app.errors import BookingError, Conflict
from app.schemas import CreateBookingIn, ReferenceProofIn
from app.slots import current_play_date

DEMO_PHONE = "0999 000 0001"
DEMO_PHONE_STORED = "09990000001"  # how it is saved: 09XXXXXXXXX
COURTS = ("court-1", "court-2")


class NotHere(RuntimeError):
    """Refused: this does not look like a development computer."""


def _guard() -> None:
    if os.getenv("RENDER") or str(settings.data_dir).replace("\\", "/").startswith("/var/data"):
        raise NotHere("This looks like the live server. Demo data is for your own computer only.")


def _remove_old(conn: sqlite3.Connection) -> int:
    with write_transaction(conn):
        gone = conn.execute("DELETE FROM bookings WHERE customer_phone = ?", (DEMO_PHONE_STORED,)).rowcount
    return gone


class _Seeder:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.n = 0
        self.rows: list[tuple[str, str, str, str]] = []  # (code, who, when, what you will see)

    def book(self, name: str, day: date, hour: int, hours: int = 1, paddles: bool = False, note: str = "") -> tuple[str, str, int, int]:
        """Hold a slot, trying the next free hour/court if that one is taken (a real dev database is rarely empty)."""
        last: Exception | None = None
        for step in range(0, 12):
            h = hour + step
            if h + hours > 23:
                break
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

    def add(self, code: str, who: str, when: str, sees: str) -> None:
        self.rows.append((code, who, when, sees))


def run() -> list[tuple[str, str, str, str]]:
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
        label = lambda d, h, n=1: f"{d.strftime('%a %b')} {d.day}, {h % 12 or 12}{'AM' if h < 12 else 'PM'}" + (f" ({n} h)" if n > 1 else "")  # noqa: E731

        # Paid and normal: the people "All of tomorrow" on the Weather page would ask to rebook.
        for name, hour, hours, paddles in (("Maria Santos", 9, 1, False), ("Pedro Penduko", 10, 2, False),
                                           ("Ana Reyes", 12, 1, True), ("Carlo Dizon", 19, 1, False)):
            code, h, n = s.paid(name, tomorrow, hour, hours=hours, paddles=paddles)
            s.add(code, name, label(tomorrow, h, n), "Confirmed (rebooking opens only if you call it)")

        code, h, n = s.paid("Liza Tan", later, 8)
        s.add(code, "Liza Tan", label(later, h, n), "Confirmed")

        # Two guests whose hours were already given back for rain: they see "Rebook now".
        rainy = [s.paid("Juan dela Cruz", tomorrow, 15), s.paid("Grace Lim", tomorrow, 16, hours=2)]
        start = min(h for _, h, _ in rainy)
        end = max(h + n for _, h, n in rainy)
        admin_service.rain_delay(
            conn, RainDelayIn(date=tomorrow, from_hour=start, hours=end - start, codes=[c for c, _, _ in rainy], note="Demo: heavy rain")
        )
        for (code, h, n), name in zip(rainy, ("Juan dela Cruz", "Grace Lim")):
            s.add(code, name, label(tomorrow, h, n), "REBOOK NOW (rain delay called): guest sees a Rebook now button")

        # An unpaid slot still on hold, and one whose time ran out.
        code, _, h, n = s.book("Ben Ocampo", later, 14)
        s.add(code, "Ben Ocampo", label(later, h, n), "Awaiting payment (a hold lasts 10 minutes, then it expires)")

        code, _, h, n = s.book("Ella Cruz", later, 16)
        conn.execute("UPDATE bookings SET hold_expires_at = ? WHERE code = ?", (clock.to_iso(now - timedelta(hours=1)), code))
        with write_transaction(conn):
            core.release_expired(conn, now)
        s.add(code, "Ella Cruz", label(later, h, n), "Expired (the payment time ran out)")
        return s.rows
    finally:
        conn.close()


def main() -> None:
    try:
        rows = run()
    except NotHere as exc:
        raise SystemExit(str(exc))
    print(f"Demo bookings are ready in {settings.db_path}\n")
    width = max(len(r[1]) for r in rows)
    for code, who, when, sees in rows:
        print(f"  {code}  {who:<{width}}  {when:<22} {sees}")
    print(
        f"\nTry it:\n"
        f"  Guest : open the site > Check my booking > a code above + mobile {DEMO_PHONE}\n"
        f"  Admin : /admin > Weather > Rebook guests > All of tomorrow (asks the 'Confirmed' guests to rebook)\n"
        f"Run this again any time for fresh demo bookings."
    )


if __name__ == "__main__":
    main()
