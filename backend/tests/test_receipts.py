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


def _counts(admin):
    """The queue sizes, without `rev` (which moves on every change)."""
    c = admin.get("/api/admin/counts").json()
    c.pop("rev")
    c.pop("payments")
    return c


# ── Reading ───────────────────────────────────────────────────────────────────
def test_reads_a_gcash_receipt():
    r = rr.read(GCASH)
    assert r.provider == "gcash"
    assert r.amount_centavos == 1_000_000
    assert r.reference == "8045837566874"
    assert r.paid_at == datetime(2026, 10, 6, 20, 47, tzinfo=MANILA)
    assert r.recipient_name == "KH••••A P." and r.recipient_number == "+63 962 411 5061"
    assert r.success is True


def test_reads_a_gcash_receipt_whose_mask_dots_ocr_merged():
    # Exactly what the engine returned for an Oct 11 sample: "+63 9•••••2753" came back with two dots,
    # and the space before the surname initial of "HA••Z D." was lost.
    r = rr.read([
        "HA••ZD.", "+63 9••2753", "Sent via GCash", "Amount  250.00", "Total Amount Sent  P250.00",
        "Ref No. 8046 020 281757", "Oct 11, 2026 10:58 PM", "279g (gco2e)",
    ])
    assert (r.provider, r.amount_centavos, r.reference) == ("gcash", 25_000, "8046020281757")
    assert r.paid_at == datetime(2026, 10, 11, 22, 58, tzinfo=MANILA)
    assert r.recipient_name == "HA••Z D." and r.recipient_number == "+63 9•••••2753"  # as GCash prints it
    flags = {f.code for f in rr.assess(r, expected(start=datetime(2026, 10, 11, 22, 55, tzinfo=MANILA)))}
    assert flags == {"recipient_mismatch"}  # 2753 isn't one of the club's accounts


NOW = datetime(2026, 10, 11, 23, 0, tzinfo=MANILA)


@pytest.mark.parametrize(
    "lines, when",
    [
        (["Oct 11, 2026 10:58 PM"], (2026, 10, 11, 22, 58)),
        (["October 11th, 2026 at 10:58 p.m."], (2026, 10, 11, 22, 58)),
        (["0ct 11, 2026 1O:58 PM"], (2026, 10, 11, 22, 58)),  # OCR read O as 0 and 0 as O
        (["Oct 11 2026 10.58 PM"], (2026, 10, 11, 22, 58)),  # colon read as a dot
        (["10:58 PM | 11 Oct 2026"], (2026, 10, 11, 22, 58)),  # time first
        (["11-Oct-2026 22:58:07"], (2026, 10, 11, 22, 58)),
        (["Date  Oct 11, 2026", "Time  10:58 PM"], (2026, 10, 11, 22, 58)),  # split over two rows
        (["10:58 PM", "Oct 11, 2026"], (2026, 10, 11, 22, 58)),  # time on the row above
        (["Date & Time", "2026/10/11 22:58"], (2026, 10, 11, 22, 58)),
        (["10/11/26 10:58PM"], (2026, 10, 11, 22, 58)),
        (["25/10/2025 9:05 AM"], (2025, 10, 25, 9, 5)),  # day first: 25 can't be a month
        (["Oct 11, 10:58 PM"], (2026, 10, 11, 22, 58)),  # no year: this year
        (["Dec 30, 9:00 AM"], (2025, 12, 30, 9, 0)),  # no year, and this year's would be in the future
    ],
)
def test_reads_the_payment_date_and_time_in_many_layouts(lines, when):
    assert rr.read(lines, now=NOW).paid_at == datetime(*when, tzinfo=MANILA)


def test_an_amount_or_the_status_bar_clock_is_never_a_payment_time():
    assert rr.read(["10:59", "Total Amount Sent  P250.00", "Fee  PHP 0.00"], now=NOW).paid_at is None


def test_reads_sender_and_recipient_on_a_maya_receipt():
    r = rr.read([
        "Maya", "Sent money successfully", "₱250.00", "To", "REYMARK VERGARA", "+63 912 *** 5344",
        "From", "JUAN DELA CRUZ", "+63 917 *** 1234", "Date  Oct 11, 2026, 10:58 PM", "Reference ID  A1B2C3D4E5F6",
    ], now=NOW)
    assert (r.recipient_name, r.recipient_number) == ("REYMARK VERGARA", "+63 912 *** 5344")
    assert (r.sender_name, r.sender_number) == ("JUAN DELA CRUZ", "+63 917 *** 1234")
    assert r.amount_centavos == 25_000 and r.reference == "A1B2C3D4E5F6"


