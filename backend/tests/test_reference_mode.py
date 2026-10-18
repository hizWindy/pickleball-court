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


# ── One payment, one booking ──────────────────────────────────────────────────
REF = "1092 8374 61928"


def test_the_same_reference_is_refused_however_it_is_written(admin, booking_payload):
    first, h1 = _book(admin, booking_payload)
    assert admin.post(f"/api/bookings/{first}/reference", headers=h1, json={"referenceNumber": REF, "payerName": "Juan"}).status_code == 200

    second, h2 = _book(admin, booking_payload, hour=20)
    for spelling in ("1092837461928", "1092-8374-61928", "1092 837 461928", "  1092 8374 61928  "):
        res = admin.post(f"/api/bookings/{second}/reference", headers=h2, json={"referenceNumber": spelling, "payerName": "Maria"})
        assert res.status_code == 409, spelling
        err = res.json()["error"]
        assert err["code"] == "reference_used" and "already linked to another booking" in err["message"]
    # the second guest can still pay properly, and the first booking is untouched
    assert admin.get(f"/api/bookings/{second}", headers=h2).json()["status"] == "held"
    assert admin.post(f"/api/bookings/{second}/reference", headers=h2, json={"referenceNumber": "2092 8374 61929", "payerName": "Maria"}).status_code == 200
    assert admin.get(f"/api/admin/bookings/{first}").json()["referenceNumber"] == "1092837461928"


def test_a_rejected_bookings_reference_stays_used(admin, booking_payload):
    first, h1 = _book(admin, booking_payload)
    admin.post(f"/api/bookings/{first}/reference", headers=h1, json={"referenceNumber": REF, "payerName": "Juan"})
    assert admin.post(f"/api/admin/bookings/{first}/reject", json={"reason": "Not paid to us"}).status_code == 200

    second, h2 = _book(admin, booking_payload, hour=20)
    res = admin.post(f"/api/bookings/{second}/reference", headers=h2, json={"referenceNumber": REF, "payerName": "Maria"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "reference_used"


def test_the_database_itself_refuses_a_second_booking_with_the_same_reference(admin, booking_payload):
    import sqlite3

    from app.db import connect

    a, ha = _book(admin, booking_payload)
    admin.post(f"/api/bookings/{a}/reference", headers=ha, json={"referenceNumber": REF, "payerName": "Juan"})
    b, _ = _book(admin, booking_payload, hour=20)

    conn = connect()
    try:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE bookings SET reference_number = '1092837461928' WHERE code = ?", (b,))
    finally:
        conn.close()
