"""Two courts in one booking (plan item 11, with the recommended D5: the paddle fee is per court, the host can void or
reject one court on its own, and Arrived / Late work per court).

Each court is its own row at the desk, linked by `group_id`; the player sees one booking under one code and pays once.
The fake clock starts on Sat Oct 10 2026, 10:00 AM Manila; holds last 10 minutes plus a 10 s grace.
"""

import sqlite3
from dataclasses import replace

import pytest

from app import db, notify
from app.db import connect
from app.validation import REFERENCE_REJECTED

REF = "4821 9053 37164"
BOTH = ["court-1", "court-2"]


def book(client, booking_payload, courts=BOTH, **kw):
    body = booking_payload(**kw)
    body.pop("courtId")
    body["courtIds"] = courts
    return client.post("/api/bookings", json=body)


def hold(client, booking_payload, courts=BOTH, **kw):
    res = book(client, booking_payload, courts, **kw)
    assert res.status_code == 201, res.text
    body = res.json()
    return body["booking"], {"X-Booking-Token": body["accessToken"]}


def pay(client, code, headers, ref=REF, name="Juan dela Cruz"):
    return client.post(f"/api/bookings/{code}/reference", headers=headers, json={"referenceNumber": ref, "payerName": name})


def paid_pair(client, booking_payload, ref=REF, **kw):
    booking, headers = hold(client, booking_payload, **kw)
    res = pay(client, booking["code"], headers, ref=ref)
    assert res.status_code == 200, res.text
    return res.json(), headers


def courts_at(client, hour, date="2026-10-10"):
    slots = client.get("/api/availability", params={"date": date}).json()["slots"]
    return next(s for s in slots if s["hour"] == hour)["courts"]


def rows():
    conn = connect()
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM bookings ORDER BY court_id, start_at")]
    finally:
        conn.close()


def taken_courts():
    """Which courts hold any hours (availability says "past" once an hour has begun)."""
    conn = connect()
    try:
        return {r["court_id"] for r in conn.execute("SELECT court_id FROM booking_slots")}
    finally:
        conn.close()


def second_code(admin, lead_code):
    linked = admin.get(f"/api/admin/bookings/{lead_code}").json()["linked"]
    assert len(linked) == 1
    return linked[0]["code"]


# ── Booking both courts ───────────────────────────────────────────────────────
def test_both_courts_free_make_one_booking_of_two_rows_at_one_combined_price(admin, booking_payload):
    # 7-9 PM on both courts: 2 courts x 2 hours x 250 = 1,000 (the example in the plan).
    booking, _ = hold(admin, booking_payload, hour=19, hours=2)
    assert booking["courtName"] == "Court 1 & Court 2" and booking["courtId"] == "court-1"
    assert [(c["courtId"], c["status"], c["total"]) for c in booking["courts"]] == [("court-1", "held", 500), ("court-2", "held", 500)]
    assert (booking["courtCost"], booking["addonsCost"], booking["total"]) == (1000, 0, 1000)
    assert sorted((li["courtId"], li["rate"]) for li in booking["lineItems"]) == [("court-1", 250)] * 2 + [("court-2", 250)] * 2

    lead, other = rows()
    assert lead["code"] == booking["code"] and lead["court_id"] == "court-1"
    assert lead["group_id"] == other["group_id"] == lead["id"]  # linked by the lead's id
    assert (lead["total"], other["total"]) == (500, 500)
    assert lead["hold_expires_at"] == other["hold_expires_at"]  # one timer
    assert courts_at(admin, 19) == courts_at(admin, 20) == {"court-1": "held", "court-2": "held"}

    # The desk sees two bookings, each pointing at the other, and what the whole booking costs.
    items = admin.get("/api/admin/bookings").json()["items"]
    by_court = {b["courtId"]: b for b in items}
    assert by_court["court-1"]["linked"][0]["code"] == by_court["court-2"]["code"]
    assert by_court["court-2"]["linked"][0]["code"] == by_court["court-1"]["code"]
    assert by_court["court-1"]["groupTotal"] == by_court["court-2"]["groupTotal"] == 1000
    assert by_court["court-1"]["groupId"] == by_court["court-2"]["groupId"] == lead["id"]