def test_reads_a_bank_transfer_receipt_with_account_name_and_sender():
    r = rr.read([
        "Transfer successful", "Sender  MARIA SANTOS", "Account number  XXXX-XXXX-5678",
        "Receiver  GoTyme Bank", "Account name  REY MARK VERGARA", "Account number  •••• 1204",
        "Amount  PHP 250", "Transaction date  11 Oct 2026 22:58", "Reference No.  BDO20261011ABC",
    ], now=NOW)
    assert (r.sender_name, r.sender_number) == ("MARIA SANTOS", "XXXX-XXXX-5678")
    assert (r.recipient_name, r.recipient_number) == ("REY MARK VERGARA", "•••• 1204")
    assert r.amount_centavos == 25_000 and r.paid_at == datetime(2026, 10, 11, 22, 58, tzinfo=MANILA)


def test_gotyme_sender_section_keeps_its_own_account_number():
    r = rr.read(GOTYME)
    assert r.sender_name is None and r.sender_number == "8910"  # "My Everyday Account" is an account, not a person


def test_a_sentence_starting_with_from_is_not_a_sender():
    r = rr.read(GCASH)
    assert r.sender_name is None and r.sender_number is None


def test_lenient_checks():
    good = ["RE••••K V.", "+63 912 828 5344", "Sent via GCash", "Total Amount Sent  P250.00", "Ref No. 1234 567 890123", "Oct 10, 2026 10:02 AM"]
    # the labelled amount was misread, but the right total is printed elsewhere on the receipt
    misread = [ln.replace("Total Amount Sent  P250.00", "Total Amount Sent  P25.00") for ln in good] + ["Amount  250.00"]
    assert rr.assess(rr.read(misread), expected()) == []
    # "failed" in the small print doesn't undo a receipt that says it was sent
    assert rr.read(good + ["If the transfer failed, contact support"]).success is True
    # nobody to compare against isn't a problem in itself
    no_recipient = [ln for ln in good if ln not in ("RE••••K V.", "+63 912 828 5344")]
    assert rr.assess(rr.read(no_recipient), expected()) == []
    # an amount that couldn't be read is a note, not a reason to hold the booking
    no_amount = [ln for ln in good if "Amount" not in ln]
    codes = {f.code for f in rr.assess(rr.read(no_amount), expected())}
    assert codes == {"amount_missing"}


def test_a_merged_mask_on_the_clubs_own_account_still_matches():
    r = rr.read(["RE••KV.", "+63 9•5344", "Sent via GCash", "Total Amount Sent  P250.00", "Ref No. 1234 567 890123", "Oct 10, 2026 10:02 AM"])
    assert r.recipient_name == "RE••K V." and rr.assess(r, expected()) == []


def test_a_reference_line_is_never_read_as_the_recipients_number():
    r = rr.read(["Sent via GCash", "Total Amount Sent  P250.00", "Ref No. 8046 090 281757", "Oct 10, 2026 10:02 AM"])
    assert r.recipient_number is None and r.reference == "8046090281757"


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
    assert set(gcash) == {"amount_over", "time_outside", "recipient_mismatch"}
    assert gcash["amount_over"] == "Receipt shows ₱10,000, ₱9,750 more than the ₱250 total."
    assert "+63 962 411 5061" in gcash["recipient_mismatch"]

    gotyme = {f.code for f in rr.assess(rr.read(GOTYME), expected(start=datetime(2026, 10, 7, 22, 20, tzinfo=MANILA)))}
    assert gotyme == {"amount_over", "recipient_mismatch"}  # time is inside the window


def test_unreadable_receipt_is_one_clear_flag():
    assert [f.code for f in rr.assess(None, expected())] == ["unreadable"]  # OCR wasn't available: can't judge
    assert [f.code for f in rr.assess(None, expected(), engine_ran=True)] == ["no_text"]  # OCR worked, no text


