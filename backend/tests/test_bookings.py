PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def create(client, payload, **overrides):
    res = client.post("/api/bookings", json=payload(**overrides))
    return res


def auth(token):
    return {"X-Booking-Token": token}


def slot_state(client, date, hour, court="court-1"):
    data = client.get("/api/availability", params={"date": date}).json()
    return next(s for s in data["slots"] if s["hour"] == hour)["courts"][court]


# ── Creating a hold ───────────────────────────────────────────────────────────
def test_create_holds_slot_for_15_minutes(client, booking_payload):
    res = create(client, booking_payload)
    assert res.status_code == 201, res.text
    body = res.json()
    b = body["booking"]
    assert b["status"] == "held"
    assert b["code"].startswith("HPC-") and len(b["code"]) == 13
    assert b["holdExpiresAt"] == "2026-10-10T02:15:00Z"  # 10:15 AM Manila
    assert body["accessToken"]
    assert slot_state(client, "2026-10-10", 19) == "held"


def test_multi_hour_booking_blocks_every_hour_and_prices_each_hour(client, booking_payload):
    b = create(client, booking_payload, hour=21, hours=3).json()["booking"]  # 9 PM - 12 AM
    assert [i["rate"] for i in b["lineItems"]] == [250, 200, 200]
    assert b["courtCost"] == 650 and b["total"] == 650
    for hour in (21, 22, 23):
        assert slot_state(client, "2026-10-10", hour) == "held"


def test_after_midnight_slots_belong_to_previous_play_day(client, booking_payload):
    b = create(client, booking_payload, hour=1).json()["booking"]
    assert b["startAt"] == "2026-10-10T17:00:00Z"  # Oct 11, 1:00 AM Manila
    assert b["playDate"] == "2026-10-10"


def test_paddles_added_to_total(client, booking_payload):
    b = create(client, booking_payload, paddles=True).json()["booking"]
    assert b["addonsCost"] == 80 and b["total"] == 330


def test_double_booking_is_rejected(client, booking_payload):
    assert create(client, booking_payload).status_code == 201
    res = create(client, booking_payload, customerPhone="09181112222", hour=18, hours=2)  # overlaps 7 PM
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "slot_taken"


def test_other_court_same_time_is_fine(client, booking_payload):
    assert create(client, booking_payload).status_code == 201
    assert create(client, booking_payload, courtId="court-2", customerPhone="09181112222").status_code == 201


def test_one_active_hold_per_phone(client, booking_payload):
    assert create(client, booking_payload).status_code == 201
    res = create(client, booking_payload, hour=12)
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "hold_exists"


def test_past_slot_and_far_future_rejected(client, booking_payload):
    assert create(client, booking_payload, hour=9).json()["error"]["code"] == "slot_past"
    assert create(client, booking_payload, date="2026-12-31").json()["error"]["code"] == "date_too_far"


def test_consent_required_and_must_match_version(client, booking_payload):
    assert create(client, booking_payload, consent=False).json()["error"]["code"] == "consent_required"
    assert create(client, booking_payload, consentVersion="old").json()["error"]["code"] == "consent_outdated"


def test_invalid_phone_gives_friendly_message(client, booking_payload):
    res = create(client, booking_payload, customerPhone="12345")
    assert res.status_code == 422
    assert "valid PH mobile" in res.json()["error"]["message"]


def test_unconfigured_payment_method_is_refused(client, booking_payload):
    assert create(client, booking_payload, paymentMethod="gotyme").json()["error"]["code"] == "payment_unavailable"


# ── Hold expiry ───────────────────────────────────────────────────────────────
def test_hold_expires_and_releases_slot(client, booking_payload, fake_now):
    body = create(client, booking_payload).json()
    fake_now.advance(minutes=15, seconds=31)  # past deadline + grace
    assert slot_state(client, "2026-10-10", 19) == "available"
    b = client.get(f"/api/bookings/{body['booking']['code']}", headers=auth(body["accessToken"])).json()
    assert b["status"] == "expired"
    res = client.post(
        f"/api/bookings/{b['code']}/receipt", headers=auth(body["accessToken"]), files={"receipt": ("r.png", PNG)}
    )
    assert res.status_code == 410


def test_booking_survives_refresh_until_deadline(client, booking_payload, fake_now):
    body = create(client, booking_payload).json()
    fake_now.advance(minutes=14)
    b = client.get(f"/api/bookings/{body['booking']['code']}", headers=auth(body["accessToken"])).json()
    assert b["status"] == "held"


