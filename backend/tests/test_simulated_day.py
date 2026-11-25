"""Scripted days at the club (S4 in IMPLEMENTATION_PLAN.md), played on the test clock without waiting.

Players book one court or both (release 4), pay (some after their timer), walk away or never pay; the desk adds walk-ins,
phone bookings and blocks, edits, marks arrivals (and sometimes forgets), restores, voids and rejects (one court of a pair
or both), and calls rain delays; rain-delayed guests pick a new time. After every step these must hold:

1. no court-hour belongs to two bookings that hold the court (worked out from the bookings, not the slot table);
2. the slot table holds exactly the hours of the bookings that should hold the court, and nothing else;
3. a payment reference backs at most one booking, a two-court one counting as one (its payment is on its first court);
4. every filter chip's number equals what it lists, for every date choice;
5. no unpaid hold is left waiting past its deadline, and the courts of a two-court hold are held and let go together.

"Should hold the court" is `booking_service.holds_court`, the one definition the app, this test and the load test
share. One fixed day plus 50 random days from fixed seeds: a failure names its seed and step, so it can be replayed with
`pytest tests/test_simulated_day.py -k seed_17`. `SIM_DAYS=200` plays more random days.
"""

from __future__ import annotations

import os
import random
from collections import Counter
from datetime import date, datetime, timedelta

import pytest

from app import admin_service, booking_service as core, ratelimit, reschedule, weather
from app.admin_schemas import AdminCreateIn, AdminUpdateIn, RainDelayIn
from app.clock import MANILA, from_iso, to_iso
from app.config import settings
from app.db import connect, init_db
from app.errors import BookingError
from app.schemas import CreateBookingIn, ReferenceProofIn, RescheduleIn
from app.slots import DAY_START_HOUR, current_play_date, play_date_of, slot_start
from app.validation import REFERENCE_REJECTED, normalize_reference

SIM_DAYS = int(os.getenv("SIM_DAYS", "50"))
COURTS = ("court-1", "court-2")
PHONES = [f"0917{n:07d}" for n in (1234567, 2345678, 3456789, 4567890, 5678901, 6789012)]
NAMES = ["Maria Santos", "Pedro Penduko", "Ana Reyes", "Carlo Dizon", "Liza Tan", "Juan dela Cruz", "Grace Lim", "Ben Ocampo"]
LABELS = admin_service.LABELS  # paid, late, done, rain_delay, blocked, paid_late
STATUS_LABELS = {"held": "awaiting", "rejected": "rejected", "cancelled": "cancelled"}  # the status chips, and their label
# What a player may hear back when paying. A payment after the timer may be turned away (or kept for the host), and the
# desk may have sorted the booking out already.
PAY_REPLIES = {"hold_expired", "paid_after_expiry", "not_held", "already_submitted", "reference_locked"}


@pytest.fixture
def conn(fake_now):
    init_db()
    c = connect()
    c.executescript(
        "DELETE FROM booking_access; DELETE FROM booking_slots; DELETE FROM bookings; DELETE FROM spent_payments;"
        "DELETE FROM admin_events; DELETE FROM receipt_scans; DELETE FROM notices_sent;"
    )
    ratelimit.reset()
    weather.reset()
    yield c
    c.close()


def attempt(fn, *args, **kwargs):
    """Run one action. A refusal (taken, too late, not allowed now) is part of a normal day: it returns None."""
    try:
        return fn(*args, **kwargs)
    except BookingError:
        return None


