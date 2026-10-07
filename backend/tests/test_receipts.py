"""Reading receipts: the parser on real OCR output, the checks against a booking, and the upload flow."""

from dataclasses import replace
from datetime import datetime, timedelta

import pytest

from app import ocr, receipt_reader as rr
from app.clock import MANILA

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

# Exactly what the OCR engine returned for the two sample screenshots (rows already grouped).
GCASH = [
    "KH••••A P.",
    "+63 962 411 5061",
    "Sent via GCash",
    "Amount  10,000.00",
    "Total Amount Sent  P10,000.00",
    "Ref No.8045 837 566874",
    "Oct 06, 2026 8:47 PM",
    "279g (gCo2e)",
    "By going digital, you reduce your carbon footprint",
]
GOTYME = [
    "GoTyme Bank",
    "(√) Sent successfully",
    "PHP 1,500.00",
    "Sent to  JUAN DELA CRUZ",
    "Bank  GCash",
    "Account number  0917  4567",
    "Transferred from  My Everyday Account",
    "Account number  8910",
    "Transfer channel  InstaPay",
    "Fee  PHP 0.00",
    "Total amount  PHP 1,500.00",
    "Date & time  07 Oct 2026, 10:22 PM",
    "Reference number  GT2026100789410293",
    "[ ↓ Download  1  Share  ]",
]


def expected(total=250, start=datetime(2026, 10, 10, 10, 0, tzinfo=MANILA)):
    return rr.Expected(
        total=total, window_start=start, window_end=start + timedelta(minutes=4), tolerance=timedelta(minutes=5),
        recipient_names=["Reymark Vergara", "Rey Mark Vergara"], recipient_last4={"5344", "1204"},
    )


# ── Reading ───────────────────────────────────────────────────────────────────
def test_reads_a_gcash_receipt():
    r = rr.read(GCASH)
    assert r.provider == "gcash"
    assert r.amount_centavos == 1_000_000
    assert r.reference == "8045837566874"
    assert r.paid_at == datetime(2026, 10, 6, 20, 47, tzinfo=MANILA)
    assert r.recipient_name == "KH••••A P." and r.recipient_number == "+63 962 411 5061"
    assert r.success is True


def test_reads_a_gotyme_receipt_and_ignores_the_fee_and_the_senders_account():
    r = rr.read(GOTYME)
    assert r.provider == "gotyme"
    assert r.amount_centavos == 150_000
    assert r.reference == "GT2026100789410293"
    assert r.paid_at == datetime(2026, 10, 7, 22, 22, tzinfo=MANILA)
    assert r.recipient_name == "JUAN DELA CRUZ" and r.recipient_number == "0917  4567"
    assert r.success is True


@pytest.mark.parametrize(
    "lines, field, value",
    [
        (["Reference ID", "0012 3456 7890"], "reference", "001234567890"),
        (["Ref. No: 8O45 837 566874"], "reference", "8045837566874"),  # OCR read a zero as the letter O
        (["Date & Time", "October 7, 2026 at 9:05 AM"], "paid_at", datetime(2026, 10, 7, 9, 5, tzinfo=MANILA)),
        (["2026-10-07 21:30:12"], "paid_at", datetime(2026, 10, 7, 21, 30, tzinfo=MANILA)),
        (["10/07/2026 12:15 AM"], "paid_at", datetime(2026, 10, 7, 0, 15, tzinfo=MANILA)),
        (["Amount", "₱250.00"], "amount_centavos", 25_000),
        (["You sent PHP 330.00 to REY MARK V."], "amount_centavos", 33_000),
        (["Transfer failed"], "success", False),
    ],
)
def test_reads_other_common_layouts(lines, field, value):
    assert getattr(rr.read(lines), field) == value


@pytest.mark.parametrize(
    "name, ok",
    [
        ("REY MARK VERGARA", True), ("REY MARK V.", True), ("REYMARK V.", True), ("RE••••K V.", True),
        ("KH••••A P.", False), ("JUAN DELA CRUZ", False), ("REY MARK P.", False),
    ],
)
def test_recipient_name_matching(name, ok):
    assert rr.name_matches(name, ["Reymark Vergara", "Rey Mark Vergara"]) is ok


# ── Checking against the booking ──────────────────────────────────────────────
def test_a_genuine_payment_has_no_flags():
    r = rr.read([
        "RE••••K V.", "+63 912 828 5344", "Sent via GCash", "Total Amount Sent  P250.00",
        "Ref No. 1234 567 890123", "Oct 10, 2026 10:02 AM",
    ])
    assert rr.assess(r, expected()) == []


def test_the_sample_receipts_are_flagged_for_the_right_reasons():
    gcash = {f.code: f.message for f in rr.assess(rr.read(GCASH), expected())}
    assert set(gcash) == {"amount_mismatch", "time_outside", "recipient_mismatch"}
    assert gcash["amount_mismatch"] == "Receipt shows ₱10,000, the booking is ₱250."
    assert "+63 962 411 5061" in gcash["recipient_mismatch"]

    gotyme = {f.code for f in rr.assess(rr.read(GOTYME), expected(start=datetime(2026, 10, 7, 22, 20, tzinfo=MANILA)))}
    assert gotyme == {"amount_mismatch", "recipient_mismatch"}  # time is inside the window


def test_unreadable_receipt_is_one_clear_flag():
    assert [f.code for f in rr.assess(None, expected())] == ["unreadable"]


# ── The upload flow (OCR stubbed with known text) ─────────────────────────────
@pytest.fixture
def ocr_reads(monkeypatch):
    """Make the OCR 'read' these lines for the next uploads."""
    state = {"lines": None}
    monkeypatch.setattr(ocr, "read_lines", lambda data: [ocr.Line(t, i * 30.0, 20.0, 0.99) for i, t in enumerate(state["lines"])])

    def set_lines(lines):
        state["lines"] = lines

    return set_lines


