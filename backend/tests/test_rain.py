"""Weather on the admin desk, and calling a rain delay: guests give their hours back and pick a new time."""

from datetime import datetime, timedelta

import pytest

from app import weather
from app.clock import MANILA, UTC

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def forecast_payload(rainy=range(15, 18), day="2026-10-10", rain=80, calm=10):
    """Four days of hourly Open-Meteo data, rainy during the `rainy` hours of `day`."""
    start = datetime(2026, 10, 10)
    times, prob, mm = [], [], []
    for i in range(4 * 24):
        t = start + timedelta(hours=i)
        times.append(t.strftime("%Y-%m-%dT%H:%M"))
        wet = t.strftime("%Y-%m-%d") == day and t.hour in rainy
        prob.append(rain if wet else calm)
        mm.append(2.4 if wet else 0.0)
    return {"hourly": {"time": times, "precipitation_probability": prob, "precipitation": mm}}


@pytest.fixture
def forecast(monkeypatch):
    weather.reset()
    calls = []

    def install(payload):
        def fetch():
            calls.append(1)
            if isinstance(payload, Exception):
                raise payload
            return payload

        monkeypatch.setattr(weather, "_fetch", fetch)
        return calls

    yield install
    weather.reset()


def paid(client, booking_payload, **overrides):
    body = client.post("/api/bookings", json=booking_payload(**overrides)).json()
    code, headers = body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}
    res = client.post(f"/api/bookings/{code}/receipt", headers=headers, files={"receipt": ("r.png", PNG + code.encode())})
    assert res.status_code == 200, res.text
    return code, headers


def walk_in(admin, **overrides):
    body = {"kind": "walk_in", "courtId": "court-1", "date": "2026-10-10", "hour": 15, "hours": 1,
            "customerName": "Maria Santos", "customerPhone": "0918 555 0101", "paymentMethod": "cash"}
    body.update(overrides)
    res = admin.post("/api/admin/bookings", json=body)
    assert res.status_code == 201, res.text
    return res.json()["code"]


def slot_state(client, hour, court="court-1", date="2026-10-10"):
    data = client.get("/api/availability", params={"date": date}).json()
    return next(s for s in data["slots"] if s["hour"] == hour)["courts"][court]


# ── The forecast ──────────────────────────────────────────────────────────────
def test_the_desk_shows_rain_chances_and_the_bookings_caught_in_it(admin, booking_payload, forecast):
    forecast(forecast_payload())
    wet, _ = paid(admin, booking_payload, hour=15, hours=2)  # 3-5 PM, in the rain
    paid(admin, booking_payload, date="2026-10-12", hour=15, customerPhone="09181112222")  # a dry day
    res = admin.get("/api/admin/weather").json()
    assert res["available"] is True and res["warnPercent"] == 60
    assert res["hours"][0]["at"] == "2026-10-10T02:00:00Z"  # the current hour: 10 AM Manila
    assert {h["probability"] for h in res["hours"] if h["at"] == "2026-10-10T07:00:00Z"} == {80}  # 3 PM
    assert [(r["booking"]["code"], r["peak"]) for r in res["atRisk"]] == [(wet, 80)]


def test_the_forecast_is_cached_and_survives_a_short_outage(admin, forecast, fake_now):
    calls = forecast(forecast_payload())
    admin.get("/api/admin/weather")
    admin.get("/api/admin/weather")
    assert len(calls) == 1  # one call to the service per 15 minutes, however often the desk refreshes
    fake_now.advance(minutes=20)
    forecast(OSError("offline"))
    assert admin.get("/api/admin/weather").json()["available"] is True  # last good answer
    fake_now.advance(hours=4)
    assert admin.get("/api/admin/weather").json() == {
        "available": False, "updatedAt": None, "warnPercent": 60, "hours": [], "atRisk": []
    }


def test_no_forecast_is_not_an_error(admin, forecast):
    forecast(KeyError("hourly"))
    assert admin.get("/api/admin/weather").json()["available"] is False


# ── Calling a rain delay ──────────────────────────────────────────────────────
def test_preview_lists_who_a_rain_delay_would_affect(admin, booking_payload):
    a, _ = paid(admin, booking_payload, hour=15, hours=2)  # 3-5 PM
    b = walk_in(admin, courtId="court-2", hour=16)  # 4-5 PM
    walk_in(admin, hour=20, customerName="Pedro Penduko")  # 8 PM: after the rain
    block = admin.post("/api/admin/bookings", json={
        "kind": "block", "courtId": "court-2", "date": "2026-10-10", "hour": 15, "hours": 1, "customerName": "Net"}).json()["code"]
    res = admin.get("/api/admin/rain-delay", params={"date": "2026-10-10", "fromHour": 14, "hours": 4}).json()
    assert {x["code"] for x in res["bookings"]} == {a, b} and block not in {x["code"] for x in res["bookings"]}
    assert res["windowStart"] == "2026-10-10T06:00:00Z" and res["windowEnd"] == "2026-10-10T10:00:00Z"
    assert slot_state(admin, 15) == "booked"  # a preview changes nothing


