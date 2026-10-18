"""The default way to pay (PROOF_MODE=reference): type the reference number and the sender's name. No upload, no OCR, no time."""

from dataclasses import replace

import pytest

from app import booking_service

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(autouse=True)
def reference_mode(monkeypatch):
    monkeypatch.setattr(booking_service, "settings", replace(booking_service.settings, proof_mode="reference"))


def _book(client, booking_payload, **kw):
    body = client.post("/api/bookings", json=booking_payload(**kw)).json()
    return body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}


def test_config_tells_the_page_to_ask_for_typed_details(client):
    assert client.get("/api/config").json()["proofMode"] == "reference"


def test_typing_the_reference_and_name_confirms_with_no_time_and_no_notes(admin, booking_payload, fake_now):
    code, headers = _book(admin, booking_payload)
    fake_now.advance(minutes=4)
    res = admin.post(f"/api/bookings/{code}/reference", headers=headers,
                     json={"referenceNumber": "1092 8374 61928", "payerName": "Juan dela Cruz"})
    assert res.status_code == 200 and res.json()["status"] == "confirmed"

    d = admin.get(f"/api/admin/bookings/{code}").json()
    assert d["referenceNumber"] == "1092837461928" and d["payerName"] == "Juan dela Cruz"
    assert d["paidAt"] is None  # no exact time: the host sees the window from createdAt to submittedAt
    assert d["reviewFlags"] == [] and d["label"] == "paid" and d["scan"] is None
    assert d["createdAt"] < d["submittedAt"]


def test_the_sender_name_is_still_required(admin, booking_payload):
    code, headers = _book(admin, booking_payload)
    res = admin.post(f"/api/bookings/{code}/reference", headers=headers, json={"referenceNumber": "1092 8374 61928"})
    assert res.status_code == 422


def test_a_reference_can_only_pay_for_one_booking(client, booking_payload):
    a, ha = _book(client, booking_payload)
    body = {"referenceNumber": "1092 8374 61928", "payerName": "Juan"}
    assert client.post(f"/api/bookings/{a}/reference", headers=ha, json=body).status_code == 200
    b, hb = _book(client, booking_payload, customerPhone="09181112222", hour=20)
    res = client.post(f"/api/bookings/{b}/reference", headers=hb, json=body)
    assert res.status_code == 409 and res.json()["error"]["code"] == "reference_used"
    assert client.get(f"/api/bookings/{b}", headers=hb).json()["status"] == "held"


def test_receipt_uploads_are_switched_off(client, booking_payload):
    code, headers = _book(client, booking_payload)
    res = client.post(f"/api/bookings/{code}/receipt", headers=headers, files={"receipt": ("r.png", PNG)})
    assert res.status_code == 400 and res.json()["error"]["code"] == "receipt_disabled"
    assert client.get(f"/api/bookings/{code}", headers=headers).json()["status"] == "held"
