"""The default (GUEST_RESCHEDULE off): a paid booking moves only when the host calls a rebooking for bad weather."""

from dataclasses import replace

import pytest

from app import booking_service

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PHONE = "0917 123 4567"


@pytest.fixture(autouse=True)
def host_decides(monkeypatch):
    monkeypatch.setattr(booking_service, "settings", replace(booking_service.settings, guest_reschedule=False))


def paid(client, booking_payload, **overrides):
    body = client.post("/api/bookings", json=booking_payload(**overrides)).json()
    code, headers = body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}
    res = client.post(f"/api/bookings/{code}/receipt", headers=headers, files={"receipt": ("r.png", PNG + code.encode())})
    assert res.status_code == 200, res.text
    return code


def find(client, code):
    return client.post("/api/reschedule/find", json={"code": code, "customerPhone": PHONE})


def move(client, code, date, hour):
    return client.post("/api/reschedule", json={"code": code, "customerPhone": PHONE, "date": date, "hour": hour})


def test_config_says_the_host_decides(client):
    assert client.get("/api/config").json()["guestReschedule"] is False


def test_an_ordinary_booking_cannot_be_moved_by_the_guest(client, booking_payload):
    code = paid(client, booking_payload, date="2026-10-14", hour=19)  # four days ahead: would be allowed if guests could
    found = find(client, code).json()
    assert found["booking"]["status"] == "confirmed" and found["booking"]["reschedule"] == "unavailable"

    res = move(client, code, "2026-10-15", 19)
    assert res.status_code == 409 and res.json()["error"]["code"] == "reschedule_unavailable"
    assert find(client, code).json()["booking"]["startAt"] == found["booking"]["startAt"]  # nothing moved


def test_a_rebooking_called_by_the_host_opens_it_for_the_guest(admin, booking_payload):
    code = paid(admin, booking_payload, date="2026-10-14", hour=19)
    assert find(admin, code).json()["booking"]["reschedule"] == "unavailable"

    called = admin.post("/api/admin/rain-delay", json={"date": "2026-10-14", "fromHour": 5, "hours": 24, "codes": [code]})
    assert called.status_code == 200 and [b["code"] for b in called.json()["moved"]] == [code]

    assert find(admin, code).json()["booking"]["reschedule"] == "weather"
    res = move(admin, code, "2026-10-15", 19)
    assert res.status_code == 200, res.text
    booking = res.json()
    assert booking["weatherHold"] is False and booking["rescheduleCount"] == 0  # free: no reschedule used
    assert find(admin, code).json()["booking"]["reschedule"] == "unavailable"  # and it is closed again