def test_a_rain_delay_gives_the_hours_back_and_keeps_the_booking_paid(admin, booking_payload):
    code, headers = paid(admin, booking_payload, hour=15, hours=2)
    other = walk_in(admin, hour=20, customerName="Pedro Penduko")
    res = admin.post("/api/admin/rain-delay", json={"date": "2026-10-10", "fromHour": 14, "hours": 7, "note": "Heavy rain"})
    assert res.status_code == 200, res.text
    assert [b["code"] for b in res.json()["moved"]] == [code, other]
    b = admin.get(f"/api/admin/bookings/{code}").json()
    assert b["label"] == "rain_delay" and b["status"] == "confirmed" and b["weatherHoldAt"]
    assert b["events"][0]["action"] == "rain_delay" and b["events"][0]["detail"] == "Heavy rain"
    assert slot_state(admin, 15) == "available" and slot_state(admin, 16) == "available"
    assert admin.get("/api/admin/counts").json()["rainDelay"] == 2

    guest = admin.get(f"/api/bookings/{code}", headers=headers).json()
    assert guest["weatherHold"] is True and guest["reschedule"] == "weather" and guest["late"] is False


def test_a_delayed_booking_never_goes_late_and_the_host_can_undo_the_delay(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=15)
    admin.post("/api/admin/rain-delay", json={"date": "2026-10-10", "fromHour": 14, "hours": 3})
    fake_now.current = datetime(2026, 10, 10, 18, 0, tzinfo=MANILA).astimezone(UTC)  # long after the start
    assert admin.get(f"/api/admin/bookings/{code}").json()["label"] == "rain_delay"

    fake_now.current = datetime(2026, 10, 10, 12, 0, tzinfo=MANILA).astimezone(UTC)  # (rain stopped early; clock back)
    b = admin.post(f"/api/admin/bookings/{code}/restore").json()
    assert b["label"] == "paid" and b["weatherHoldAt"] is None
    assert slot_state(admin, 15) == "booked" and admin.get("/api/admin/counts").json()["rainDelay"] == 0


def test_the_host_can_leave_some_guests_out_of_the_delay(admin, booking_payload):
    a, _ = paid(admin, booking_payload, hour=15)
    b = walk_in(admin, courtId="court-2", hour=15)
    res = admin.post("/api/admin/rain-delay", json={"date": "2026-10-10", "fromHour": 14, "hours": 3, "codes": [a]}).json()
    assert [x["code"] for x in res["moved"]] == [a]
    assert admin.get(f"/api/admin/bookings/{b}").json()["label"] == "paid" and slot_state(admin, 15, court="court-2") == "booked"


def test_late_and_finished_bookings_are_left_alone(admin, booking_payload, fake_now):
    done = walk_in(admin, hour=9)  # 9-10 AM: already over once the clock moves
    late, _ = paid(admin, booking_payload, hour=12)
    fake_now.current = datetime(2026, 10, 10, 12, 30, tzinfo=MANILA).astimezone(UTC)
    res = admin.post("/api/admin/rain-delay", json={"date": "2026-10-10", "fromHour": 9, "hours": 6}).json()
    assert res["moved"] == []
    assert admin.get(f"/api/admin/bookings/{late}").json()["label"] == "late"
    assert admin.get(f"/api/admin/bookings/{done}").json()["label"] == "done"


# ── The guest picks a new time ────────────────────────────────────────────────
def test_a_rain_delayed_guest_can_move_even_inside_48_hours_and_it_costs_no_reschedule(admin, booking_payload):
    code, headers = paid(admin, booking_payload, hour=15)  # today at 3 PM: far inside the 48 hours
    admin.post("/api/admin/rain-delay", json={"date": "2026-10-10", "fromHour": 14, "hours": 3})
    res = admin.post("/api/reschedule", json={"code": code, "customerPhone": "0917 123 4567", "date": "2026-10-11", "hour": 15})
    assert res.status_code == 200, res.text
    b = res.json()
    assert b["weatherHold"] is False and b["status"] == "confirmed" and b["playDate"] == "2026-10-11"
    assert b["rescheduleCount"] == 0 and b["reschedule"] == "too_late"  # still inside 48 h for a normal move, and the one is unspent
    assert slot_state(admin, 15, date="2026-10-11") == "booked"
    assert admin.get(f"/api/admin/bookings/{code}").json()["events"][0]["action"] == "rain_rescheduled"
    assert admin.get("/api/admin/counts").json()["rainDelay"] == 0


def test_a_guest_whose_rain_delay_was_for_a_week_ago_still_has_30_days(admin, booking_payload, fake_now):
    code, _ = paid(admin, booking_payload, hour=15)
    admin.post("/api/admin/rain-delay", json={"date": "2026-10-10", "fromHour": 14, "hours": 3})
    fake_now.advance(days=10)
    out = admin.post("/api/reschedule/find", json={"code": code, "customerPhone": "09171234567"}).json()
    assert out["booking"]["reschedule"] == "weather" and out["earliestDate"] == "2026-10-20" and out["latestDate"] == "2026-11-09"


# ── Telegram ──────────────────────────────────────────────────────────────────
def test_the_host_hears_about_rain_once_per_day(admin, booking_payload, forecast, monkeypatch):
    from dataclasses import replace

    from app import notify
    from app.db import connect

    forecast(forecast_payload())
    monkeypatch.setattr(notify, "settings", replace(notify.settings, telegram_bot_token="t", telegram_chat_id="1"))
    sent = []
    monkeypatch.setattr(notify, "send", lambda text: sent.append(text) or True)
    paid(admin, booking_payload, hour=15, hours=2)
    paid(admin, booking_payload, date="2026-10-12", hour=15, customerPhone="09181112222")  # dry: no alert
    conn = connect()
    try:
        assert notify.check_rain(conn) == 1 and notify.check_rain(conn) == 0
    finally:
        conn.close()
    assert len(sent) == 1 and "Sat Oct 10" in sent[0] and "80%" in sent[0] and "1 paid booking " in sent[0]
