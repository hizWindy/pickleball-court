"""Late bookings: 15 minutes after the start the court is released; the host alone has a few quiet minutes to restore it."""

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


# ── Going late ────────────────────────────────────────────────────────────────
def test_a_group_not_there_after_15_minutes_is_late_and_its_hours_open(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)  # 7-9 PM, Court 1
    at(fake_now, 19, 14)
    fake_now.advance(seconds=59)  # 7:14:59
    assert detail(admin, code)["label"] == "paid" and slot_state(admin, 20) == "booked"

    fake_now.advance(seconds=1)  # 7:15
    d = detail(admin, code)
    assert d["label"] == "late" and d["status"] == "confirmed"  # paid and non-refundable, but Late
    assert d["lateAt"] == "2026-10-10T11:15:00Z"
    assert slot_state(admin, 20) == "available"  # 8 PM is open for someone else
    assert d["events"][0]["action"] == "went_late"


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
    assert d["restorable"] is False  # the host's few minutes were over long ago


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


def test_blocks_are_never_late(admin, fake_now):
    body = {"kind": "block", "courtId": "court-1", "date": "2026-10-10", "hour": 15, "hours": 2, "customerName": "Net repair"}
    code = admin.post("/api/admin/bookings", json=body).json()["code"]
    at(fake_now, 16, 30)
    d = detail(admin, code)
    assert d["label"] == "blocked" and slot_state(admin, 16) == "past"


# ── Restoring ─────────────────────────────────────────────────────────────────
def test_the_host_can_restore_a_late_booking_for_a_few_minutes(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)
    at(fake_now, 19, 16)
    d = detail(admin, code)
    assert d["label"] == "late" and d["restorable"] is True and d["restoreUntil"] == "2026-10-10T11:20:00Z"
    assert admin.get("/api/admin/counts").json()["late"] == 1

    fake_now.advance(minutes=3)  # 7:19
    res = admin.post(f"/api/admin/bookings/{code}/restore", json={"note": "Called: stuck in traffic"})
    assert res.status_code == 200, res.text
    b = res.json()
    assert b["label"] == "paid" and b["lateAt"] is None and b["arrivedAt"]
    assert b["events"][0]["action"] == "restored" and b["events"][0]["detail"] == "Called: stuck in traffic"
    assert slot_state(admin, 20) == "booked"  # 8 PM is theirs again
    assert admin.get("/api/admin/counts").json()["late"] == 0
    at(fake_now, 20, 30)
    assert detail(admin, code)["label"] == "paid"  # restoring ended the lateness for good


def test_the_restore_button_goes_away_after_the_grace(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)
    at(fake_now, 19, 21)
    assert detail(admin, code)["restorable"] is False
    res = admin.post(f"/api/admin/bookings/{code}/restore")
    assert res.status_code == 409 and res.json()["error"]["code"] == "restore_window_closed"
    assert admin.get("/api/admin/counts").json()["late"] == 0


def test_restore_fails_if_someone_booked_the_hours_first(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)
    at(fake_now, 19, 16)
    other = admin.post("/api/bookings", json=booking_payload(hour=20, customerPhone="09181112222")).json()  # grabbed 8 PM
    assert other["booking"]["status"] == "held"
    res = admin.post(f"/api/admin/bookings/{code}/restore")
    assert res.status_code == 409 and res.json()["error"]["code"] == "slot_taken"
    assert detail(admin, code)["label"] == "late"  # nothing changed
    assert slot_state(admin, 20) == "held"


def test_only_late_or_rain_delayed_bookings_can_be_restored(admin, booking_payload):
    code, _ = paid(admin, booking_payload)
    res = admin.post(f"/api/admin/bookings/{code}/restore")
    assert res.status_code == 409 and res.json()["error"]["code"] == "not_restorable"


def test_a_late_booking_stays_on_the_schedule_so_it_can_be_restored(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19, hours=2)
    at(fake_now, 19, 16)
    day = admin.get("/api/admin/schedule", params={"date": "2026-10-10"}).json()
    assert [(b["code"], b["label"]) for b in day["bookings"]] == [(code, "late")]


def test_moving_a_late_booking_with_edit_makes_it_live_again(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19)
    at(fake_now, 19, 40)
    b = admin.patch(f"/api/admin/bookings/{code}", json={"hour": 21}).json()
    assert b["label"] == "paid" and b["lateAt"] is None and b["arrivedAt"] is None
    assert slot_state(admin, 21) == "booked"