@pytest.mark.parametrize("taken_hour, court", [(19, "court-1"), (20, "court-2")])
def test_one_court_taken_at_any_hour_books_nothing_and_says_which(client, booking_payload, taken_hour, court):
    first = client.post("/api/bookings", json=booking_payload(courtId=court, hour=taken_hour, customerPhone="09181112222"))
    assert first.status_code == 201
    res = book(client, booking_payload, hour=19, hours=2)
    assert res.status_code == 409
    error = res.json()["error"]
    name, label = f"Court {court[-1]}", f"{taken_hour - 12}:00 PM"
    assert error["code"] == "slot_taken"
    assert error["message"] == f"{name} at {label} was just taken, so neither court was booked. Please choose another time, or book one court."
    assert len(rows()) == 1  # nothing of the two-court booking was kept
    free = "court-2" if court == "court-1" else "court-1"
    assert courts_at(client, 19)[free] == courts_at(client, 20)[free] == "available"


def test_a_single_court_request_still_works(client, booking_payload):
    # What a phone still running the previous version sends.
    res = client.post("/api/bookings", json=booking_payload(courtId="court-2"))
    assert res.status_code == 201, res.text
    b = res.json()["booking"]
    assert (b["courtId"], b["courtName"], b["total"]) == ("court-2", "Court 2", 250)
    assert [c["courtId"] for c in b["courts"]] == ["court-2"]
    assert rows()[0]["group_id"] is None
    # One court in the new list is the same thing; a court named twice counts once.
    for courts in (["court-1"], ["court-1", "court-1"]):
        one, headers = hold(client, booking_payload, courts, hour=21, customerPhone="09181112222")
        assert one["courtName"] == "Court 1" and len(one["courts"]) == 1
        client.post(f"/api/bookings/{one['code']}/release", headers=headers)  # (one device may hold two at a time)


@pytest.mark.parametrize("courts, status, code", [
    ([], 422, "invalid_input"),
    (["court-1", "court-2", "court-3"], 422, "invalid_input"),
    (["court-1", "court-9"], 400, "court_invalid"),
])
def test_a_bad_court_list_is_refused(client, booking_payload, courts, status, code):
    res = book(client, booking_payload, courts)
    assert res.status_code == status and res.json()["error"]["code"] == code
    assert rows() == []


def test_paddles_are_rented_per_court(client, booking_payload):
    # D5: one pair of paddles per court. 7-9 PM on both courts with paddles: 1,000 + 2 x 80.
    booking, _ = hold(client, booking_payload, hour=19, hours=2, paddles=True)
    assert (booking["courtCost"], booking["addonsCost"], booking["total"]) == (1000, 160, 1160)
    assert [r["total"] for r in rows()] == [580, 580]


def test_morning_evening_and_across_6_pm_add_up_per_court(client, booking_payload):
    # 5-7 PM: 200 (Morning) + 250 (Evening) on each court.
    booking, _ = hold(client, booking_payload, hour=17, hours=2)
    assert booking["total"] == 900 and [r["court_cost"] for r in rows()] == [450, 450]


def test_the_per_device_limit_counts_the_pair_once(client, booking_payload):
    hold(client, booking_payload, hour=19)  # both courts: one booking waiting for payment
    one = client.post("/api/bookings", json=booking_payload(hour=21, customerPhone="09181112222"))
    assert one.status_code == 201  # the second booking from this device is still allowed (the limit is 2)
    third = client.post("/api/bookings", json=booking_payload(hour=22, customerPhone="09181113333"))
    assert third.status_code == 429 and third.json()["error"]["code"] == "hold_limit"


# ── Paying ────────────────────────────────────────────────────────────────────
def test_one_payment_confirms_both_and_the_reference_is_stored_once(admin, booking_payload):
    booking, headers = hold(admin, booking_payload, hour=19, hours=2)
    res = pay(admin, booking["code"], headers)
    assert res.status_code == 200, res.text
    b = res.json()
    assert b["status"] == "confirmed" and [c["status"] for c in b["courts"]] == ["confirmed", "confirmed"]
    assert b["paymentReference"] == "4821905337164" and b["total"] == 1000
    assert courts_at(admin, 19) == courts_at(admin, 20) == {"court-1": "booked", "court-2": "booked"}

    lead, other = rows()
    assert lead["reference_number"] == "4821905337164" and other["reference_number"] is None  # one reference, one row
    assert lead["submitted_at"] and other["submitted_at"] and other["payer_name"] == "Juan dela Cruz"

    # The second court's booking shows the shared payment and where it is kept.
    d = admin.get(f"/api/admin/bookings/{other['code']}").json()
    assert d["label"] == "paid" and d["referenceNumber"] == "4821905337164" and d["paymentCode"] == lead["code"]
    assert admin.get(f"/api/admin/bookings/{lead['code']}").json()["paymentCode"] is None
    # A search by the reference finds the booking.
    found = admin.get("/api/admin/bookings", params={"q": "4821905337164"}).json()["items"]
    assert [x["code"] for x in found] == [lead["code"]]

    # Another booking can't use the same payment: the usual quiet reply.
    single, single_headers = hold(admin, booking_payload, ["court-1"], hour=21, customerPhone="09181112222")
    dup = pay(admin, single["code"], single_headers)
    assert dup.status_code == 400 and dup.json()["error"] == {"code": "reference_rejected", "message": REFERENCE_REJECTED}
    # ...and the booking can't be paid twice.
    again = pay(admin, booking["code"], headers, ref="8046 020 281757")
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_submitted"


