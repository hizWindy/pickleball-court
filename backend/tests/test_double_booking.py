"""The double-booking audit (2026-11-25): ways two groups can end up holding the same court-hour.

The slot table itself never double books (see `scripts/stress_double_booking.py`). These are the rules that gave hours
away while a booking was still good. Each test says what must happen. All five failed on the code of 2026-11-25 (they
were kept as expected failures) and pass since release 3 (items 8-10 of IMPLEMENTATION_PLAN.md).

The fake clock starts on Sat Oct 10 2026, 10:00 AM Manila.
"""

from datetime import datetime

from app.clock import MANILA, UTC

def at(fake_now, hour, minute=0, second=0):
    fake_now.current = datetime(2026, 10, 10, hour, minute, second, tzinfo=MANILA).astimezone(UTC)


def hold(client, booking_payload, **kw):
    return client.post("/api/bookings", json=booking_payload(**kw))


def pay(client, code, token, ref="4821 9053 37164"):
    """Pay the way players do on the live site: type the reference and the sender's name."""
    return client.post(
        f"/api/bookings/{code}/reference", headers={"X-Booking-Token": token},
        json={"referenceNumber": ref, "payerName": "Juan dela Cruz"},
    )


def slot_state(client, hour, court="court-1"):
    data = client.get("/api/availability", params={"date": "2026-10-10"}).json()
    return next(s for s in data["slots"] if s["hour"] == hour)["courts"][court]


def test_a_phone_booking_keeps_its_hours_when_nobody_taps_arrived(admin, booking_payload, fake_now):
    # 10 AM: the host types in a phone booking for Court 1, 7-10 PM, paid in cash.
    res = admin.post("/api/admin/bookings", json={
        "kind": "walk_in", "courtId": "court-1", "date": "2026-10-10", "hour": 19, "hours": 3,
        "customerName": "Phone group", "customerPhone": "", "paymentMethod": "cash",
    })
    assert res.status_code == 201, res.text
    # 7:16 PM: the group is playing, but the busy host never tapped Arrived.
    at(fake_now, 19, 16)
    # Nobody online can take Court 1 at 8 PM.
    res = hold(admin, booking_payload, hour=20, customerName="Online player")
    assert res.status_code == 409 and res.json()["error"]["code"] == "slot_taken", res.text


def test_a_paid_group_keeps_its_later_hours(admin, booking_payload, fake_now):
    first = hold(admin, booking_payload, hour=19, hours=3, customerName="Group one").json()
    assert pay(admin, first["booking"]["code"], first["accessToken"]).json()["status"] == "confirmed"
    at(fake_now, 19, 15)  # on court, Arrived not tapped
    res = hold(admin, booking_payload, hour=21, customerName="Group two")
    assert res.status_code == 409, res.text
    assert slot_state(admin, 21) == "booked"


def test_a_payment_just_after_the_timer_still_counts_when_the_hour_is_free(admin, booking_payload, fake_now):
    a = hold(admin, booking_payload, hour=19, customerName="Slow payer").json()
    fake_now.advance(minutes=10, seconds=11)  # the 10-minute hold and its 10 s grace are over
    res = pay(admin, a["booking"]["code"], a["accessToken"])
    assert res.status_code == 200 and res.json()["status"] == "confirmed", res.text
    assert slot_state(admin, 19) == "booked"


def test_a_payment_after_the_timer_is_kept_when_someone_else_took_the_hour(admin, booking_payload, fake_now):
    a = hold(admin, booking_payload, hour=19, customerName="Slow payer").json()
    fake_now.advance(minutes=10, seconds=11)
    b = hold(admin, booking_payload, hour=19, customerName="Fast payer", customerPhone="09181112222")
    assert b.status_code == 201  # the hour was free again, so the second player got it
    res = pay(admin, a["booking"]["code"], a["accessToken"])
    # The slow payer is told what happened and the money is on record for the host, not lost.
    assert res.status_code == 409 and res.json()["error"]["code"] == "paid_after_expiry", res.text
    detail = admin.get(f"/api/admin/bookings/{a['booking']['code']}").json()
    assert detail["status"] == "expired" and detail["paidLate"] is True


def test_a_rain_delay_keeps_the_hours_closed_until_the_guest_picks_a_new_time(admin, booking_payload, fake_now):
    first = hold(admin, booking_payload, hour=19, customerName="Rain guest").json()
    assert pay(admin, first["booking"]["code"], first["accessToken"]).json()["status"] == "confirmed"
    assert admin.post("/api/admin/rain-delay", json={"date": "2026-10-10", "fromHour": 19, "hours": 1}).status_code == 200
    res = hold(admin, booking_payload, hour=19, customerName="New player", customerPhone="09181112222")
    assert res.status_code == 409, res.text
