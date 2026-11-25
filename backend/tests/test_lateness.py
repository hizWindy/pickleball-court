"""Late bookings (plan item 8, D1): 15 minutes after the start without Arrived, a booking is Late but keeps its court
until the host decides: Arrived (they're here after all) or Release court (the hours go to others). A release can be
undone for a few minutes, if the hours are still free."""

from datetime import datetime

from app.clock import MANILA, UTC

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def paid(client, booking_payload, **overrides):
    """A booking paid by receipt (OCR is off in tests, so it confirms at once, flagged for a look)."""
    body = client.post("/api/bookings", json=booking_payload(**overrides)).json()
    code, headers = body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}
    res = client.post(f"/api/bookings/{code}/receipt", headers=headers, files={"receipt": ("r.png", PNG + code.encode())})
    assert res.status_code == 200 and res.json()["status"] == "confirmed", res.text
    return code, headers


def slot_state(client, hour, court="court-1", date="2026-10-10"):
    data = client.get("/api/availability", params={"date": date}).json()
    return next(s for s in data["slots"] if s["hour"] == hour)["courts"][court]


def detail(admin, code):
    return admin.get(f"/api/admin/bookings/{code}").json()


def at(fake_now, hour, minute=0):
    """Set the fake clock to Oct 10 `hour:minute` Manila time (it starts at 10:00)."""
    fake_now.current = datetime(2026, 10, 10, hour, minute, tzinfo=MANILA).astimezone(UTC)


def release(admin, code):
    res = admin.post(f"/api/admin/bookings/{code}/release", json={})
    assert res.status_code == 200, res.text
    return res.json()


# ── Going late ────────────────────────────────────────────────────────────────
def test_a_group_not_there_after_15_minutes_is_late_but_keeps_its_court(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)  # 7-9 PM, Court 1
    at(fake_now, 19, 14)
    fake_now.advance(seconds=59)  # 7:14:59
    assert detail(admin, code)["label"] == "paid"

    fake_now.advance(seconds=1)  # 7:15:00
    d = detail(admin, code)
    assert d["label"] == "late" and d["status"] == "confirmed" and d["lateAt"] == "2026-10-10T11:15:00Z"
    assert d["holdsCourt"] is True and d["releasedAt"] is None and d["canRelease"] is True and d["canMarkArrived"] is True
    assert d["events"][0]["action"] == "went_late"
    # 8 PM is still theirs: nobody online can take it.
    assert slot_state(admin, 20) == "booked"
    taken = admin.post("/api/bookings", json=booking_payload(hour=20, customerPhone="09181112222"))
    assert taken.status_code == 409 and taken.json()["error"]["code"] == "slot_taken"
    assert admin.get("/api/admin/counts").json()["late"] == 1  # the desk asks: release the court?


def test_a_group_that_arrived_is_never_late(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)
    at(fake_now, 19, 5)
    b = admin.post(f"/api/admin/bookings/{code}/arrived").json()
    assert b["arrivedAt"] and b["canMarkArrived"] is False
    at(fake_now, 20, 30)
    assert detail(admin, code)["label"] == "paid" and slot_state(admin, 21, court="court-1") == "available"  # 9 PM was never theirs
    at(fake_now, 21, 1)
    assert detail(admin, code)["label"] == "done"  # after the booked time


def test_late_is_judged_from_the_clock_not_from_when_someone_looked(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19)
    at(fake_now, 22)  # nobody opened the desk for three hours
    d = detail(admin, code)
    assert d["label"] == "late" and d["lateAt"] == "2026-10-10T11:15:00Z"
    assert d["canRelease"] is False and d["restorable"] is False  # it's over: nothing to release or restore
    assert admin.get("/api/admin/counts").json()["late"] == 0  # and nothing left to decide