def test_a_receipt_pays_for_both_courts(admin, booking_payload):
    booking, headers = hold(admin, booking_payload, hour=19)
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64 + b"pair"
    res = admin.post(f"/api/bookings/{booking['code']}/receipt", headers=headers, files={"receipt": ("r.png", png)})
    assert res.status_code == 200 and [c["status"] for c in res.json()["courts"]] == ["confirmed", "confirmed"]
    lead, other = rows()
    assert lead["receipt_sha256"] and lead["receipt_path"] and other["receipt_sha256"] is None and other["receipt_path"] is None
    assert other["proof_type"] == "receipt"


def test_when_the_timer_runs_out_both_courts_are_freed(client, booking_payload, fake_now):
    booking, headers = hold(client, booking_payload, hour=19)
    fake_now.advance(minutes=10, seconds=11)
    assert courts_at(client, 19) == {"court-1": "available", "court-2": "available"}
    assert [r["status"] for r in rows()] == ["expired", "expired"]
    view = client.get(f"/api/bookings/{booking['code']}", headers=headers).json()
    assert view["status"] == "expired" and view["courtName"] == "Court 1 & Court 2"


def test_the_two_courts_share_one_timer(client, booking_payload, fake_now):
    # Even if one court's deadline were later, the booking runs out with the first one.
    hold(client, booking_payload, hour=19)
    conn = connect()
    conn.execute("UPDATE bookings SET hold_expires_at = '2099-01-01T00:00:00Z' WHERE court_id = 'court-2'")
    conn.close()
    fake_now.advance(minutes=10, seconds=11)
    assert courts_at(client, 19) == {"court-1": "available", "court-2": "available"}


def test_letting_the_hold_go_frees_both_courts(client, booking_payload):
    booking, headers = hold(client, booking_payload, hour=19)
    res = client.post(f"/api/bookings/{booking['code']}/release", headers=headers)
    assert res.status_code == 200 and res.json()["status"] == "cancelled"
    assert rows() == [] and courts_at(client, 19) == {"court-1": "available", "court-2": "available"}


def test_a_late_payment_takes_both_courts_back_when_both_are_free(admin, booking_payload, fake_now):
    booking, headers = hold(admin, booking_payload, hour=19)
    fake_now.advance(minutes=12)
    res = pay(admin, booking["code"], headers)
    assert res.status_code == 200 and [c["status"] for c in res.json()["courts"]] == ["confirmed", "confirmed"]
    assert courts_at(admin, 19) == {"court-1": "booked", "court-2": "booked"}


def test_a_late_payment_with_one_court_taken_is_kept_for_the_host(admin, booking_payload, fake_now, monkeypatch):
    booking, headers = hold(admin, booking_payload, hour=19, customerName="Slow Payer")
    fake_now.advance(minutes=12)
    admin.post("/api/bookings", json=booking_payload(courtId="court-2", hour=19, customerPhone="09181112222"))
    res = pay(admin, booking["code"], headers, name="Slow Payer")
    assert res.status_code == 409 and res.json()["error"]["code"] == "paid_after_expiry"
    # Nothing was taken back, not even the free court: the booking is both courts or nothing.
    assert courts_at(admin, 19) == {"court-1": "available", "court-2": "held"}
    lead, other = [r for r in rows() if r["customer_name"] == "Slow Payer"]
    assert lead["status"] == other["status"] == "expired" and lead["paid_late_at"] and other["paid_late_at"]
    assert lead["reference_number"] == "4821905337164" and other["reference_number"] is None
    assert admin.get(f"/api/bookings/{booking['code']}", headers=headers).json()["paidLate"] is True

    # One message for the host, about both courts and the whole amount.
    monkeypatch.setattr(notify, "settings", replace(notify.settings, telegram_bot_token="t", telegram_chat_id="1"))
    sent = []
    monkeypatch.setattr(notify, "send", lambda text: sent.append(text) or True)
    conn = connect()
    try:
        assert notify.check_paid_late(conn) == 1 and notify.check_paid_late(conn) == 0
    finally:
        conn.close()
    assert "Court 1 & Court 2" in sent[0] and "₱500" in sent[0] and booking["code"] in sent[0]