@pytest.mark.parametrize(
    "amount, code",
    [("P249.00", "amount_short"), ("P100.00", "amount_short"), ("P251.00", "amount_over"), ("P250.00", None)],
)
def test_the_amount_is_checked_against_the_checkout_total(amount, code):
    lines = ["RE••••K V.", "+63 912 828 5344", "Sent via GCash", f"Total Amount Sent  {amount}", "Ref No. 1234 567 890123", "Oct 10, 2026 10:02 AM"]
    flags = [f.code for f in rr.assess(rr.read(lines), expected())]
    assert flags == ([code] if code else [])


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
    assert d["reviewFlags"] == [] and d["needsReview"] is False and d["label"] == "paid"
    assert d["referenceNumber"] == "1234567890123"
    assert d["scan"]["amount"] == 250 and d["scan"]["provider"] == "gcash" and d["scan"]["engine"] == "rapidocr"
    assert d["scan"]["recipientNumber"] == "+63 912 828 5344"
    assert _counts(admin) == {"toReview": 0, "flagged": 0, "held": 0, "late": 0, "rainDelay": 0}


def test_suspicious_receipt_still_confirms_but_is_flagged(admin, booking_payload, ocr_reads):
    ocr_reads(GCASH)  # ₱10,000 to someone else, the day before: too much money is not a reason to hold the booking
    code, headers = _book(admin, booking_payload)
    assert _upload(admin, code, headers).json()["status"] == "confirmed"
    d = admin.get(f"/api/admin/bookings/{code}").json()
    assert {f["code"] for f in d["reviewFlags"]} == {"amount_over", "time_outside", "recipient_mismatch"}
    assert d["label"] == "paid"  # notes for the host, but the booking is simply Paid

    rejected = admin.post(f"/api/admin/bookings/{code}/reject", json={"reason": "Not paid to us"}).json()
    assert rejected["status"] == "rejected"  # host can still undo an automatic confirmation


def _slot_state(client, hour=19, court="court-1"):
    data = client.get("/api/availability", params={"date": "2026-10-10"}).json()
    return next(s for s in data["slots"] if s["hour"] == hour)["courts"][court]


def test_a_short_payment_is_paid_with_a_note_for_the_host(admin, booking_payload, ocr_reads, fake_now):
    # Paid is Paid: the host looks at every receipt and settles any balance with the guest.
    ocr_reads([line.replace("P250.00", "P200.00") for line in GOOD])
    code, headers = _book(admin, booking_payload)
    fake_now.advance(minutes=3)
    b = _upload(admin, code, headers).json()
    assert b["status"] == "confirmed" and b["pendingReason"] is None
    assert _slot_state(admin) == "booked"

    d = admin.get(f"/api/admin/bookings/{code}").json()
    assert d["label"] == "paid" and d["needsReview"] is False
    assert [f["code"] for f in d["reviewFlags"]] == ["amount_short"]
    assert d["reviewFlags"][0]["message"] == "Receipt shows ₱200, ₱50 short of the ₱250 total."
    assert admin.get("/api/admin/counts").json()["toReview"] == 0


def test_a_receipt_whose_amount_couldnt_be_read_still_confirms_with_a_note(admin, booking_payload, ocr_reads):
    # Not strict: everything else on it is a payment, so the guest isn't kept waiting; the host gets a note.
    ocr_reads(["RE••••K V.", "Sent via GCash", "Ref No. 1234 567 890123", "Oct 10, 2026 10:02 AM"])
    code, headers = _book(admin, booking_payload)
    b = _upload(admin, code, headers).json()
    assert b["status"] == "confirmed" and b["pendingReason"] is None
    assert "amount_missing" in [f["code"] for f in admin.get(f"/api/admin/bookings/{code}").json()["reviewFlags"]]


def test_an_image_with_no_text_still_confirms_with_a_note(admin, booking_payload, ocr_reads):
    ocr_reads([])  # the OCR worked and found nothing: the host will see the image and the note
    code, headers = _book(admin, booking_payload)
    assert _upload(admin, code, headers).json()["status"] == "confirmed"
    assert [f["code"] for f in admin.get(f"/api/admin/bookings/{code}").json()["reviewFlags"]] == ["no_text"]


def test_exact_and_over_payments_confirm_straight_away(admin, booking_payload, ocr_reads):
    ocr_reads([line.replace("P250.00", "P300.00") for line in GOOD])
    code, headers = _book(admin, booking_payload)
    b = _upload(admin, code, headers).json()
    assert b["status"] == "confirmed" and b["pendingReason"] is None
    assert [f["code"] for f in admin.get(f"/api/admin/bookings/{code}").json()["reviewFlags"]] == ["amount_over"]


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