class Day:
    """One day at the club, from 5 AM to 5 AM the next morning."""

    def __init__(self, conn, clock, rng: random.Random, name: str, start: date = date(2026, 10, 10)):
        self.conn, self.clock, self.rng, self.name = conn, clock, rng, name
        self.step = 0
        self.order: dict[str, int] = {}  # booking code -> when we made it (so random picks replay the same way)
        self.holds: list[dict] = []  # unpaid online holds, and what their player will do and when
        self.refs: list[str] = []  # references already used for a payment
        self.last_refusal: str | None = None  # why the last booking attempt was turned away
        clock.current = slot_start(start, DAY_START_HOUR)
        self.end = slot_start(start + timedelta(days=1), DAY_START_HOUR)

    # ── Time ──────────────────────────────────────────────────────────────────
    @property
    def now(self) -> datetime:
        return self.clock.current

    def advance(self, **kw) -> None:
        """Move the clock on. Players act at their own moment on the way, not at the end of the step."""
        target = min(self.now + timedelta(**kw), self.end)
        for h in sorted((h for h in self.holds if h["at"] and h["at"] <= target), key=lambda h: (h["at"], self.order[h["code"]])):
            if h in self.holds:
                self.clock.current = max(self.now, h["at"])
                self.player_acts(h)
        self.clock.current = target

    def hour_from_now(self, ahead: int) -> tuple[date, int]:
        """The play day and hour of the slot starting `ahead` whole hours after the current hour began."""
        start = self.now.astimezone(MANILA).replace(minute=0, second=0, microsecond=0) + timedelta(hours=ahead)
        return play_date_of(start), start.hour

    # ── Bookkeeping ───────────────────────────────────────────────────────────
    def remember(self, code: str | None) -> str | None:
        if code and code not in self.order:
            self.order[code] = len(self.order)
        return code

    def rows(self, where: str = "1", *args) -> list:
        rows = self.conn.execute(f"SELECT * FROM bookings WHERE {where}", args).fetchall()
        return sorted(rows, key=lambda r: self.order.get(r["code"], 10**9))

    def pick(self, rows: list):
        return self.rng.choice(rows) if rows else None

    def new_reference(self) -> str:
        while True:
            ref = "".join(self.rng.choice("0123456789") for _ in range(13))
            try:
                ref = normalize_reference(ref)
            except ValueError:  # (one that looks made up: a real receipt wouldn't show it)
                continue
            if ref not in self.refs:
                return ref

    # ── Players ───────────────────────────────────────────────────────────────
    def player_books(
        self, ahead=None, hours=None, court=None, plan=None, phone=None, acts_after: int | None = None, courts: list[str] | None = None
    ) -> str | None:
        """A player holds a slot: one court, or (`courts`, or now and then by chance) both. `plan`: pay (in time), late
        (after the timer), leave (lets it go) or ignore (never pays). `acts_after` (seconds) sets the moment exactly."""
        ahead = ahead if ahead is not None else self.rng.choice([1, 1, 2, 3, 4, 6, 9, 14, 20, 26])
        play_date, hour = self.hour_from_now(ahead)
        phone = phone or self.rng.choice(PHONES)
        if courts is None:
            courts = [court] if court else (list(COURTS) if self.rng.random() < 0.2 else [self.rng.choice(COURTS)])
        try:
            booking, token = core.create_booking(self.conn, CreateBookingIn(
                court_ids=courts, date=play_date, hour=hour, hours=hours or self.rng.choice([1, 1, 2, 2, 3]),
                customer_name=self.rng.choice(NAMES), customer_phone=phone, payment_method="gcash",
                consent=True, consent_version=settings.consent_version,
            ), ip=f"phone-{phone[-2:]}")
        except BookingError as exc:
            self.last_refusal = exc.code
            return None
        plan = plan or self.rng.choices(["pay", "late", "leave", "ignore"], weights=[60, 15, 10, 15])[0]
        deadline = from_iso(booking.hold_expires_at)
        acts_at = {
            "pay": self.now + timedelta(seconds=self.rng.randint(30, settings.hold_minutes * 60 - 5)),
            # Mostly within the late-payment window (the hour may still be free, or someone may have taken it), now and
            # then after it.
            "late": deadline + timedelta(seconds=settings.hold_grace_seconds + self.rng.choice([5, 60, 300, 900, 1500, 2400])),
            "leave": self.now + timedelta(seconds=self.rng.randint(10, 300)),
            "ignore": None,
        }[plan]
        if acts_after is not None:
            acts_at = self.now + timedelta(seconds=acts_after)
        self.holds.append({"code": self.remember(booking.code), "token": token, "plan": plan, "at": acts_at, "name": booking.customer_name})
        return booking.code

    def player_acts(self, h: dict) -> None:
        """A player pays, pays after the timer, or lets the slot go."""
        self.holds.remove(h)
        if h["plan"] == "leave":
            attempt(core.release_hold, self.conn, h["code"], h["token"])
            return
        if self.refs and self.rng.random() < 0.1:  # copies an old reference by mistake: always the one quiet reply
            try:
                core.submit_reference(self.conn, h["code"], h["token"], ReferenceProofIn(reference_number=self.rng.choice(self.refs), payer_name=h["name"]))
                raise AssertionError(f"{self.where()}: a used reference paid for a second booking")
            except BookingError as exc:
                assert exc.code in PAY_REPLIES | {"reference_rejected"}, f"{self.where()}: {exc.code}"
                if exc.code == "reference_rejected":
                    assert exc.message == REFERENCE_REJECTED
        ref = self.new_reference()
        try:
            core.submit_reference(self.conn, h["code"], h["token"], ReferenceProofIn(reference_number=ref, payer_name=h["name"]))
            self.refs.append(ref)
        except BookingError as exc:
            assert exc.code in PAY_REPLIES, f"{self.where()}: paying got {exc.code}"
            if exc.code == "paid_after_expiry":  # kept on record for the host: that reference is used now
                self.refs.append(ref)

    def guests_rebook(self) -> None:
        asked: set[str] = set()
        for row in self.rows("status = 'confirmed' AND weather_hold_at IS NOT NULL"):
            if (row["group_id"] or row["code"]) in asked:
                continue  # both courts of one booking: the guest moves it once (and it takes both along)
            asked.add(row["group_id"] or row["code"])
            if self.rng.random() < 0.5 and row["customer_phone"]:
                play_date, hour = self.hour_from_now(self.rng.randint(2, 30))
                attempt(reschedule.reschedule, self.conn, RescheduleIn(
                    code=row["code"], customer_phone=row["customer_phone"], court_id=self.rng.choice(COURTS), date=play_date, hour=hour,
                ), None)

    # ── The desk ──────────────────────────────────────────────────────────────
    def desk_adds(self, ahead: int = 0, hours: int = 1, court: str | None = None, kind: str = "walk_in", name: str | None = None) -> str | None:
        play_date, hour = self.hour_from_now(ahead)
        res = attempt(admin_service.create, self.conn, AdminCreateIn(
            kind=kind, court_id=court or self.rng.choice(COURTS), date=play_date, hour=hour, hours=hours,
            customer_name=name or ("Net repair" if kind == "block" else self.rng.choice(NAMES)),
            customer_phone="" if kind == "block" else self.rng.choice(PHONES + [""]), payment_method="cash",
        ))
        return self.remember(res.code) if res else None

    def desk_marks_arrivals(self, forget: float = 0.25) -> None:
        """The desk taps Arrived for groups that are starting or playing (a Late one too: it ends the Late), but misses
        some."""
        soon = to_iso(self.now + timedelta(minutes=30))
        for row in self.rows("status = 'confirmed' AND source != 'blocked' AND arrived_at IS NULL AND released_at IS NULL "
                             "AND weather_hold_at IS NULL AND start_at <= ?", soon):
            if from_iso(row["start_at"]) + timedelta(hours=row["hours"]) > self.now and self.rng.random() >= forget:
                attempt(admin_service.mark_arrived, self.conn, row["code"])

    def desk_releases(self, chance: float = 0.4) -> None:
        """Release court for some Late groups, and Open these hours for some rain delays."""
        for row in self.rows("status = 'confirmed' AND released_at IS NULL AND (late_at IS NOT NULL OR weather_hold_at IS NOT NULL)"):
            if self.rng.random() < chance:
                attempt(admin_service.release, self.conn, row["code"], None)

    def desk_edits(self) -> None:
        row = self.pick(self.rows("status IN ('held', 'confirmed') AND start_at > ?", to_iso(self.now)))
        if row is None:
            return
        change = self.rng.choice(["hour", "court", "hours"])
        start = from_iso(row["start_at"]).astimezone(MANILA)
        if change == "hour":
            moved = start + timedelta(hours=self.rng.choice([-2, -1, 1, 2]))
            if moved <= self.now:
                return
            body = AdminUpdateIn(date=play_date_of(moved), hour=moved.hour)
        elif change == "court":
            body = AdminUpdateIn(court_id="court-2" if row["court_id"] == "court-1" else "court-1")
        else:
            body = AdminUpdateIn(hours=self.rng.randint(1, 3))
        attempt(admin_service.update, self.conn, row["code"], body)

    def desk_restores(self) -> None:
        """Undo a release for a group that turned up after all, and now and then undo a rain delay."""
        for row in self.rows("status = 'confirmed' AND (late_at IS NOT NULL OR weather_hold_at IS NOT NULL)"):
            if self.rng.random() < (0.5 if row["late_at"] and not row["weather_hold_at"] else 0.15):
                attempt(admin_service.restore, self.conn, row["code"], "Turned up")

    def desk_calls_rain(self, hours: int | None = None) -> None:
        play_date, hour = self.hour_from_now(0)
        attempt(admin_service.rain_delay, self.conn, RainDelayIn(date=play_date, from_hour=hour, hours=hours or self.rng.randint(1, 4)))

    def desk_sorts_something_out(self) -> None:
        """The rarer desk actions: void, reject a payment, confirm an unpaid hold, delete a record."""
        action = self.rng.choice(["void", "reject", "confirm", "delete"])
        both = self.rng.random() < 0.5  # for a two-court booking: both courts, or only the one picked
        if action == "void":
            row = self.pick(self.rows("status = 'confirmed'"))
            if row:
                attempt(admin_service.cancel, self.conn, row["code"], "Duplicate", both_courts=both)
        elif action == "reject":
            row = self.pick(self.rows("status = 'confirmed' AND source = 'online' AND submitted_at IS NOT NULL"))
            if row:
                attempt(admin_service.reject, self.conn, row["code"], "Not in the app", both_courts=both)
        elif action == "confirm":  # paid the host in person: the player has nothing left to do
            row = self.pick(self.rows("status = 'held'"))
            if row:
                codes = {r["code"] for r in core.group_rows(self.conn, row)}  # (the player knows it by its first court)
                attempt(admin_service.confirm, self.conn, row["code"])
                self.holds = [h for h in self.holds if h["code"] not in codes]
        else:
            row = self.pick(self.rows("status != 'held'"))
            if row:  # (its payment stays spent: the strict check in player_acts proves it)
                attempt(admin_service.delete, self.conn, row["code"])

    # ── After every step ──────────────────────────────────────────────────────
    def where(self) -> str:
        return f"{self.name}, step {self.step} ({self.now.astimezone(MANILA):%a %H:%M:%S})"

    def settle(self, full: bool = False) -> None:
        """The background sweep runs, then everything is checked. The chips are checked for "All dates" every step, and
        for every date choice, chip by chip, every 12th step and at the end of the day (that part is the slow one)."""
        self.step += 1
        core.sweep(self.conn)
        self.check_court_hours()
        self.check_references()
        self.check_no_stuck_holds()
        self.check_chips(full=full or self.step % 12 == 0)

    def check_court_hours(self) -> None:
        owners: dict[tuple[str, str], str] = {}
        for row in self.conn.execute("SELECT * FROM bookings ORDER BY code").fetchall():
            if not core.holds_court(row):
                continue
            start = from_iso(row["start_at"])
            for i in range(row["hours"]):
                key = (row["court_id"], to_iso(start + timedelta(hours=i)))
                assert key not in owners, f"{self.where()}: {key} belongs to both {owners[key]} and {row['code']}"  # 1
                owners[key] = row["code"]
        slots = {
            (s["court_id"], s["slot_start"]): s["code"]
            for s in self.conn.execute("SELECT s.court_id, s.slot_start, b.code FROM booking_slots s JOIN bookings b ON b.id = s.booking_id")
        }
        assert slots == owners, f"{self.where()}: the slot table and the bookings disagree: {sorted(set(slots.items()) ^ set(owners.items()))}"  # 2

    def check_references(self) -> None:
        twice = self.conn.execute(
            "SELECT reference_number FROM bookings WHERE reference_number IS NOT NULL GROUP BY reference_number HAVING COUNT(*) > 1"
        ).fetchall()
        assert not twice, f"{self.where()}: references on two bookings: {[r[0] for r in twice]}"  # 3
        # A two-court booking is one booking: its payment is kept on its first court only.
        copied = self.conn.execute(
            """SELECT code FROM bookings WHERE group_id IS NOT NULL AND group_id != id
                 AND (reference_number IS NOT NULL OR receipt_sha256 IS NOT NULL)"""
        ).fetchall()
        assert not copied, f"{self.where()}: a second court stores the payment too: {[r[0] for r in copied]}"  # 3

    def check_no_stuck_holds(self) -> None:
        overdue = to_iso(self.now - timedelta(seconds=settings.hold_grace_seconds))
        stuck = self.conn.execute("SELECT code FROM bookings WHERE status = 'held' AND hold_expires_at <= ?", (overdue,)).fetchall()
        assert not stuck, f"{self.where()}: holds still waiting past their deadline: {[r[0] for r in stuck]}"  # 5
        # The courts of a two-court hold share one timer: all of them still held, or none.
        split = self.conn.execute(
            """SELECT group_id FROM bookings WHERE group_id IS NOT NULL GROUP BY group_id
               HAVING SUM(status = 'held') > 0 AND SUM(status != 'held') > 0"""
        ).fetchall()
        assert not split, f"{self.where()}: a two-court hold came apart: {[r[0] for r in split]}"  # 5

    def check_chips(self, full: bool) -> None:
        today = current_play_date(self.now)
        for dates in ([{}, {"date_from": today}, {"date_to": today - timedelta(days=1)}] if full else [{}]):
            def listing(**kw):
                return admin_service.list_bookings(
                    self.conn, q=None, status=kw.get("status"), label=kw.get("label"), date_from=dates.get("date_from"),
                    date_to=dates.get("date_to"), court_id=None, sort="upcoming_first", page=1, page_size=1,
                )

            everything = listing()
            counts = everything.counts.model_dump()
            # The word each booking in the date range shows on the desk (the same function the list uses for each row).
            lo = to_iso(slot_start(dates["date_from"], DAY_START_HOUR)) if "date_from" in dates else ""
            hi = to_iso(slot_start(dates["date_to"] + timedelta(days=1), DAY_START_HOUR)) if "date_to" in dates else "~"
            shown = Counter(
                admin_service.label_of(r, self.now) for r in self.conn.execute("SELECT * FROM bookings").fetchall() if lo <= r["start_at"] < hi
            )
            at = f"{self.where()} {dates}"
            assert everything.total == counts["all"], f"{at}: All lists {everything.total} but says {counts['all']}"  # 4
            assert counts["all"] == sum(n for label, n in shown.items() if label != "expired"), f"{at}: All isn't every chip but Expired"
            for label in LABELS:
                assert shown[label] == counts[label], f"{at}: {shown[label]} show {label} but the chip says {counts[label]}"
            for status, label in STATUS_LABELS.items():
                assert shown[label] == counts[status], f"{at}: {shown[label]} show {label} but the chip says {counts[status]}"
            # Expired lists every hold that ran out, the ones paid after their time included.
            assert shown["expired"] + shown["paid_late"] == counts["expired"], f"{at}: the Expired chip"
            if full:  # and tapping each chip lists exactly that many
                for label in LABELS:
                    assert listing(label=label).total == counts[label], f"{at}: chip {label}"
                for status in (*STATUS_LABELS, "expired"):
                    assert listing(status=status).total == counts[status], f"{at}: chip {status}"

    def close(self) -> None:
        """Past the end of the day and every timer: nothing may be left waiting."""
        self.clock.current = self.end + timedelta(minutes=settings.hold_minutes, seconds=settings.hold_grace_seconds + 1)
        self.settle(full=True)
        assert not self.rows("status = 'held'"), f"{self.where()}: unpaid holds never settled"