# ── What guests see ───────────────────────────────────────────────────────────
def test_guests_are_told_it_is_late_but_never_about_the_restore_window(client, booking_payload, fake_now):
    code, headers = paid(client, booking_payload, hour=19)
    at(fake_now, 19, 16)
    body = client.get(f"/api/bookings/{code}", headers=headers).json()
    assert body["late"] is True and body["status"] == "confirmed"
    assert not any("restore" in key.lower() or "grace" in key.lower() for key in body)
    assert "lateAt" not in body


# ── Checking in ───────────────────────────────────────────────────────────────
def test_a_guest_can_check_in_shortly_before_the_start(client, booking_payload, fake_now):
    code, headers = paid(client, booking_payload, hour=19)
    assert client.get(f"/api/bookings/{code}", headers=headers).json()["canCheckIn"] is False
    early = client.post(f"/api/bookings/{code}/arrive", headers=headers)
    assert early.status_code == 409 and early.json()["error"]["code"] == "too_early"

    at(fake_now, 18, 40)
    assert client.get(f"/api/bookings/{code}", headers=headers).json()["canCheckIn"] is True
    done = client.post(f"/api/bookings/{code}/arrive", headers=headers).json()
    assert done["arrived"] is True and done["canCheckIn"] is False
    at(fake_now, 19, 30)
    assert client.get(f"/api/bookings/{code}", headers=headers).json()["late"] is False


def test_a_guest_cannot_check_in_once_late(client, booking_payload, fake_now):
    code, headers = paid(client, booking_payload, hour=19)
    at(fake_now, 19, 16)
    res = client.post(f"/api/bookings/{code}/arrive", headers=headers)
    assert res.status_code == 409 and res.json()["error"]["code"] == "late"
    assert "contact the host" in res.json()["error"]["message"].lower()


def test_check_in_needs_the_bookings_own_token(client, booking_payload, fake_now):
    code, _ = paid(client, booking_payload, hour=19)
    at(fake_now, 18, 45)
    assert client.post(f"/api/bookings/{code}/arrive", headers={"X-Booking-Token": "nope"}).status_code == 404


# ── Marking arrived by hand ───────────────────────────────────────────────────
def test_the_host_marks_arrived_but_cannot_arrive_a_released_booking(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=19)
    at(fake_now, 19, 16)
    res = admin.post(f"/api/admin/bookings/{code}/arrived")
    assert res.status_code == 409 and res.json()["error"]["code"] == "use_restore"


# ── Upgrading a database from before arrivals were tracked ────────────────────
def test_upgrading_treats_past_bookings_as_attended_so_history_isnt_marked_late():
    import sqlite3

    from app import db

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    # What a database from last week looks like: today's bookings table minus the four new columns.
    lines = db.SCHEMA.split("CREATE TABLE IF NOT EXISTS bookings (")[1].split("\n);")[0].split("\n")
    lines = [ln for ln in lines if not ln.strip().startswith(("arrived_at", "late_at", "reschedule_count", "weather_hold_at"))]
    lines = ["    review_flags        TEXT" if ln.strip().startswith("review_flags") else ln for ln in lines]
    conn.execute("CREATE TABLE courts (id TEXT PRIMARY KEY, name TEXT NOT NULL, day_rate INTEGER NOT NULL, night_rate INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)")
    conn.execute("CREATE TABLE bookings (" + "\n".join(lines) + "\n)")
    assert "arrived_at" not in {r["name"] for r in conn.execute("PRAGMA table_info(bookings)")}
    for code, start in (("HPC-PAST-AAAA", "2020-01-01T10:00:00Z"), ("HPC-NEXT-BBBB", "2099-01-01T10:00:00Z")):
        conn.execute(
            """INSERT INTO bookings (id, code, status, court_id, start_at, hours, customer_name, customer_phone, payment_method,
                   court_cost, addons_cost, total, consent_at, consent_version, created_at, hold_expires_at)
               VALUES (?, ?, 'confirmed', 'court-1', ?, 1, 'A B', '09171234567', 'gcash', 250, 0, 250, 'x', 'v', 'x', 'x')""",
            (code, code, start),
        )
    db.apply_schema(conn)
    db.apply_schema(conn)  # and running it again changes nothing
    arrived = {r["code"]: r["arrived_at"] for r in conn.execute("SELECT code, arrived_at FROM bookings")}
    assert arrived == {"HPC-PAST-AAAA": "2020-01-01T10:00:00Z", "HPC-NEXT-BBBB": None}
    assert conn.execute("SELECT reschedule_count FROM bookings").fetchone()[0] == 0
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
    assert len(sent) == 1 and "Juan dela Cruz" in sent[0] and "0917 123 4567".replace(" ", "") in sent[0]