# ── At the desk ───────────────────────────────────────────────────────────────
def test_confirming_an_unpaid_pair_by_hand_confirms_both(admin, booking_payload):
    booking, _ = hold(admin, booking_payload, hour=19)
    other = second_code(admin, booking["code"])
    d = admin.post(f"/api/admin/bookings/{other}/confirm").json()  # from either court
    assert d["status"] == "confirmed" and d["linked"][0]["label"] == "paid"
    assert [r["status"] for r in rows()] == ["confirmed", "confirmed"]


def test_the_host_can_void_one_court_or_both(admin, booking_payload):
    booking, headers = paid_pair(admin, booking_payload, hour=19)
    other = second_code(admin, booking["code"])

    # D5: the group is smaller than booked: void only Court 2.
    d = admin.post(f"/api/admin/bookings/{other}/cancel", json={"reason": "Only one group came"}).json()
    assert d["status"] == "cancelled" and d["linked"][0]["label"] == "paid"
    assert courts_at(admin, 19) == {"court-1": "booked", "court-2": "available"}
    view = admin.get(f"/api/bookings/{booking['code']}", headers=headers).json()
    assert (view["status"], view["courtName"], view["total"]) == ("confirmed", "Court 1", 250)
    assert [(c["courtId"], c["status"]) for c in view["courts"]] == [("court-1", "confirmed"), ("court-2", "cancelled")]

    # Voiding the whole booking: both courts at once.
    again, _ = paid_pair(admin, booking_payload, ref="8046 020 281757", hour=21, customerPhone="09181112222")
    d = admin.post(f"/api/admin/bookings/{again['code']}/cancel", json={"bothCourts": True}).json()
    assert d["status"] == "cancelled" and d["linked"][0]["label"] == "cancelled"
    assert courts_at(admin, 21) == {"court-1": "available", "court-2": "available"}
    assert "both courts" in d["events"][0]["detail"]


def test_the_host_rejects_the_payment_for_both_courts_or_one(admin, booking_payload):
    booking, headers = paid_pair(admin, booking_payload, hour=19)
    d = admin.post(f"/api/admin/bookings/{booking['code']}/reject", json={"reason": "Reference not found", "bothCourts": True}).json()
    assert d["status"] == "rejected" and d["linked"][0]["label"] == "rejected"
    assert courts_at(admin, 19) == {"court-1": "available", "court-2": "available"}
    assert admin.get(f"/api/bookings/{booking['code']}", headers=headers).json()["status"] == "rejected"

    # Reopening is per court.
    assert admin.post(f"/api/admin/bookings/{booking['code']}/confirm").json()["status"] == "confirmed"
    assert courts_at(admin, 19) == {"court-1": "booked", "court-2": "available"}

    # Rejecting one court leaves the other paid.
    single, _ = paid_pair(admin, booking_payload, ref="8046 020 281757", hour=21, customerPhone="09181112222")
    other = second_code(admin, single["code"])
    assert admin.post(f"/api/admin/bookings/{other}/reject", json={}).json()["linked"][0]["label"] == "paid"
    assert courts_at(admin, 21) == {"court-1": "booked", "court-2": "available"}


def test_releasing_an_unpaid_pair_at_the_desk_lets_both_go(admin, booking_payload):
    booking, _ = hold(admin, booking_payload, hour=19)
    other = second_code(admin, booking["code"])
    assert admin.post(f"/api/admin/bookings/{other}/cancel", json={}).json()["status"] == "cancelled"
    assert rows() == [] and courts_at(admin, 19) == {"court-1": "available", "court-2": "available"}


def test_arrived_late_and_release_work_per_court(admin, booking_payload, fake_now):
    booking, headers = paid_pair(admin, booking_payload, hour=11)
    other = second_code(admin, booking["code"])
    fake_now.advance(hours=1, minutes=16)  # 11:16 AM: nobody tapped Arrived on either court
    assert {b["code"]: b["label"] for b in admin.get("/api/admin/bookings").json()["items"]} == {booking["code"]: "late", other: "late"}
    assert admin.get(f"/api/bookings/{booking['code']}", headers=headers).json()["late"] is True

    # One group is here; the other court goes to others (D5).
    assert admin.post(f"/api/admin/bookings/{booking['code']}/arrived").json()["label"] == "paid"
    d = admin.post(f"/api/admin/bookings/{other}/release", json={}).json()
    assert d["label"] == "late" and d["holdsCourt"] is False
    assert taken_courts() == {"court-1"}
    view = admin.get(f"/api/bookings/{booking['code']}", headers=headers).json()
    assert view["arrived"] is True and view["late"] is False


