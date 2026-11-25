"""A payment that arrives after the hold ran out (plan item 9, D3: within 30 minutes).

If nobody took the hours meanwhile, the payment confirms the booking as usual. If someone did, the payment is kept on
the expired booking ("paid after time ran out") for the host to move or refund, the host is pinged and the player is
told. The reference rules don't change: one reference backs one booking, and anything refused gets the one quiet reply.
The fake clock starts on Sat Oct 10 2026, 10:00 AM Manila; holds last 10 minutes plus a 10 s grace.
"""

from dataclasses import replace

import pytest

from app import booking_service, notify
from app.validation import REFERENCE_REJECTED

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
REF = "4821 9053 37164"
TOLD = booking_service.PAID_AFTER_EXPIRY


def hold(client, booking_payload, **kw):
    res = client.post("/api/bookings", json=booking_payload(**kw))
    assert res.status_code == 201, res.text
    body = res.json()
    return body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}


def pay(client, code, headers, ref=REF, name="Juan dela Cruz"):
    return client.post(f"/api/bookings/{code}/reference", headers=headers, json={"referenceNumber": ref, "payerName": name})


def slot_state(client, hour, court="court-1"):
    data = client.get("/api/availability", params={"date": "2026-10-10"}).json()
    return next(s for s in data["slots"] if s["hour"] == hour)["courts"][court]


def test_the_pay_screen_is_told_the_late_window(client):
    assert client.get("/api/config").json()["latePaymentMinutes"] == 30


def test_a_payment_just_after_the_timer_with_the_hour_still_free_is_confirmed(admin, booking_payload, fake_now):
    code, headers = hold(admin, booking_payload, hour=19)
    fake_now.advance(minutes=10, seconds=11)
    assert slot_state(admin, 19) == "available"  # the hold ran out and gave the hour back
    res = pay(admin, code, headers)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "confirmed" and res.json()["paidLate"] is False
    assert slot_state(admin, 19) == "booked"
    d = admin.get(f"/api/admin/bookings/{code}").json()
    assert d["label"] == "paid" and d["referenceNumber"] == "4821905337164" and d["closedAt"] is None
    assert d["events"][0]["action"] == "paid_after_timer" and "11 s" in d["events"][0]["detail"]


def test_a_payment_after_the_timer_with_the_hour_taken_is_kept_flagged_and_told(admin, booking_payload, fake_now, monkeypatch):
    code, headers = hold(admin, booking_payload, hour=19, customerName="Slow Payer")
    fake_now.advance(minutes=10, seconds=11)
    other, _ = hold(admin, booking_payload, hour=19, customerPhone="09181112222", customerName="Fast Payer")
    fake_now.advance(minutes=4)

    res = pay(admin, code, headers, name="Slow Payer")
    assert res.status_code == 409 and res.json()["error"] == {"code": "paid_after_expiry", "message": TOLD}
    assert slot_state(admin, 19) == "held"  # the fast payer keeps the hour

    # The player sees what happened on their pass.
    mine = admin.get(f"/api/bookings/{code}", headers=headers).json()
    assert mine["status"] == "expired" and mine["paidLate"] is True and mine["paymentReference"] == "4821905337164"
    # The desk has the payment, under its own label and filter, and in All.
    d = admin.get(f"/api/admin/bookings/{code}").json()
    assert d["status"] == "expired" and d["label"] == "paid_late" and d["paidLate"] is True
    assert d["referenceNumber"] == "4821905337164" and d["payerName"] == "Slow Payer" and d["paidLateAt"]
    assert d["events"][0]["action"] == "paid_late"
    assert admin.get("/api/admin/counts").json()["paidLate"] == 1
    listing = admin.get("/api/admin/bookings").json()
    assert code in {b["code"] for b in listing["items"]} and listing["counts"]["paidLate"] == 1
    assert [b["code"] for b in admin.get("/api/admin/bookings", params={"label": "paid_late"}).json()["items"]] == [code]

    # The host hears about it once.
    monkeypatch.setattr(notify, "settings", replace(notify.settings, telegram_bot_token="t", telegram_chat_id="1"))
    sent = []
    monkeypatch.setattr(notify, "send", lambda text: sent.append(text) or True)
    from app.db import connect

    conn = connect()
    try:
        assert notify.check_paid_late(conn) == 1 and notify.check_paid_late(conn) == 0
    finally:
        conn.close()
    assert "Slow Payer" in sent[0] and "4821905337164" in sent[0] and code in sent[0]

    # A second try on the same booking is refused, and the reference stays spent for any other booking.
    again = pay(admin, code, headers, name="Slow Payer")
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_submitted"
    third, third_headers = hold(admin, booking_payload, hour=21, customerPhone="09181114444")
    dup = pay(admin, third, third_headers)
    assert dup.status_code == 400 and dup.json()["error"] == {"code": "reference_rejected", "message": REFERENCE_REJECTED}
    assert other  # (the fast payer's hold is untouched by all this)