# ── Payment proof ─────────────────────────────────────────────────────────────
def test_receipt_upload_confirms_the_booking_and_keeps_the_slot(client, booking_payload, fake_now):
    body = create(client, booking_payload).json()
    code, token = body["booking"]["code"], body["accessToken"]
    fake_now.advance(minutes=5)
    res = client.post(f"/api/bookings/{code}/receipt", headers=auth(token), files={"receipt": ("r.png", PNG)})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "confirmed"
    fake_now.advance(hours=2)  # no longer bound by the 15-minute hold
    assert slot_state(client, "2026-10-10", 19) == "booked"


def test_same_receipt_cannot_be_reused(client, booking_payload):
    a = create(client, booking_payload).json()
    client.post(f"/api/bookings/{a['booking']['code']}/receipt", headers=auth(a["accessToken"]), files={"receipt": ("r.png", PNG)})
    b = create(client, booking_payload, customerPhone="09181112222", hour=20).json()
    res = client.post(
        f"/api/bookings/{b['booking']['code']}/receipt", headers=auth(b["accessToken"]), files={"receipt": ("r.png", PNG)}
    )
    assert res.json()["error"]["code"] == "receipt_used"


def test_non_image_upload_rejected(client, booking_payload):
    a = create(client, booking_payload).json()
    res = client.post(
        f"/api/bookings/{a['booking']['code']}/receipt", headers=auth(a["accessToken"]),
        files={"receipt": ("r.png", b"%PDF-1.7 not an image")},
    )
    assert res.json()["error"]["code"] == "receipt_bad_type"


def _reference(client, body, **overrides):
    payload = {"referenceNumber": "1092 8374 61928", "paidTime": "10:03", "payerName": "Juan dela Cruz"}
    payload.update(overrides)
    return client.post(
        f"/api/bookings/{body['booking']['code']}/reference", headers=auth(body["accessToken"]), json=payload
    )


def test_typed_reference_accepted(client, booking_payload, fake_now):
    body = create(client, booking_payload).json()
    fake_now.advance(minutes=4)
    res = _reference(client, body)
    assert res.status_code == 200, res.text
    assert res.json()["proofType"] == "reference"
    assert res.json()["status"] == "confirmed"


def test_reference_from_another_bank_is_accepted_for_the_gcash_qr(client, booking_payload, fake_now):
    # The QR codes are InstaPay QR Ph, so a player may pay the GCash QR from GoTyme.
    body = create(client, booking_payload).json()
    fake_now.advance(minutes=4)
    res = _reference(client, body, referenceNumber="GT2026101009410293")
    assert res.status_code == 200, res.text


def test_gcash_reference_must_be_13_digits(client, booking_payload):
    body = create(client, booking_payload).json()
    assert _reference(client, body, referenceNumber="12345").json()["error"]["code"] == "reference_invalid"


def test_paid_time_must_fall_inside_hold_window(client, booking_payload, fake_now):
    body = create(client, booking_payload).json()
    fake_now.advance(minutes=4)
    assert _reference(client, body, paidTime="08:30").json()["error"]["code"] == "paid_time_outside_window"


def test_reference_cannot_be_reused(client, booking_payload, fake_now):
    a = create(client, booking_payload).json()
    _reference(client, a)
    b = create(client, booking_payload, customerPhone="09181112222", hour=20).json()
    assert _reference(client, b).json()["error"]["code"] == "reference_used"


def test_proof_needs_valid_token(client, booking_payload):
    body = create(client, booking_payload).json()
    res = client.post(
        f"/api/bookings/{body['booking']['code']}/receipt", headers=auth("wrong"), files={"receipt": ("r.png", PNG)}
    )
    assert res.status_code == 404


# ── Cancel ────────────────────────────────────────────────────────────────────
def test_cancel_releases_slot(client, booking_payload):
    body = create(client, booking_payload).json()
    res = client.post(f"/api/bookings/{body['booking']['code']}/cancel", headers=auth(body["accessToken"]))
    assert res.json()["status"] == "cancelled"
    assert slot_state(client, "2026-10-10", 19) == "available"
    # and the phone can hold again right away
    assert create(client, booking_payload).status_code == 201