def test_each_filter_count_matches_what_it_lists_for_the_same_dates(admin, booking_payload, fake_now):
    # The desk's chips show `counts` for the chosen dates, and tapping one lists that filter for the same dates.
    late, _ = paid(admin, booking_payload, hour=19)  # nobody comes: Late
    done, _ = paid(admin, booking_payload, hour=20, courtId="court-2")
    paid(admin, booking_payload, date="2026-10-11", hour=18)  # tomorrow evening: still Paid
    at(fake_now, 20, 5)
    admin.post(f"/api/admin/bookings/{done}/arrived")
    fake_now.current = datetime(2026, 10, 11, 10, 0, tzinfo=MANILA).astimezone(UTC)  # the next morning

    def listing(**params):
        return admin.get("/api/admin/bookings", params=params).json()

    for dates, expected in (
        ({"dateFrom": "2026-10-11"}, {"all": 1, "paid": 1, "late": 0, "done": 0}),  # "Today & later"
        ({"dateTo": "2026-10-10"}, {"all": 2, "paid": 0, "late": 1, "done": 1}),  # "Earlier dates"
        ({}, {"all": 3, "paid": 1, "late": 1, "done": 1}),  # "All dates"
    ):
        counts = listing(**dates)["counts"]
        assert {k: counts[k] for k in expected} == expected
        assert listing(**dates)["total"] == counts["all"]
        for label in ("paid", "late", "done", "rain_delay", "blocked", "paid_late"):
            key = {"rain_delay": "rainDelay", "paid_late": "paidLate"}.get(label, label)
            assert listing(label=label, **dates)["total"] == counts[key], (dates, label)
    assert [b["code"] for b in listing(label="late")["items"]] == [late]


def test_walk_ins_added_for_now_are_here_not_late(admin, fake_now):
    body = {"kind": "walk_in", "courtId": "court-1", "date": "2026-10-10", "hour": 10, "hours": 1,
            "customerName": "Maria Santos", "customerPhone": "0918 555 0101", "paymentMethod": "cash"}
    code = admin.post("/api/admin/bookings", json=body).json()["code"]
    fake_now.advance(minutes=30)
    assert detail(admin, code)["label"] == "paid"  # still in its hour, and the group is at the desk
    body.update(hour=15, customerName="Pedro Penduko")
    later = admin.post("/api/admin/bookings", json=body).json()["code"]
    at(fake_now, 15, 16)
    assert detail(admin, later)["label"] == "late"  # booked ahead and never showed up
    assert slot_state(admin, 15) == "past" and detail(admin, later)["holdsCourt"] is True


def test_blocks_are_never_late(admin, fake_now):
    body = {"kind": "block", "courtId": "court-1", "date": "2026-10-10", "hour": 15, "hours": 2, "customerName": "Net repair"}
    code = admin.post("/api/admin/bookings", json=body).json()["code"]
    at(fake_now, 16, 30)
    d = detail(admin, code)
    assert d["label"] == "blocked" and slot_state(admin, 16) == "past"


# ── The host decides ──────────────────────────────────────────────────────────
def test_arrived_ends_the_late_and_the_court_stays_theirs(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)
    at(fake_now, 19, 25)  # they were playing all along; the host just hadn't tapped Arrived
    res = admin.post(f"/api/admin/bookings/{code}/arrived")
    assert res.status_code == 200, res.text
    b = res.json()
    assert b["label"] == "paid" and b["lateAt"] is None and b["arrivedAt"] and b["holdsCourt"] is True
    assert b["events"][0]["action"] == "arrived"
    assert slot_state(admin, 20) == "booked" and admin.get("/api/admin/counts").json()["late"] == 0


def test_release_court_frees_the_hours_and_can_be_undone_for_a_few_minutes(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)
    at(fake_now, 19, 20)
    b = release(admin, code)
    assert b["label"] == "late" and b["releasedAt"] == "2026-10-10T11:20:00Z" and b["holdsCourt"] is False
    assert b["restorable"] is True and b["restoreUntil"] == "2026-10-10T11:25:00Z" and b["canMarkArrived"] is False
    assert b["events"][0]["action"] == "released"
    assert slot_state(admin, 20) == "available"  # 8 PM is open for someone else
    assert admin.get("/api/admin/counts").json()["late"] == 0  # decided

    fake_now.advance(minutes=3)  # 7:23: the group turns up after all
    res = admin.post(f"/api/admin/bookings/{code}/restore", json={"note": "Called: stuck in traffic"})
    assert res.status_code == 200, res.text
    b = res.json()
    assert b["label"] == "paid" and b["lateAt"] is None and b["releasedAt"] is None and b["arrivedAt"]
    assert b["events"][0]["action"] == "restored" and b["events"][0]["detail"] == "Called: stuck in traffic"
    assert slot_state(admin, 20) == "booked"


def test_the_undo_goes_away_after_the_grace(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)
    at(fake_now, 19, 20)
    release(admin, code)
    at(fake_now, 19, 26)
    assert detail(admin, code)["restorable"] is False
    res = admin.post(f"/api/admin/bookings/{code}/restore")
    assert res.status_code == 409 and res.json()["error"]["code"] == "restore_window_closed"