def test_the_host_moves_a_paid_late_booking_to_a_free_time(admin, booking_payload, fake_now):
    code, headers = hold(admin, booking_payload, hour=19)
    fake_now.advance(minutes=10, seconds=11)
    hold(admin, booking_payload, hour=19, customerPhone="09181112222")
    assert pay(admin, code, headers).json()["error"]["code"] == "paid_after_expiry"
    # Reopening at the same time can't work (someone has it); move it first, then reopen.
    assert admin.post(f"/api/admin/bookings/{code}/confirm").json()["error"]["code"] == "slot_taken"
    assert admin.patch(f"/api/admin/bookings/{code}", json={"hour": 21}).status_code == 200
    b = admin.post(f"/api/admin/bookings/{code}/confirm").json()
    assert b["status"] == "confirmed" and b["label"] == "paid" and b["hour"] == 21 and b["paidLate"] is False
    assert slot_state(admin, 21) == "booked" and admin.get("/api/admin/counts").json()["paidLate"] == 0


def test_a_payment_after_the_late_window_gets_the_usual_reply(client, booking_payload, fake_now):
    code, headers = hold(client, booking_payload, hour=19)
    fake_now.advance(minutes=10 + 30, seconds=1)  # the hold's deadline plus 30 minutes
    res = pay(client, code, headers)
    assert res.status_code == 410 and res.json()["error"]["code"] == "hold_expired"
    assert client.get(f"/api/bookings/{code}", headers=headers).json()["paidLate"] is False


@pytest.mark.parametrize("bad", ["duplicate", "made_up"])
def test_a_refused_reference_after_the_timer_gets_the_same_quiet_reply(client, booking_payload, fake_now, bad):
    first, h1 = hold(client, booking_payload, hour=18)
    assert pay(client, first, h1).status_code == 200
    code, headers = hold(client, booking_payload, hour=19, customerPhone="09181112222")
    fake_now.advance(minutes=10, seconds=11)
    res = pay(client, code, headers, ref=REF if bad == "duplicate" else "1111111111111")
    assert res.status_code == 400 and res.json()["error"] == {"code": "reference_rejected", "message": REFERENCE_REJECTED}
    assert slot_state(client, 19) == "available"  # a refused payment takes nothing back
    assert client.get(f"/api/bookings/{code}", headers=headers).json()["status"] == "expired"


def test_a_late_receipt_is_kept_too(admin, booking_payload, fake_now):
    # (Receipt uploads are off on the live site; the same rule holds when they're on.)
    code, headers = hold(admin, booking_payload, hour=19)
    fake_now.advance(minutes=10, seconds=11)
    hold(admin, booking_payload, hour=19, customerPhone="09181112222")
    res = admin.post(f"/api/bookings/{code}/receipt", headers=headers, files={"receipt": ("r.png", PNG + b"late")})
    assert res.status_code == 409 and res.json()["error"]["code"] == "paid_after_expiry"
    d = admin.get(f"/api/admin/bookings/{code}").json()
    assert d["label"] == "paid_late" and d["hasReceipt"] is True and d["proofType"] == "receipt"


def test_a_late_receipt_with_the_hour_free_confirms(admin, booking_payload, fake_now):
    code, headers = hold(admin, booking_payload, hour=19)
    fake_now.advance(minutes=12)
    res = admin.post(f"/api/bookings/{code}/receipt", headers=headers, files={"receipt": ("r.png", PNG + b"free")})
    assert res.status_code == 200 and res.json()["status"] == "confirmed"
    assert slot_state(admin, 19) == "booked"
