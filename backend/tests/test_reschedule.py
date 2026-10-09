"""Guests moving their own booking: once, at least 48 hours ahead, within 30 days, never to a pricier slot."""

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PHONE = "0917 123 4567"


def paid(client, booking_payload, **overrides):
    body = client.post("/api/bookings", json=booking_payload(**overrides)).json()
    assert "booking" in body, body
    code, headers = body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}
    res = client.post(f"/api/bookings/{code}/receipt", headers=headers, files={"receipt": ("r.png", PNG + code.encode())})
    assert res.status_code == 200 and res.json()["status"] == "confirmed", res.text
    return code, headers


def slot_state(client, date, hour, court="court-1"):
    data = client.get("/api/availability", params={"date": date}).json()
    return next(s for s in data["slots"] if s["hour"] == hour)["courts"][court]


def find(client, code, phone=PHONE, **kw):
    return client.post("/api/reschedule/find", json={"code": code, "customerPhone": phone}, **kw)


def move(client, code, date, hour, court=None, phone=PHONE, **kw):
    body = {"code": code, "customerPhone": phone, "date": date, "hour": hour}
    if court:
        body["courtId"] = court
    return client.post("/api/reschedule", json=body, **kw)


# ── Finding your booking ──────────────────────────────────────────────────────
def test_code_and_mobile_number_find_the_booking(client, booking_payload):
    code, _ = paid(client, booking_payload, date="2026-10-14", hour=19)
    res = find(client, code.lower())
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["booking"]["code"] == code and out["booking"]["reschedule"] == "open"
    assert out["earliestDate"] == "2026-10-10" and out["latestDate"] == "2026-11-09"
    assert out["accessToken"]
    assert find(client, code, phone="+63 917 123 4567").status_code == 200  # any way of writing the number


def test_wrong_number_or_code_gets_the_same_answer(client, booking_payload):
    code, _ = paid(client, booking_payload, date="2026-10-14", hour=19)
    a, b = find(client, code, phone="0999 000 1111"), find(client, "HPC-NOPE-NOPE")
    assert a.status_code == b.status_code == 404
    assert a.json()["error"]["message"] == b.json()["error"]["message"]


def test_a_walk_in_without_a_number_cannot_be_found_by_phone(admin):
    body = {"kind": "walk_in", "courtId": "court-1", "date": "2026-10-14", "hour": 15, "hours": 1,
            "customerName": "Maria Santos", "customerPhone": "", "paymentMethod": "cash"}
    code = admin.post("/api/admin/bookings", json=body).json()["code"]
    assert find(admin, code, phone="0918 555 0101").status_code == 404


def test_finding_is_rate_limited(client, booking_payload):
    code, _ = paid(client, booking_payload, date="2026-10-14", hour=19)
    codes = [find(client, code, phone="0999 000 1111").status_code for _ in range(21)]
    assert codes[:20] == [404] * 20 and codes[20] == 429  # nobody can guess a number for a known code


# ── Moving it ─────────────────────────────────────────────────────────────────
def test_reschedule_moves_the_booking_once(client, booking_payload):
    code, _ = paid(client, booking_payload, date="2026-10-14", hour=19)
    res = move(client, code, "2026-10-16", 18, court="court-2")
    assert res.status_code == 200, res.text
    b = res.json()
    assert b["courtName"] == "Court 2" and b["playDate"] == "2026-10-16" and b["startAt"] == "2026-10-16T10:00:00Z"
    assert b["rescheduleCount"] == 1 and b["reschedule"] == "used" and b["status"] == "confirmed"
    assert slot_state(client, "2026-10-14", 19) == "available"  # the old hours are free again
    assert slot_state(client, "2026-10-16", 18, court="court-2") == "booked"

    again = move(client, code, "2026-10-17", 18)
    assert again.status_code == 409 and again.json()["error"]["code"] == "reschedule_used"
    assert slot_state(client, "2026-10-17", 18) == "available"


def test_the_host_sees_what_happened(admin, booking_payload):
    code, _ = paid(admin, booking_payload, date="2026-10-14", hour=19)
    move(admin, code, "2026-10-16", 18)
    event = admin.get(f"/api/admin/bookings/{code}").json()["events"][0]
    assert event["action"] == "guest_rescheduled" and "Oct 14, 7:00 PM" in event["detail"] and "Oct 16, 6:00 PM" in event["detail"]