# ── The fixed day ─────────────────────────────────────────────────────────────
def test_a_fixed_day(conn, fake_now):
    day = Day(conn, fake_now, random.Random(0), "fixed day")  # Sat Oct 10, from 5:00 AM
    phones = (f"0918{n:07d}" for n in range(1000, 1100))  # a phone of its own for every player (one hold cap each)
    status = lambda code: conn.execute("SELECT * FROM bookings WHERE code = ?", (code,)).fetchone()  # noqa: E731
    slots_of = lambda code: [r[0] for r in conn.execute(  # noqa: E731
        "SELECT s.slot_start FROM booking_slots s JOIN bookings b ON b.id = s.booking_id WHERE b.code = ? ORDER BY 1", (code,)
    )]
    assert day.desk_adds(ahead=0, court="court-1", name="Early bird")  # 5-6 AM, at the desk now
    rain_phone = next(phones)
    rained_out = day.player_books(ahead=11, hours=1, court="court-2", plan="pay", phone=rain_phone)  # 4 PM: rained out later
    group = day.player_books(ahead=14, hours=3, court="court-1", plan="pay", phone=next(phones))  # 7-10 PM: goes Late
    assert rained_out and group
    assert day.player_books(ahead=13, hours=1, court="court-2", plan="ignore", phone=next(phones))  # 6 PM, never pays
    revived = day.player_books(ahead=15, hours=1, court="court-2", plan="late", phone=next(phones), acts_after=11 * 60)  # 8 PM, 1 min late
    slow = day.player_books(ahead=13, hours=1, court="court-1", plan="late", phone=next(phones), acts_after=14 * 60)  # 6 PM, 4 min late
    assert revived and slow, day.last_refusal
    assert day.desk_adds(ahead=16, hours=2, court="court-2", name="Phone group")  # 9-11 PM, booked by phone
    assert day.desk_adds(ahead=8, court="court-1", kind="block")  # 1 PM: net repair
    assert day.desk_adds(ahead=18, hours=3, court="court-1", name="Night owls")  # 11 PM - 2 AM
    assert day.desk_adds(ahead=23, court="court-2", name="Last game")  # 4 AM
    # Both courts at once: 10 AM - 12 PM is free on both. 4 PM is free on Court 1 only (Court 2 has the rained-out
    # booking), so a two-court booking then takes nothing.
    pair = day.player_books(ahead=5, hours=2, plan="pay", phone=next(phones), courts=list(COURTS))
    assert pair, day.last_refusal
    assert day.player_books(ahead=11, hours=1, plan="pay", phone=next(phones), courts=list(COURTS)) is None
    assert day.last_refusal == "slot_taken"
    day.settle(full=True)
    # 5:12: the slow payer's hold has run out, and a fast one takes 6 PM on Court 1 before the money arrives.
    day.advance(minutes=12)
    fast = day.player_books(ahead=13, hours=1, court="court-1", plan="pay", phone=next(phones))
    assert fast, f"6 PM on Court 1 should be free again once the slow payer's hold ran out ({day.last_refusal})"
    day.settle()
    day.advance(minutes=8)  # 5:20: both late payers have paid
    day.settle()
    assert status(revived)["status"] == "confirmed"  # the hour was still free: taken back
    assert status(slow)["status"] == "expired" and status(slow)["paid_late_at"]  # it wasn't: kept for the host
    # One payment confirmed both courts of the pair, and its reference is stored once.
    both = conn.execute("SELECT * FROM bookings WHERE group_id = ? ORDER BY court_id", (status(pair)["id"],)).fetchall()
    assert [(r["court_id"], r["status"]) for r in both] == [("court-1", "confirmed"), ("court-2", "confirmed")]
    assert [bool(r["reference_number"]) for r in both] == [True, False]
    assert sorted(slots_of(both[0]["code"]) + slots_of(both[1]["code"])) == sorted(
        [to_iso(slot_start(date(2026, 10, 10), h)) for h in (10, 11)] * 2
    )

    while day.now < day.end:
        day.advance(minutes=10)
        hour, minute = day.now.astimezone(MANILA).hour, day.now.minute
        if (hour, minute) == (15, 0):
            day.desk_calls_rain(hours=2)  # rain closes the courts 3-5 PM
            assert status(rained_out)["weather_hold_at"] and core.holds_court(status(rained_out))
            assert day.player_books(ahead=1, hours=1, court="court-2", phone=next(phones)) is None  # its 4 PM stays closed
            assert day.last_refusal == "slot_taken"
        if (hour, minute) == (17, 0):  # the rained-out guest picks tomorrow 10 AM: the old hours go, the new are taken
            old = slots_of(rained_out)
            reschedule.reschedule(conn, RescheduleIn(code=rained_out, customer_phone=rain_phone, court_id="court-2",
                                                    date=date(2026, 10, 11), hour=10), None)
            assert old and slots_of(rained_out) == [to_iso(slot_start(date(2026, 10, 11), 10))]
        # Nobody taps Arrived for the 7-10 PM group, so it goes Late at 7:15 and keeps its court.
        day.desk_marks_arrivals(forget=1.0 if hour in (18, 19) else 0.0)
        if (hour, minute) == (19, 20):
            core.sweep(conn)  # (the background sweep marks it Late)
            assert status(group)["late_at"] and core.holds_court(status(group)) and len(slots_of(group)) == 3
            assert day.player_books(ahead=2, hours=1, court="court-1", phone=next(phones)) is None  # 9 PM is still theirs
            assert day.last_refusal == "slot_taken"
        if (hour, minute) == (19, 30):
            assert admin_service.release(conn, group, "Never came").released_at  # the host decides: release the court
            assert slots_of(group) == []
            assert day.player_books(ahead=2, hours=1, court="court-1", plan="pay", phone=next(phones)), day.last_refusal  # now 9 PM sells
        day.settle()
    day.close()


