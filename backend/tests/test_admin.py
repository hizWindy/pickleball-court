from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from conftest import ADMIN_PASSWORD

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


# ── Helpers ───────────────────────────────────────────────────────────────────
def public_booking(client, payload, **overrides):
    res = client.post("/api/bookings", json=payload(**overrides))
    assert res.status_code == 201, res.text
    body = res.json()
    return body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}


def pay_by_receipt(client, code, headers, data=PNG):
    res = client.post(f"/api/bookings/{code}/receipt", headers=headers, files={"receipt": ("r.png", data)})
    assert res.status_code == 200, res.text


def walk_in(admin, **overrides):
    body = {
        "kind": "walk_in", "courtId": "court-1", "date": "2026-10-10", "hour": 15, "hours": 1,
        "customerName": "Maria Santos", "customerPhone": "0918 555 0101", "paymentMethod": "cash",
    }
    body.update(overrides)
    return admin.post("/api/admin/bookings", json=body)


def slot_state(client, date, hour, court="court-1"):
    data = client.get("/api/availability", params={"date": date}).json()
    return next(s for s in data["slots"] if s["hour"] == hour)["courts"][court]


# ── Sign-in and session safety ────────────────────────────────────────────────
def test_admin_api_is_closed_without_signing_in(client):
    for path in ("/api/admin/counts", "/api/admin/overview", "/api/admin/bookings", "/api/admin/schedule?date=2026-10-10",
                 "/api/admin/bookings/HPC-AAAA-BBBB", "/api/admin/bookings/HPC-AAAA-BBBB/receipt"):
        res = client.get(path)
        assert res.status_code == 401, path
        assert res.json()["error"]["code"] == "unauthorized"
    assert client.get("/api/admin/session").json() == {"authenticated": False}


