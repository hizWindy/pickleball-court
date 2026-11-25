"""MariBank as a third way to pay (item 15 of IMPLEMENTATION_PLAN.md).

Its QR is InstaPay, so a player may pay it from GCash (a 13-number reference) or from the MariBank app, whose own
receipt reference isn't known yet (plan A2): until it is, a MariBank booking also takes an all-digit reference of 10 to
20 numbers (MARIBANK_REFERENCE_DIGITS). The made-up-number rules and the one quiet reply apply to it like to any other.
"""

from dataclasses import replace

import pytest

from app import booking_service
from app.config import PaymentAccount, _env_lengths
from app.validation import REFERENCE_FORMAT_HINT, REFERENCE_GCASH_HINT, REFERENCE_REJECTED, normalize_reference

MARIBANK_REF = "7302 5518 0946 2261"  # 16 numbers: stands in for a MariBank app receipt until real ones are in


def book(client, booking_payload, **kw):
    res = client.post("/api/bookings", json=booking_payload(paymentMethod="maribank", **kw))
    assert res.status_code == 201, res.text
    body = res.json()
    return body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}


def pay(client, code, headers, ref, name="Juan dela Cruz"):
    return client.post(f"/api/bookings/{code}/reference", headers=headers, json={"referenceNumber": ref, "payerName": name})


# ── The settings ──────────────────────────────────────────────────────────────
def test_the_pay_options_are_gcash_gotyme_maribank_in_that_order(client):
    accounts = client.get("/api/config").json()["paymentAccounts"]
    assert [a["method"] for a in accounts] == ["gcash", "gotyme", "maribank"]
    mari = accounts[2]
    assert mari["label"] == "MariBank" and mari["enabled"] is True
    assert mari["accountName"] == "Reymark Vergara" and mari["accountNumber"] == "" and mari["accountHint"] == "•••• 8703"
    assert mari["qrImage"] == "/images/payment-qr-maribank.jpg"
    assert mari["referenceDigits"] == list(range(10, 21))
    assert accounts[0]["referenceDigits"] == []  # GCash's own 13 numbers need no extra


def test_maribank_is_switched_off_with_neither_a_number_nor_a_qr(client, booking_payload, monkeypatch):
    off = PaymentAccount("maribank", "MariBank", "Reymark Vergara", "", qr_image="", account_hint="•••• 8703")
    monkeypatch.setattr(booking_service, "settings", replace(booking_service.settings, maribank=off))
    mari = next(a for a in client.get("/api/config").json()["paymentAccounts"] if a["method"] == "maribank")
    assert mari["enabled"] is False
    res = client.post("/api/bookings", json=booking_payload(paymentMethod="maribank"))
    assert res.status_code == 400 and res.json()["error"]["code"] == "payment_unavailable"


@pytest.mark.parametrize("raw, lengths", [("10-20", tuple(range(10, 21))), ("12,16", (12, 16)), ("12,14-16", (12, 14, 15, 16)), ("", ())])
def test_the_reference_lengths_are_a_setting(monkeypatch, raw, lengths):
    monkeypatch.setenv("MARIBANK_REFERENCE_DIGITS", raw)
    assert _env_lengths("MARIBANK_REFERENCE_DIGITS", "10-20") == lengths


# ── Paying ────────────────────────────────────────────────────────────────────
def test_a_maribank_booking_is_paid_with_a_maribank_reference_and_says_maribank(admin, booking_payload):
    code, headers = book(admin, booking_payload)
    res = pay(admin, code, headers, MARIBANK_REF)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "confirmed" and res.json()["paymentMethod"] == "maribank"
    assert res.json()["paymentReference"] == "7302551809462261"
    detail = admin.get(f"/api/admin/bookings/{code}").json()
    assert detail["paymentMethod"] == "maribank" and detail["referenceNumber"] == "7302551809462261"


def test_a_maribank_qr_paid_from_gcash_takes_the_gcash_reference(client, booking_payload):
    code, headers = book(client, booking_payload)
    assert pay(client, code, headers, "4821 905 337164").status_code == 200


def test_only_a_maribank_booking_takes_maribank_length_numbers(client, booking_payload):
    gcash = client.post("/api/bookings", json=booking_payload(hour=20)).json()
    res = pay(client, gcash["booking"]["code"], {"X-Booking-Token": gcash["accessToken"]}, MARIBANK_REF)
    assert res.status_code == 400 and res.json()["error"] == {"code": "reference_invalid", "message": REFERENCE_GCASH_HINT}
    # On a MariBank booking a wrong length gets a neutral hint: it may be another bank's number, not a short GCash one.
    code, headers = book(client, booking_payload)
    res = pay(client, code, headers, "123456789")
    assert res.status_code == 400 and res.json()["error"] == {"code": "reference_invalid", "message": REFERENCE_FORMAT_HINT}


def test_made_up_maribank_numbers_get_the_same_quiet_reply(client, booking_payload):
    code, headers = book(client, booking_payload)
    replies = [pay(client, code, headers, ref) for ref in ("1111111111111111", "1234567890123456", "1212121212121212")]
    assert {r.status_code for r in replies} == {400}
    assert all(r.json() == {"error": {"code": "reference_rejected", "message": REFERENCE_REJECTED}} for r in replies)
    assert pay(client, code, headers, MARIBANK_REF).status_code == 200  # (three tries are not the five that lock it)

    # The same reference can't pay for a second booking, and that reply is the same one.
    other, other_headers = book(client, booking_payload, hour=20, customerPhone="09181112222")
    again = pay(client, other, other_headers, MARIBANK_REF)
    assert again.status_code == 400 and again.json() == replies[0].json()


def test_the_rule_on_its_own():
    lengths = tuple(range(10, 21))
    assert normalize_reference("7302-5518-0946-2261", also_digits=lengths) == "7302551809462261"
    assert normalize_reference("4821905337164", also_digits=lengths) == "4821905337164"
    with pytest.raises(ValueError) as exc:
        normalize_reference("7302551809462261")  # not on a MariBank booking
    assert str(exc.value) == REFERENCE_GCASH_HINT


# ── The desk ──────────────────────────────────────────────────────────────────
def test_the_desk_can_add_a_maribank_walk_in_and_the_overview_counts_it(admin):
    res = admin.post("/api/admin/bookings", json={
        "kind": "walk_in", "courtId": "court-1", "date": "2026-10-10", "hour": 15, "hours": 1,
        "customerName": "Maria Santos", "customerPhone": "", "paymentMethod": "maribank",
    })
    assert res.status_code == 201, res.text
    assert res.json()["paymentMethod"] == "maribank"
    by_method = admin.get("/api/admin/overview", params={"days": 7}).json()["byMethod"]
    assert {"method": "maribank", "revenue": 200, "bookings": 1} in by_method