def test_undo_fails_if_someone_booked_the_hours_first(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)
    at(fake_now, 19, 20)
    release(admin, code)
    other = admin.post("/api/bookings", json=booking_payload(hour=20, customerPhone="09181112222")).json()  # grabbed 8 PM
    assert other["booking"]["status"] == "held"
    res = admin.post(f"/api/admin/bookings/{code}/restore")
    assert res.status_code == 409 and res.json()["error"]["code"] == "slot_taken"
    assert detail(admin, code)["label"] == "late" and detail(admin, code)["releasedAt"]  # nothing changed
    assert slot_state(admin, 20) == "held"


def test_a_late_booking_that_holds_its_court_needs_arrived_not_restore(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19)
    at(fake_now, 19, 16)
    res = admin.post(f"/api/admin/bookings/{code}/restore")
    assert res.status_code == 409 and res.json()["error"]["code"] == "use_arrived"


def test_only_a_late_or_rain_delayed_booking_can_be_released(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19)
    res = admin.post(f"/api/admin/bookings/{code}/release", json={})
    assert res.status_code == 409 and res.json()["error"]["code"] == "cannot_release"
    at(fake_now, 19, 16)
    release(admin, code)
    assert release(admin, code)["releasedAt"]  # releasing twice changes nothing


def test_only_late_or_rain_delayed_bookings_can_be_restored(admin, booking_payload):
    code, _ = paid(admin, booking_payload)
    res = admin.post(f"/api/admin/bookings/{code}/restore")
    assert res.status_code == 409 and res.json()["error"]["code"] == "not_restorable"


def test_a_late_booking_stays_on_the_schedule_before_and_after_its_court_is_released(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)
    at(fake_now, 19, 16)
    day = admin.get("/api/admin/schedule", params={"date": "2026-10-10"}).json()
    assert [(b["code"], b["label"], b["holdsCourt"]) for b in day["bookings"]] == [(code, "late", True)]
    release(admin, code)
    day = admin.get("/api/admin/schedule", params={"date": "2026-10-10"}).json()
    assert [(b["code"], b["label"], b["holdsCourt"]) for b in day["bookings"]] == [(code, "late", False)]


def test_moving_a_late_booking_with_edit_makes_it_live_again(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19)
    at(fake_now, 19, 40)
    b = admin.patch(f"/api/admin/bookings/{code}", json={"hour": 21}).json()
    assert b["label"] == "paid" and b["lateAt"] is None and b["arrivedAt"] is None and b["holdsCourt"] is True
    assert slot_state(admin, 21) == "booked"


def test_moving_a_released_late_booking_takes_new_hours(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19)
    at(fake_now, 19, 30)
    release(admin, code)
    b = admin.patch(f"/api/admin/bookings/{code}", json={"hour": 22}).json()
    assert b["label"] == "paid" and b["releasedAt"] is None and b["holdsCourt"] is True
    assert slot_state(admin, 22) == "booked"


# ── What guests see ───────────────────────────────────────────────────────────
def test_guests_are_told_it_is_late_but_never_about_the_hosts_choices(client, booking_payload, fake_now):
    code, headers = paid(client, booking_payload, hour=19)
    at(fake_now, 19, 16)
    body = client.get(f"/api/bookings/{code}", headers=headers).json()
    assert body["late"] is True and body["status"] == "confirmed"
    assert not any(word in key.lower() for key in body for word in ("restore", "grace", "release"))
    assert "lateAt" not in body


# ── Guests cannot check in ────────────────────────────────────────────────────
def test_a_guest_has_no_way_to_check_in(client, booking_payload, fake_now):
    code, headers = paid(client, booking_payload, hour=19)
    at(fake_now, 18, 45)
    assert "canCheckIn" not in client.get(f"/api/bookings/{code}", headers=headers).json()
    assert client.post(f"/api/bookings/{code}/arrive", headers=headers).status_code in (404, 405)
    at(fake_now, 19, 16)  # only the host's Arrived button stops a booking going Late
    assert client.get(f"/api/bookings/{code}", headers=headers).json()["late"] is True


# ── Marking arrived by hand ───────────────────────────────────────────────────
def test_the_host_cannot_mark_a_released_booking_arrived(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19)
    at(fake_now, 19, 16)
    release(admin, code)
    res = admin.post(f"/api/admin/bookings/{code}/arrived")
    assert res.status_code == 409 and res.json()["error"]["code"] == "use_restore"


# ── Upgrading a database ──────────────────────────────────────────────────────
NEW_COLUMNS = ("arrived_at", "late_at", "reschedule_count", "weather_hold_at", "released_at", "paid_late_at")