def _book(client, booking_payload, **kw):
    body = client.post("/api/bookings", json=booking_payload(**kw)).json()
    return body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}


def _upload(client, code, headers, data=PNG):
    return client.post(f"/api/bookings/{code}/receipt", headers=headers, files={"receipt": ("r.png", data)})


GOOD = ["RE••••K V.", "+63 912 828 5344", "Sent via GCash", "Total Amount Sent  P250.00", "Ref No. 1234 567 890123", "Oct 10, 2026 10:02 AM"]


def test_matching_receipt_confirms_with_nothing_to_look_at(admin, booking_payload, ocr_reads, fake_now):
    ocr_reads(GOOD)
    code, headers = _book(admin, booking_payload)
    fake_now.advance(minutes=3)
    res = _upload(admin, code, headers)
    assert res.status_code == 200 and res.json()["status"] == "confirmed"

    d = admin.get(f"/api/admin/bookings/{code}").json()
    assert d["reviewFlags"] == [] and d["needsReview"] is True  # nothing odd, but nobody has looked yet
    assert d["referenceNumber"] == "1234567890123"
    assert d["scan"]["amount"] == 250 and d["scan"]["provider"] == "gcash" and d["scan"]["engine"] == "rapidocr"
    assert d["scan"]["recipientNumber"] == "+63 912 828 5344"
    assert admin.get("/api/admin/counts").json() == {"toReview": 1, "flagged": 0, "held": 0}


def test_suspicious_receipt_still_confirms_but_is_flagged(admin, booking_payload, ocr_reads):
    ocr_reads(GCASH)  # ₱10,000 to someone else, the day before
    code, headers = _book(admin, booking_payload)
    assert _upload(admin, code, headers).json()["status"] == "confirmed"
    d = admin.get(f"/api/admin/bookings/{code}").json()
    assert {f["code"] for f in d["reviewFlags"]} == {"amount_mismatch", "time_outside", "recipient_mismatch"}
    assert admin.get("/api/admin/bookings", params={"review": "flagged"}).json()["total"] == 1

    rejected = admin.post(f"/api/admin/bookings/{code}/reject", json={"reason": "Not paid to us"}).json()
    assert rejected["status"] == "rejected"  # host can still undo an automatic confirmation


def test_same_payment_cannot_confirm_two_bookings_even_as_a_new_screenshot(client, booking_payload, ocr_reads):
    ocr_reads(GOOD)
    a, ha = _book(client, booking_payload)
    assert _upload(client, a, ha).status_code == 200
    b, hb = _book(client, booking_payload, customerPhone="09181112222", hour=20)
    res = _upload(client, b, hb, data=PNG + b"cropped")  # different file, same transaction
    assert res.status_code == 409 and res.json()["error"]["code"] == "payment_used"
    assert client.get(f"/api/bookings/{b}", headers=hb).json()["status"] == "held"  # can still pay properly


def test_typed_reference_then_a_receipt_of_the_same_payment_is_refused(client, booking_payload, ocr_reads, fake_now):
    a, ha = _book(client, booking_payload)
    fake_now.advance(minutes=2)
    client.post(f"/api/bookings/{a}/reference", headers=ha, json={"referenceNumber": "1234 567 890123", "paidTime": "10:02", "payerName": "Juan"})
    ocr_reads(GOOD)
    b, hb = _book(client, booking_payload, customerPhone="09181112222", hour=20)
    assert _upload(client, b, hb).json()["error"]["code"] == "payment_used"


def test_typed_reference_confirms_and_is_flagged_for_a_look(admin, booking_payload, fake_now):
    code, headers = _book(admin, booking_payload)
    fake_now.advance(minutes=2)
    res = admin.post(f"/api/bookings/{code}/reference", headers=headers,
                     json={"referenceNumber": "1092 8374 61928", "paidTime": "10:02", "payerName": "Juan dela Cruz"})
    assert res.json()["status"] == "confirmed"
    d = admin.get(f"/api/admin/bookings/{code}").json()
    assert [f["code"] for f in d["reviewFlags"]] == ["typed_reference"] and d["scan"] is None


# ── The real engine, on a generated receipt ───────────────────────────────────
def test_real_ocr_reads_a_generated_receipt(monkeypatch):
    pytest.importorskip("rapidocr")
    from PIL import Image, ImageDraw, ImageFont

    monkeypatch.setattr(ocr, "settings", replace(ocr.settings, ocr_enabled=True))
    img = Image.new("RGB", (700, 640), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 30)
    except OSError:
        font = ImageFont.load_default(size=30)
    for i, (k, v) in enumerate([
        ("GoTyme Bank", ""), ("Sent successfully", ""), ("Sent to", "REY MARK VERGARA"), ("Account number", "0912 ... 5344"),
        ("Total amount", "PHP 250.00"), ("Date & time", "10 Oct 2026, 10:02 AM"), ("Reference number", "GT2026101012345678"),
    ]):
        d.text((30, 30 + i * 80), k, fill="black", font=font)
        if v:
            d.text((330, 30 + i * 80), v, fill="black", font=font)
    import io

    buf = io.BytesIO()
    img.save(buf, "PNG")
    lines = ocr.read_lines(buf.getvalue())
    if lines is None:
        pytest.skip("OCR engine could not start on this machine")
    r = rr.read(lines)
    assert r.provider == "gotyme"
    assert r.amount_centavos == 25_000
    assert r.reference == "GT2026101012345678"
    assert r.paid_at == datetime(2026, 10, 10, 10, 2, tzinfo=MANILA)
    assert rr.assess(r, expected()) == []