def test_wrong_password_is_refused_and_sets_no_cookie(client):
    res = client.post("/api/admin/login", json={"password": "nope"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "bad_password"
    assert "hp_admin" not in res.headers.get("set-cookie", "")


def test_login_cookie_is_locked_down(client):
    res = client.post("/api/admin/login", json={"password": ADMIN_PASSWORD})
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/api/admin" in cookie
    assert client.get("/api/admin/session").json() == {"authenticated": True}
    assert client.get("/api/admin/counts").status_code == 200


def test_login_attempts_are_rate_limited(client):
    for _ in range(8):
        assert client.post("/api/admin/login", json={"password": "x"}).status_code == 401
    res = client.post("/api/admin/login", json={"password": ADMIN_PASSWORD})  # even the right one waits
    assert res.status_code == 429


def test_writes_need_the_csrf_header(client):
    client.post("/api/admin/login", json={"password": ADMIN_PASSWORD})  # signed in, but no X-HP-Admin
    res = client.post("/api/admin/bookings/HPC-AAAA-BBBB/confirm")
    assert res.status_code == 403
    assert client.get("/api/admin/counts").status_code == 200  # reads don't need it


def test_logout_ends_the_session(admin):
    assert admin.post("/api/admin/logout").json() == {"authenticated": False}
    assert admin.get("/api/admin/counts").status_code == 401


def test_session_expires(admin, fake_now):
    fake_now.advance(hours=168, minutes=1)
    assert admin.get("/api/admin/counts").status_code == 401


def test_changing_the_password_signs_everyone_out(admin, monkeypatch):
    from app import admin_auth

    monkeypatch.setattr(admin_auth, "settings", replace(admin_auth.settings, admin_password="a brand new password"))
    assert admin.get("/api/admin/counts").status_code == 401


def test_hashed_password_works(client, monkeypatch):
    from app import admin_auth

    hashed = admin_auth.hash_password("s3cret-phrase-here")
    monkeypatch.setattr(admin_auth, "settings", replace(admin_auth.settings, admin_password_hash=hashed, admin_password=""))
    assert client.post("/api/admin/login", json={"password": "wrong"}).status_code == 401
    assert client.post("/api/admin/login", json={"password": "s3cret-phrase-here"}).status_code == 200


def test_admin_is_locked_when_no_password_is_configured(client, monkeypatch):
    from app import admin_auth

    monkeypatch.setattr(admin_auth, "settings", replace(admin_auth.settings, admin_password="", admin_password_hash=""))
    res = client.post("/api/admin/login", json={"password": ""})
    assert res.status_code == 503


# ── Reviewing payments ────────────────────────────────────────────────────────
def test_paid_booking_is_confirmed_at_once_and_waits_for_a_look(admin, booking_payload):
    code, headers = public_booking(admin, booking_payload)
    assert admin.get("/api/admin/counts").json() == {"toReview": 0, "flagged": 0, "held": 1, "late": 0, "rainDelay": 0}
    pay_by_receipt(admin, code, headers)
    # OCR is off in this test, so the receipt couldn't be read: confirmed, but flagged for a look.
    assert admin.get("/api/admin/counts").json() == {"toReview": 1, "flagged": 1, "held": 0, "late": 0, "rainDelay": 0}

    detail = admin.get(f"/api/admin/bookings/{code}").json()
    assert detail["status"] == "confirmed" and detail["needsReview"] is True and detail["checkedAt"] is None
    assert [f["code"] for f in detail["reviewFlags"]] == ["unreadable"]
    assert detail["hasReceipt"] is True and detail["customerPhone"] == "09171234567"
    assert detail["total"] == 250 and detail["lineItems"][0]["rate"] == 250
    assert slot_state(admin, "2026-10-10", 19) == "booked"

    img = admin.get(f"/api/admin/bookings/{code}/receipt")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png" and img.content == PNG
    assert "no-store" in img.headers["cache-control"]

    done = admin.post(f"/api/admin/bookings/{code}/check").json()
    assert done["status"] == "confirmed" and done["checkedAt"] and done["needsReview"] is False
    assert done["events"][0]["action"] == "checked"
    assert admin.get("/api/admin/counts").json() == {"toReview": 0, "flagged": 0, "held": 0, "late": 0, "rainDelay": 0}


def test_rejecting_frees_the_slot_and_confirming_again_takes_it_back(admin, booking_payload):
    code, headers = public_booking(admin, booking_payload)
    pay_by_receipt(admin, code, headers)
    res = admin.post(f"/api/admin/bookings/{code}/reject", json={"reason": "Amount didn't match"})
    assert res.json()["status"] == "rejected"
    assert res.json()["events"][0]["detail"] == "Amount didn't match"
    assert slot_state(admin, "2026-10-10", 19) == "available"

    assert admin.post(f"/api/admin/bookings/{code}/confirm").json()["status"] == "confirmed"  # changed my mind
    assert slot_state(admin, "2026-10-10", 19) == "booked"


def test_cannot_restore_a_booking_whose_hour_was_taken(admin, booking_payload):
    code, headers = public_booking(admin, booking_payload)
    pay_by_receipt(admin, code, headers)
    admin.post(f"/api/admin/bookings/{code}/reject")
    assert walk_in(admin, hour=19).status_code == 201  # someone else gets 7 PM
    res = admin.post(f"/api/admin/bookings/{code}/confirm")
    assert res.status_code == 409 and res.json()["error"]["code"] == "slot_taken"
    assert admin.get(f"/api/admin/bookings/{code}").json()["status"] == "rejected"


def test_walk_in_cannot_be_rejected_but_can_be_cancelled(admin):
    code = walk_in(admin, hour=19).json()["code"]
    assert admin.post(f"/api/admin/bookings/{code}/reject").status_code == 409
    assert admin.post(f"/api/admin/bookings/{code}/cancel", json={"reason": "Rain"}).json()["status"] == "cancelled"
    assert slot_state(admin, "2026-10-10", 19) == "available"


def test_receipt_image_is_deleted_a_week_after_the_decision(admin, booking_payload, fake_now):
    from app import booking_service
    from app.config import settings
    from app.db import connect

    code, headers = public_booking(admin, booking_payload)
    pay_by_receipt(admin, code, headers)  # confirmed automatically: the week starts now
    conn = connect()
    path = settings.data_dir / conn.execute("SELECT receipt_path FROM bookings").fetchone()[0]
    conn.execute("UPDATE receipt_scans SET raw_text = 'SENT TO REY MARK V.'")

    fake_now.advance(days=6)
    assert booking_service.purge_old_receipts(conn) == 0 and path.exists()
    fake_now.advance(days=2)
    assert booking_service.purge_old_receipts(conn) == 1 and not path.exists()
    assert conn.execute("SELECT raw_text FROM receipt_scans").fetchone()[0] is None  # the words go with the image
    conn.close()

    admin.post("/api/admin/login", json={"password": ADMIN_PASSWORD})  # the 8 days outlasted the session
    detail = admin.get(f"/api/admin/bookings/{code}").json()
    assert detail["hasReceipt"] is False and detail["status"] == "confirmed"  # the record stays
    assert admin.get(f"/api/admin/bookings/{code}/receipt").status_code == 404


def test_receipt_left_over_from_the_old_review_flow_still_has_a_hard_cap(admin, booking_payload, fake_now):
    from app import booking_service
    from app.db import connect

    code, headers = public_booking(admin, booking_payload)
    pay_by_receipt(admin, code, headers)
    conn = connect()
    conn.execute("UPDATE bookings SET status = 'pending_verification', decided_at = NULL")  # made before auto-confirm
    fake_now.advance(days=10)
    assert booking_service.purge_old_receipts(conn) == 0
    fake_now.advance(days=5)
    assert booking_service.purge_old_receipts(conn) == 1
    conn.close()


# ── Walk-ins, blocks, edits, delete ───────────────────────────────────────────
def test_walk_in_is_confirmed_priced_and_blocks_the_slot(admin):
    res = walk_in(admin, hours=2, paddles=True)
    assert res.status_code == 201, res.text
    b = res.json()
    assert b["status"] == "confirmed" and b["source"] == "walk_in" and b["paymentMethod"] == "cash"
    assert b["total"] == 580 and b["customPrice"] is False  # 2 x 250 + 80
    assert b["customerPhone"] == "09185550101"
    assert slot_state(admin, "2026-10-10", 15) == "booked" and slot_state(admin, "2026-10-10", 16) == "booked"
    assert walk_in(admin, hour=16).json()["error"]["code"] == "slot_taken"


def test_walk_in_can_have_a_custom_price_and_no_phone(admin):
    b = walk_in(admin, customerPhone="", total=150).json()
    assert b["total"] == 150 and b["customPrice"] is True and b["customerPhone"] == ""


def test_block_holds_the_court_but_is_not_a_sale(admin):
    b = walk_in(admin, kind="block", customerName="Net repair", hours=3, total=999).json()
    assert b["source"] == "blocked" and b["total"] == 0 and b["paymentMethod"] == "none"
    assert slot_state(admin, "2026-10-10", 17) == "booked"
    assert admin.get("/api/admin/overview").json()["kpis"]["revenue"] == 0


def test_edit_details_and_keep_a_custom_price_when_rescheduling(admin):
    code = walk_in(admin, total=200).json()["code"]
    res = admin.patch(f"/api/admin/bookings/{code}", json={"customerName": "Maria S. Santos", "note": "Pays at the desk", "hour": 17})
    b = res.json()
    assert b["customerName"] == "Maria S. Santos" and b["adminNote"] == "Pays at the desk"
    assert b["hour"] == 17 and b["total"] == 200  # the host's price survives the move
    assert {"name", "schedule", "note"} <= set(b["events"][0]["detail"].split(", "))
    assert slot_state(admin, "2026-10-10", 15) == "available" and slot_state(admin, "2026-10-10", 17) == "booked"

    b = admin.patch(f"/api/admin/bookings/{code}", json={"total": None}).json()  # back to the rate card
    assert b["total"] == 250 and b["customPrice"] is False


def test_reschedule_into_a_taken_hour_changes_nothing(admin):
    first = walk_in(admin, hour=15).json()["code"]
    walk_in(admin, hour=17, customerName="Someone Else")
    res = admin.patch(f"/api/admin/bookings/{first}", json={"hour": 17})
    assert res.status_code == 409
    again = admin.get(f"/api/admin/bookings/{first}").json()
    assert again["hour"] == 15
    assert slot_state(admin, "2026-10-10", 15) == "booked"


def test_extending_a_booking_claims_the_extra_hours(admin):
    code = walk_in(admin, hour=15).json()["code"]
    b = admin.patch(f"/api/admin/bookings/{code}", json={"hours": 3}).json()
    assert b["hours"] == 3 and b["total"] == 750
    assert all(slot_state(admin, "2026-10-10", h) == "booked" for h in (15, 16, 17))


def test_move_to_the_other_court_and_another_day(admin):
    code = walk_in(admin).json()["code"]
    b = admin.patch(f"/api/admin/bookings/{code}", json={"courtId": "court-2", "date": "2026-10-12"}).json()
    assert b["courtName"] == "Court 2" and b["playDate"] == "2026-10-12"
    assert slot_state(admin, "2026-10-10", 15) == "available"
    assert slot_state(admin, "2026-10-12", 15, court="court-2") == "booked"


def test_delete_removes_the_booking_its_slots_and_its_receipt(admin, booking_payload):
    from app.config import settings
    from app.db import connect

    code, headers = public_booking(admin, booking_payload)
    pay_by_receipt(admin, code, headers)
    conn = connect()
    path = settings.data_dir / conn.execute("SELECT receipt_path FROM bookings").fetchone()[0]
    assert admin.delete(f"/api/admin/bookings/{code}").status_code == 204
    assert not path.exists()
    assert admin.get(f"/api/admin/bookings/{code}").status_code == 404
    assert slot_state(admin, "2026-10-10", 19) == "available"
    assert conn.execute("SELECT action FROM admin_events WHERE booking_code = ?", (code,)).fetchone()[0] == "deleted"
    conn.close()


def test_unknown_booking_is_404(admin):
    assert admin.post("/api/admin/bookings/HPC-AAAA-BBBB/confirm").status_code == 404
    assert admin.delete("/api/admin/bookings/HPC-AAAA-BBBB").status_code == 404


# ── Lists and the schedule ────────────────────────────────────────────────────
def test_list_filters_search_and_counts(admin, booking_payload):
    code, headers = public_booking(admin, booking_payload)
    pay_by_receipt(admin, code, headers)
    walk_in(admin, hour=12, customerName="Pedro Penduko", customerPhone="0999 888 7777")
    held, _ = public_booking(admin, booking_payload, customerPhone="09181112222", customerName="Ana Reyes", hour=21)

    everything = admin.get("/api/admin/bookings").json()
    assert everything["total"] == 3
    assert everything["counts"] == {
        "all": 3, "held": 1, "pendingVerification": 0, "confirmed": 2, "rejected": 0, "expired": 0, "cancelled": 0,
        "toReview": 1, "flagged": 1, "paid": 2, "late": 0, "done": 0, "rainDelay": 0,
    }
    to_review = admin.get("/api/admin/bookings", params={"review": "unchecked"}).json()
    assert [b["code"] for b in to_review["items"]] == [code]  # the walk-in needs no review
    assert to_review["counts"]["all"] == 3  # chips keep showing the totals
    assert admin.get("/api/admin/bookings", params={"review": "flagged"}).json()["total"] == 1
    admin.post(f"/api/admin/bookings/{code}/check")
    assert admin.get("/api/admin/bookings", params={"review": "unchecked"}).json()["total"] == 0

    by_name = admin.get("/api/admin/bookings", params={"q": "penduko"}).json()
    assert [b["customerName"] for b in by_name["items"]] == ["Pedro Penduko"]
    by_phone = admin.get("/api/admin/bookings", params={"q": "+63 999 888 7777"}).json()
    assert by_phone["total"] == 1
    by_code = admin.get("/api/admin/bookings", params={"q": held[4:].lower()}).json()
    assert by_code["items"][0]["customerName"] == "Ana Reyes"
    assert admin.get("/api/admin/bookings", params={"status": "bogus"}).status_code == 400
    assert admin.get("/api/admin/bookings", params={"review": "bogus"}).status_code == 400


def test_list_date_range_court_and_pagination(admin):
    for day in ("2026-10-10", "2026-10-11", "2026-10-12"):
        assert walk_in(admin, date=day).status_code == 201
    assert walk_in(admin, date="2026-10-12", courtId="court-2").status_code == 201

    page = admin.get("/api/admin/bookings", params={"pageSize": 2, "sort": "start_asc"}).json()
    assert page["total"] == 4 and len(page["items"]) == 2 and page["items"][0]["playDate"] == "2026-10-10"
    second = admin.get("/api/admin/bookings", params={"pageSize": 2, "page": 2, "sort": "start_asc"}).json()
    assert [b["playDate"] for b in second["items"]] == ["2026-10-12", "2026-10-12"]

    ranged = admin.get("/api/admin/bookings", params={"dateFrom": "2026-10-11", "dateTo": "2026-10-11"}).json()
    assert ranged["total"] == 1
    assert admin.get("/api/admin/bookings", params={"courtId": "court-2"}).json()["total"] == 1


def test_schedule_includes_after_midnight_hours_of_the_play_day(admin):
    walk_in(admin, hour=23, hours=3, customerName="Night Owl")  # 11 PM - 2 AM
    walk_in(admin, date="2026-10-11", hour=9, customerName="Next Day")
    day = admin.get("/api/admin/schedule", params={"date": "2026-10-10"}).json()
    assert [b["customerName"] for b in day["bookings"]] == ["Night Owl"]
    assert day["bookings"][0]["endAt"] == "2026-10-10T18:00:00Z"  # 2 AM Oct 11, Manila


# ── Analytics ─────────────────────────────────────────────────────────────────
def test_overview_numbers(admin, booking_payload, fake_now):
    walk_in(admin, date="2026-10-08", hour=9, hours=2, customerName="Maria Santos")          # 500
    walk_in(admin, date="2026-10-09", hour=22, customerName="Maria Santos", courtId="court-2")  # 200 (night rate)
    walk_in(admin, date="2026-10-10", hour=18, customerName="Pedro Penduko", customerPhone="0999 888 7777", paddles=True)  # 330
    code, headers = public_booking(admin, booking_payload)       # 7 PM online: 250, confirmed, not yet looked at
    pay_by_receipt(admin, code, headers)

    o = admin.get("/api/admin/overview", params={"days": 7}).json()
    k = o["kpis"]
    assert k["revenue"] == 1280 and k["bookings"] == 4 and k["hours"] == 5
    assert k["avgBooking"] == 320 and k["paddleRevenue"] == 80 and k["customers"] == 3 and k["repeatCustomers"] == 1
    assert k["revenuePrev"] == 0
    assert o["pending"] == {"count": 1, "amount": 250, "flagged": 1}
    assert o["funnel"]["confirmed"] == 1
    assert o["dateFrom"] == "2026-10-04" and o["dateTo"] == "2026-10-10" and len(o["daily"]) == 7
    assert next(d for d in o["daily"] if d["date"] == "2026-10-08") == {"date": "2026-10-08", "revenue": 500, "bookings": 1, "hours": 2}
    assert o["byHour"][9] == 1 and o["byHour"][10] == 1 and o["byHour"][22] == 1 and o["byHour"][18] == 1
    assert {c["courtId"]: c["revenue"] for c in o["byCourt"]} == {"court-1": 1080, "court-2": 200}
    assert o["byMethod"][0]["method"] == "cash"
    assert {r["rateType"]: r["hours"] for r in o["byRate"]} == {"standard": 4, "night_owl": 1}
    assert o["topCustomers"][0]["name"] == "Maria Santos" and o["topCustomers"][0]["spent"] == 700
    assert o["kpis"]["utilisationPct"] > 0
    assert [b["customerName"] for b in o["upNext"]][:1] == ["Pedro Penduko"]  # 6 PM is the next session after 10 AM


def test_overview_compares_with_the_previous_period(admin):
    walk_in(admin, date="2026-10-08", hour=9)   # this week
    walk_in(admin, date="2026-10-02", hour=9)   # the week before (play dates Sep 27 - Oct 3)
    k = admin.get("/api/admin/overview", params={"days": 7}).json()["kpis"]
    assert k["revenue"] == 250 and k["revenuePrev"] == 250 and k["bookingsPrev"] == 1


def test_overview_when_nothing_has_happened(admin):
    o = admin.get("/api/admin/overview").json()
    assert o["kpis"]["revenue"] == 0 and o["kpis"]["conversionPct"] is None and o["topCustomers"] == []
    assert len(o["daily"]) == 30 and sum(o["byHour"]) == 0


# ── Upgrading an existing database ────────────────────────────────────────────
def test_migration_adds_new_columns_to_an_old_database():
    import sqlite3

    from app import db

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    old_bookings = db.SCHEMA.split("CREATE TABLE IF NOT EXISTS bookings (")[1].split(");")[0]
    old_bookings = old_bookings.replace(",\n    decided_at          TEXT,\n    admin_note          TEXT", "")
    conn.execute("CREATE TABLE courts (id TEXT PRIMARY KEY, name TEXT NOT NULL, day_rate INTEGER NOT NULL, night_rate INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)")
    conn.execute(f"CREATE TABLE bookings ({old_bookings})")
    assert "decided_at" not in {r["name"] for r in conn.execute("PRAGMA table_info(bookings)")}
    db.apply_schema(conn)
    db.apply_schema(conn)  # running it twice is harmless
    assert {"decided_at", "admin_note"} <= {r["name"] for r in conn.execute("PRAGMA table_info(bookings)")}
    conn.close()
