"""The demo seeder: one command gives a local database every state worth looking at."""

import pytest

from app import seed_demo
from app.config import settings


def _rows(admin):
    items = admin.get("/api/admin/bookings", params={"pageSize": 100}).json()["items"]
    return [b for b in items if b["customerPhone"] == seed_demo.DEMO_PHONE_STORED]


def test_the_seeder_makes_every_state_and_can_run_twice(admin):
    first = seed_demo.run()
    codes = {r[0] for r in first}
    assert len(codes) == len(first) == 9

    labels = sorted(b["label"] for b in _rows(admin))
    assert labels == ["awaiting", "expired", "paid", "paid", "paid", "paid", "paid", "rain_delay", "rain_delay"]

    # A rain-delayed guest can look the booking up and is offered the free rebooking; a paid one is not.
    by_code = {b["code"]: b for b in _rows(admin)}
    rainy = next(c for c, b in by_code.items() if b["label"] == "rain_delay")
    normal = next(c for c, b in by_code.items() if b["label"] == "paid")
    look = lambda c: admin.post("/api/reschedule/find", json={"code": c, "customerPhone": seed_demo.DEMO_PHONE}).json()["booking"]  # noqa: E731
    assert look(rainy)["reschedule"] == "weather"
    assert look(normal)["status"] == "confirmed"

    # Running it again replaces the demo bookings instead of piling up.
    second = seed_demo.run()
    assert len(_rows(admin)) == 9
    assert not codes & {r[0] for r in second}


def test_the_seeder_never_touches_a_real_booking(admin, booking_payload):
    mine = admin.post("/api/bookings", json=booking_payload(customerPhone="0917 555 0100", date="2026-10-14", hour=19)).json()["booking"]["code"]
    seed_demo.run()
    seed_demo.run()
    assert admin.get(f"/api/admin/bookings/{mine}").status_code == 200


def test_the_seeder_refuses_to_run_on_the_live_server(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    with pytest.raises(seed_demo.NotHere):
        seed_demo.run()
    monkeypatch.delenv("RENDER")
    assert settings.data_dir  # the guard is about where the data lives, not this test's temp folder