def test_the_schedule_shows_both_courts_linked(admin, booking_payload):
    booking, _ = paid_pair(admin, booking_payload, hour=19)
    cards = admin.get("/api/admin/schedule", params={"date": "2026-10-10"}).json()["bookings"]
    assert sorted(c["courtId"] for c in cards) == BOTH
    assert all(len(c["linked"]) == 1 and c["groupTotal"] == 500 for c in cards)


def test_the_overview_counts_a_pair_as_one_booking(admin, booking_payload):
    paid_pair(admin, booking_payload, hour=19)
    o = admin.get("/api/admin/overview", params={"days": 7}).json()
    assert (o["kpis"]["revenue"], o["kpis"]["bookings"], o["kpis"]["avgBooking"]) == (500, 1, 500)
    assert {c["courtId"]: (c["revenue"], c["bookings"]) for c in o["byCourt"]} == {"court-1": (250, 1), "court-2": (250, 1)}
    assert o["kpis"]["repeatCustomers"] == 0 and o["topCustomers"][0]["bookings"] == 1
    assert o["kpis"]["paidBookingsAllTime"] == 1
    assert admin.get("/api/admin/counts").json()["payments"] == 1


# ── Rain: the guest moves the booking, both courts together ────────────────────
def test_a_rain_delayed_pair_moves_both_courts_together(admin, booking_payload):
    booking, _ = paid_pair(admin, booking_payload, date="2026-10-11", hour=15)
    other = second_code(admin, booking["code"])
    moved = admin.post("/api/admin/rain-delay", json={"date": "2026-10-11", "fromHour": 15, "hours": 1}).json()["moved"]
    assert sorted(b["code"] for b in moved) == sorted([booking["code"], other])

    # Found by either court's code, it is one booking under the code the player has.
    look = admin.post("/api/reschedule/find", json={"code": other, "customerPhone": "0917 123 4567"}).json()
    assert look["booking"]["code"] == booking["code"] and look["booking"]["reschedule"] == "weather"

    # A time when one of the courts is taken moves nothing.
    admin.post("/api/admin/bookings", json={"courtId": "court-2", "date": "2026-10-11", "hour": 10, "hours": 1, "customerName": "Walk In"})
    clash = admin.post("/api/reschedule", json={"code": booking["code"], "customerPhone": "0917 123 4567", "date": "2026-10-11", "hour": 10})
    assert clash.status_code == 409
    assert clash.json()["error"]["message"] == "Court 2 at 10:00 AM is taken, so neither court was moved. Please choose another time."
    assert courts_at(admin, 15, "2026-10-11") == {"court-1": "booked", "court-2": "booked"}  # still theirs, until they pick

    res = admin.post("/api/reschedule", json={"code": booking["code"], "customerPhone": "0917 123 4567", "date": "2026-10-11", "hour": 9})
    assert res.status_code == 200, res.text
    b = res.json()
    assert b["courtName"] == "Court 1 & Court 2" and b["startAt"] == "2026-10-11T01:00:00Z" and b["weatherHold"] is False
    assert courts_at(admin, 9, "2026-10-11") == {"court-1": "booked", "court-2": "booked"}
    assert courts_at(admin, 15, "2026-10-11") == {"court-1": "available", "court-2": "available"}
    events = admin.get(f"/api/admin/bookings/{other}").json()["events"]
    assert events[0]["action"] == "rain_rescheduled"


# ── The database ──────────────────────────────────────────────────────────────
def test_an_older_database_gets_the_group_column_and_its_index():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    lines = db.SCHEMA.split("CREATE TABLE IF NOT EXISTS bookings (")[1].split("\n);")[0].split("\n")
    lines = [ln for ln in lines if not ln.strip().startswith(("group_id", "-- (which holds"))]
    lines[-1] = lines[-1].split("--")[0].rstrip().rstrip(",")
    conn.execute("CREATE TABLE courts (id TEXT PRIMARY KEY, name TEXT NOT NULL, day_rate INTEGER NOT NULL, night_rate INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)")
    conn.execute("CREATE TABLE bookings (" + "\n".join(lines) + "\n)")
    assert "group_id" not in {r["name"] for r in conn.execute("PRAGMA table_info(bookings)")}
    db.apply_schema(conn)
    db.apply_schema(conn)  # running it twice is harmless
    assert "group_id" in {r["name"] for r in conn.execute("PRAGMA table_info(bookings)")}
    assert conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_bookings_group'").fetchone()
    conn.close()