# ── Random days ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize("seed", range(SIM_DAYS), ids=lambda s: f"seed_{s}")
def test_a_random_day(conn, fake_now, seed):
    rng = random.Random(seed)
    day = Day(conn, fake_now, rng, f"random day seed {seed}", start=date(2026, 10, 10) + timedelta(days=rng.randint(0, 6)))
    while day.now < day.end:
        day.advance(minutes=rng.choice([5, 10, 15, 20, 30]))
        for _ in range(rng.randint(0, 3)):
            action = rng.choices(
                ["book", "walk_in", "phone", "block", "edit", "release", "restore", "rain", "rebook", "other"],
                weights=[40, 10, 12, 3, 8, 6, 6, 2, 6, 4],
            )[0]
            if action == "book":
                day.player_books()
            elif action == "walk_in":
                day.desk_adds(ahead=0, hours=rng.randint(1, 2))
            elif action == "phone":
                day.desk_adds(ahead=rng.randint(1, 12), hours=rng.randint(1, 3))
            elif action == "block":
                day.desk_adds(ahead=rng.randint(1, 8), hours=rng.randint(1, 3), kind="block")
            elif action == "edit":
                day.desk_edits()
            elif action == "release":
                day.desk_releases()
            elif action == "restore":
                day.desk_restores()
            elif action == "rain":
                day.desk_calls_rain()
            elif action == "rebook":
                day.guests_rebook()
            else:
                day.desk_sorts_something_out()
        day.desk_marks_arrivals(forget=rng.choice([0.0, 0.1, 0.3]))
        day.settle()
    day.close()


def test_holding_a_court_means_the_same_in_sql_and_in_python(conn, fake_now):
    day = Day(conn, fake_now, random.Random(99), "definition check")
    for _ in range(40):
        day.advance(minutes=15)
        day.player_books()
        day.desk_adds(ahead=day.rng.randint(0, 5))
        day.desk_marks_arrivals(forget=0.5)
        if day.rng.random() < 0.1:
            day.desk_calls_rain()
        core.sweep(conn)
    in_sql = {r["code"] for r in conn.execute(f"SELECT code FROM bookings WHERE {core.HOLDS_COURT_SQL}")}
    in_python = {r["code"] for r in conn.execute("SELECT * FROM bookings") if core.holds_court(r)}
    everyone = {r["code"] for r in conn.execute("SELECT code FROM bookings")}
    assert in_sql == in_python
    assert in_sql and everyone - in_sql  # the day had bookings on both sides of the line