def test_old_receipts_are_purged_but_still_block_reuse(client, booking_payload, fake_now):
    from app import booking_service
    from app.config import settings
    from app.db import connect

    a = create(client, booking_payload).json()
    client.post(f"/api/bookings/{a['booking']['code']}/receipt", headers=auth(a["accessToken"]), files={"receipt": ("r.png", PNG)})
    conn = connect()
    path = conn.execute("SELECT receipt_path FROM bookings").fetchone()[0]
    assert (settings.data_dir / path).exists()

    fake_now.advance(days=91)
    assert booking_service.purge_old_receipts(conn) == 1
    assert not (settings.data_dir / path).exists()
    conn.close()

    b = create(client, booking_payload, date="2027-01-15").json()  # "now" is 2027-01-09 after the jump
    res = client.post(
        f"/api/bookings/{b['booking']['code']}/receipt", headers=auth(b["accessToken"]), files={"receipt": ("r.png", PNG)}
    )
    assert res.json()["error"]["code"] == "receipt_used"


def test_method_with_only_a_qr_image_is_offered(client, booking_payload, monkeypatch):
    from dataclasses import replace

    from app import booking_service
    from app.config import PaymentAccount

    gotyme = PaymentAccount(
        "gotyme", "GoTyme", "Rey Mark Vergara", "", qr_image="/images/payment-qr-gotyme.jpg", account_hint="•••• 1204"
    )
    monkeypatch.setattr(booking_service, "settings", replace(booking_service.settings, gotyme=gotyme))

    cfg = client.get("/api/config").json()
    entry = next(a for a in cfg["paymentAccounts"] if a["method"] == "gotyme")
    assert entry["enabled"] is True
    assert entry["qrImage"] == "/images/payment-qr-gotyme.jpg"
    assert entry["accountHint"] == "•••• 1204"
    assert entry["accountNumber"] == ""

    b = create(client, booking_payload, paymentMethod="gotyme").json()
    assert b["booking"]["paymentMethod"] == "gotyme"


def test_config_exposes_rules(client):
    cfg = client.get("/api/config").json()
    assert cfg["holdMinutes"] == 15
    assert [c["id"] for c in cfg["courts"]] == ["court-1", "court-2"]
    gotyme = next(a for a in cfg["paymentAccounts"] if a["method"] == "gotyme")
    assert gotyme["enabled"] is False


# ── Privacy: the player's IP is only kept while it's needed ───────────────────
def _ip_of(code):
    from app.db import connect

    conn = connect()
    try:
        return conn.execute("SELECT client_ip FROM bookings WHERE code = ?", (code,)).fetchone()[0]
    finally:
        conn.close()


def test_ip_is_kept_only_while_the_hold_is_open(client, booking_payload):
    body = create(client, booking_payload).json()
    code, token = body["booking"]["code"], body["accessToken"]
    assert _ip_of(code)  # needed to cap simultaneous holds per device
    client.post(f"/api/bookings/{code}/receipt", headers=auth(token), files={"receipt": ("r.png", PNG)})
    assert _ip_of(code) is None  # proof sent: no longer a hold


def test_ip_is_dropped_when_a_hold_is_cancelled_or_expires(client, booking_payload, fake_now):
    a = create(client, booking_payload).json()
    client.post(f"/api/bookings/{a['booking']['code']}/cancel", headers=auth(a["accessToken"]))
    assert _ip_of(a["booking"]["code"]) is None

    b = create(client, booking_payload, hour=20).json()
    fake_now.advance(minutes=16)
    client.get("/api/availability", params={"date": "2026-10-10"})  # any request releases overdue holds
    assert _ip_of(b["booking"]["code"]) is None


def test_old_rows_are_cleaned_and_new_indexes_exist():
    import sqlite3

    from app import db

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db.apply_schema(conn)
    conn.execute(
        """INSERT INTO bookings (id, code, status, court_id, start_at, hours, customer_name, customer_phone, payment_method,
               court_cost, addons_cost, total, consent_at, consent_version, client_ip, created_at, hold_expires_at)
           VALUES ('b1', 'HPC-AAAA-BBBB', 'confirmed', 'court-1', '2026-10-10T10:00:00Z', 1, 'A B', '09171234567', 'gcash',
                   250, 0, 250, 'x', 'v', '1.2.3.4', 'x', 'x')"""
    )
    db.apply_schema(conn)  # runs on every start-up
    assert conn.execute("SELECT client_ip FROM bookings").fetchone()[0] is None
    plan = " ".join(r[3] for r in conn.execute("EXPLAIN QUERY PLAN SELECT * FROM bookings WHERE start_at >= 'a' AND start_at < 'b' ORDER BY start_at"))
    assert "idx_bookings_start" in plan
    plan = " ".join(r[3] for r in conn.execute("EXPLAIN QUERY PLAN SELECT booking_id FROM booking_slots WHERE slot_start BETWEEN 'a' AND 'b'"))
    assert "idx_slots_start" in plan
    conn.close()