def test_a_device_that_made_the_booking_needs_no_number(client, booking_payload):
    code, headers = paid(client, booking_payload, date="2026-10-14", hour=19)
    res = client.post("/api/reschedule", headers=headers, json={"code": code, "date": "2026-10-15", "hour": 19})
    assert res.status_code == 200, res.text
    assert client.post("/api/reschedule", json={"code": code, "date": "2026-10-16", "hour": 19}).status_code == 404  # nothing to prove it


def test_less_than_48_hours_ahead_is_for_the_host_only(client, booking_payload):
    code, _ = paid(client, booking_payload, date="2026-10-11", hour=19)  # 33 hours away
    assert find(client, code).json()["booking"]["reschedule"] == "too_late"
    res = move(client, code, "2026-10-15", 19)
    assert res.status_code == 409 and res.json()["error"]["code"] == "reschedule_too_late"
    assert "host" in res.json()["error"]["message"]
    assert slot_state(client, "2026-10-11", 19) == "booked"


def test_exactly_48_hours_ahead_is_still_allowed(client, booking_payload, fake_now):
    code, _ = paid(client, booking_payload, date="2026-10-12", hour=10)  # Oct 12, 10:00: exactly 48 h from now
    assert move(client, code, "2026-10-15", 10).status_code == 200


def test_a_slot_that_costs_more_is_refused_and_a_cheaper_one_keeps_what_was_paid(admin, booking_payload):
    night, _ = paid(admin, booking_payload, date="2026-10-14", hour=23)  # night rate ₱200
    res = move(admin, night, "2026-10-15", 19)  # 7 PM costs ₱250
    assert res.status_code == 400 and res.json()["error"]["code"] == "costs_more"
    assert "₱50" in res.json()["error"]["message"]

    day, _ = paid(admin, booking_payload, date="2026-10-14", hour=19, customerPhone="09181112222")
    ok = move(admin, day, "2026-10-15", 23, phone="0918 111 2222")
    assert ok.status_code == 200 and ok.json()["total"] == 250  # no refund of the difference
    d = admin.get(f"/api/admin/bookings/{day}").json()
    assert d["total"] == 250 and "kept ₱250 paid" in d["events"][0]["detail"]


def test_a_taken_slot_changes_nothing(client, booking_payload):
    code, _ = paid(client, booking_payload, date="2026-10-14", hour=19)
    paid(client, booking_payload, date="2026-10-16", hour=18, customerPhone="09181112222")
    res = move(client, code, "2026-10-16", 18)
    assert res.status_code == 409 and res.json()["error"]["code"] == "slot_taken"
    assert slot_state(client, "2026-10-14", 19) == "booked"  # still theirs
    assert find(client, code).json()["booking"]["reschedule"] == "open"  # and the one reschedule isn't spent


def test_the_new_date_must_be_close_to_the_old_one_and_not_in_the_past(client, booking_payload):
    code, _ = paid(client, booking_payload, date="2026-10-14", hour=19)
    for date in ("2026-10-09", "2026-12-31"):
        res = move(client, code, date, 19)
        assert res.status_code == 400 and res.json()["error"]["code"] == "reschedule_date_out_of_range", date
    assert move(client, code, "2026-10-10", 9).json()["error"]["code"] == "slot_past"  # 9 AM today has gone


def test_moving_to_the_time_you_already_have_is_refused(client, booking_payload):
    code, _ = paid(client, booking_payload, date="2026-10-14", hour=19)
    assert move(client, code, "2026-10-14", 19).json()["error"]["code"] == "same_slot"


def test_only_paid_upcoming_bookings_can_move(client, booking_payload, fake_now):
    held = client.post("/api/bookings", json=booking_payload(date="2026-10-14", hour=19)).json()["booking"]
    assert find(client, held["code"]).json()["booking"]["reschedule"] == "unavailable"
    assert move(client, held["code"], "2026-10-15", 19).json()["error"]["code"] == "reschedule_unavailable"


def test_a_late_booking_cannot_be_moved_online(client, booking_payload, fake_now):
    from datetime import datetime

    from app.clock import MANILA, UTC

    code, _ = paid(client, booking_payload, date="2026-10-10", hour=19)
    fake_now.current = datetime(2026, 10, 10, 19, 20, tzinfo=MANILA).astimezone(UTC)
    assert find(client, code).json()["booking"]["reschedule"] == "unavailable"