def _old_database(drop: tuple[str, ...]):
    import sqlite3

    from app import db

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    # What an older database looks like: today's bookings table minus the columns added since.
    lines = db.SCHEMA.split("CREATE TABLE IF NOT EXISTS bookings (")[1].split("\n);")[0].split("\n")
    lines = [ln for ln in lines if not ln.strip().startswith(drop)]
    lines[-1] = lines[-1].split("--")[0].rstrip().rstrip(",")  # the new last column has no comma after it
    conn.execute("CREATE TABLE courts (id TEXT PRIMARY KEY, name TEXT NOT NULL, day_rate INTEGER NOT NULL, night_rate INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)")
    conn.execute("CREATE TABLE bookings (" + "\n".join(lines) + "\n)")
    return conn


def _insert(conn, code, start, **extra):
    cols = ", ".join(extra)
    marks = ", ".join("?" * len(extra))
    conn.execute(
        f"""INSERT INTO bookings (id, code, status, court_id, start_at, hours, customer_name, customer_phone, payment_method,
               court_cost, addons_cost, total, consent_at, consent_version, created_at, hold_expires_at{', ' + cols if cols else ''})
           VALUES (?, ?, 'confirmed', 'court-1', ?, 1, 'A B', '09171234567', 'gcash', 250, 0, 250, 'x', 'v', 'x', 'x'{', ' + marks if marks else ''})""",
        (code, code, start, *extra.values()),
    )


def test_upgrading_treats_past_bookings_as_attended_so_history_isnt_marked_late():
    from app import db

    conn = _old_database(NEW_COLUMNS)
    assert "arrived_at" not in {r["name"] for r in conn.execute("PRAGMA table_info(bookings)")}
    for code, start in (("HPC-PAST-AAAA", "2020-01-01T10:00:00Z"), ("HPC-NEXT-BBBB", "2099-01-01T10:00:00Z")):
        _insert(conn, code, start)
    db.apply_schema(conn)
    db.apply_schema(conn)  # and running it again changes nothing
    arrived = {r["code"]: r["arrived_at"] for r in conn.execute("SELECT code, arrived_at FROM bookings")}
    assert arrived == {"HPC-PAST-AAAA": "2020-01-01T10:00:00Z", "HPC-NEXT-BBBB": None}
    assert conn.execute("SELECT reschedule_count FROM bookings").fetchone()[0] == 0
    conn.close()


def test_upgrading_marks_bookings_the_old_rules_had_released():
    # Before this release, going Late and a rain delay gave the hours back at once: those bookings have no slots.
    from app import db

    conn = _old_database(("released_at", "paid_late_at"))
    _insert(conn, "HPC-LATE-AAAA", "2026-10-10T11:00:00Z", late_at="2026-10-10T11:15:00Z")
    _insert(conn, "HPC-RAIN-BBBB", "2026-10-12T11:00:00Z", weather_hold_at="2026-10-10T02:00:00Z")
    _insert(conn, "HPC-FINE-CCCC", "2026-10-12T12:00:00Z")
    db.apply_schema(conn)
    db.apply_schema(conn)
    released = {r["code"]: r["released_at"] for r in conn.execute("SELECT code, released_at FROM bookings")}
    assert released == {"HPC-LATE-AAAA": "2026-10-10T11:15:00Z", "HPC-RAIN-BBBB": "2026-10-10T02:00:00Z", "HPC-FINE-CCCC": None}
    conn.close()


# ── Telegram nudges ───────────────────────────────────────────────────────────
def test_the_host_is_pinged_once_when_a_booking_goes_late(admin, booking_payload, fake_now, monkeypatch):
    from dataclasses import replace

    from app import notify
    from app.db import connect

    monkeypatch.setattr(notify, "settings", replace(notify.settings, telegram_bot_token="t", telegram_chat_id="1"))
    sent = []
    monkeypatch.setattr(notify, "send", lambda text: sent.append(text) or True)
    code, _ = paid(admin, booking_payload, hour=19)
    at(fake_now, 19, 16)
    admin.get("/api/admin/counts")  # any request notices the lateness
    conn = connect()
    try:
        assert notify.check_late(conn) == 1 and notify.check_late(conn) == 0
    finally:
        conn.close()
    assert len(sent) == 1 and "Juan dela Cruz" in sent[0] and "09171234567" in sent[0]
    assert "still theirs" in sent[0] and "Release court" in sent[0]
