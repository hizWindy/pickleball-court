"""What a typed reference number must look like, and what a guest is told when it doesn't.

A format check can't prove a payment happened (the host checks it in their own app). It turns away mistakes and lazy
made-up numbers, and it never says whether a number is already in the system."""

import random
from datetime import date

import pytest

from app import booking_service
from app.validation import (
    EXAMPLE_REFERENCE,
    REFERENCE_FORMAT_HINT,
    REFERENCE_GCASH_HINT,
    REFERENCE_INSTAPAY_HINT,
    REFERENCE_REJECTED,
    ReferenceRejected,
    normalize_reference,
)

BOOKED = date(2026, 10, 10)  # the fake clock's day


# ── The rules on their own ────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "typed, stored, booked",
    [
        ("4821 905 337164", "4821905337164", BOOKED),  # GCash prints it as 4-3-6
        ("4821905337164", "4821905337164", BOOKED),  # copied with no spaces
        ("4821-905-337164", "4821905337164", BOOKED),
        ("Ref No. 4821 905 337164", "4821905337164", BOOKED),  # pasted with the label
        ("reference number: 4821905337164", "4821905337164", BOOKED),
        ("48219O5337164", "4821905337164", BOOKED),  # a letter O typed for zero
        ("4821 905 337l64", "4821905337164", BOOKED),  # a lowercase L typed for one
        ("8046 020 281757", "8046020281757", BOOKED),  # a real GCash receipt
        ("GT2026101009410293", "GT2026101009410293", BOOKED),  # GoTyme: GT + the day + 8 numbers
        ("gt2026100789410293", "GT2026100789410293", date(2026, 10, 7)),  # a real GoTyme receipt
        ("GT 2026 1010 0941 0293", "GT2026101009410293", BOOKED),
        ("7Q3K91XD40ZB", "7Q3K91XD40ZB", BOOKED),  # another bank: letters and numbers
        ("REFAB12CD34EF", "REFAB12CD34EF", BOOKED),  # a code that merely starts with REF is left alone
    ],
)
def test_right_inputs(typed, stored, booked):
    assert normalize_reference(typed, booked_on=booked) == stored


@pytest.mark.parametrize(
    "typed, hint",
    [
        ("48219053371", REFERENCE_INSTAPAY_HINT),  # 11 numbers: the short InstaPay trace number
        ("12345678", REFERENCE_INSTAPAY_HINT),
        ("12345", REFERENCE_GCASH_HINT),
        ("48219053371645", REFERENCE_GCASH_HINT),  # one number too many
        ("ABC", REFERENCE_FORMAT_HINT),
        ("4821905#37164", REFERENCE_FORMAT_HINT),
        ("4821 9053 3716٤", REFERENCE_FORMAT_HINT),  # a non-ASCII digit
        ("", REFERENCE_FORMAT_HINT),
    ],
)
def test_wrong_shape_gets_a_hint_that_depends_only_on_what_was_typed(typed, hint):
    with pytest.raises(ValueError) as exc:
        normalize_reference(typed, booked_on=BOOKED)
    assert not isinstance(exc.value, ReferenceRejected)
    assert str(exc.value) == hint


@pytest.mark.parametrize(
    "typed, reason",
    [
        ("1111111111111", "made_up"),
        ("0000000000000", "made_up"),
        ("1234567890123", "made_up"),
        ("9876543210987", "made_up"),
        ("1212121212121", "made_up"),
        ("1231231231231", "made_up"),
        ("5555555555555", "made_up"),
        ("1111111234567", "made_up"),
        ("1092 837 461928", "made_up"),  # the example the payment page shows
        ("ABCDEFGHIJKL", "made_up"),
        ("AAAAAAAAAAAA", "made_up"),
        ("GT2026101012345678", "made_up"),
        ("GT2026100309410293", "other_day"),  # a week old
        ("GT2026133109410293", "not_a_date"),  # month 13
    ],
)
def test_made_up_or_stale_gets_the_one_generic_reply(typed, reason):
    with pytest.raises(ReferenceRejected) as exc:
        normalize_reference(typed, booked_on=BOOKED)
    assert exc.value.reason == reason and str(exc.value) == REFERENCE_REJECTED


def test_gotyme_day_may_be_one_day_either_side():
    for stamp in ("20261009", "20261010", "20261011"):
        assert normalize_reference(f"GT{stamp}09410293", booked_on=BOOKED).startswith("GT")
    for stamp in ("20261008", "20261012"):
        with pytest.raises(ReferenceRejected):
            normalize_reference(f"GT{stamp}09410293", booked_on=BOOKED)


def test_the_on_screen_example_is_blocked():
    with pytest.raises(ReferenceRejected):
        normalize_reference(EXAMPLE_REFERENCE)


def test_genuine_looking_references_are_almost_never_turned_away():
    # Random numbers stand in for real ones. Seven in a row was chosen so this stays far below 1 in 1,000 (measured: 1 in 50,000).
    rng = random.Random(11)
    turned_away = 0
    for _ in range(20_000):
        ref = "".join(rng.choice("0123456789") for _ in range(13))
        try:
            normalize_reference(ref, booked_on=BOOKED)
        except ReferenceRejected:
            turned_away += 1
    assert turned_away / 20_000 < 0.001


# ── Through the API ───────────────────────────────────────────────────────────
def _book(client, booking_payload, **kw):
    body = client.post("/api/bookings", json=booking_payload(**kw)).json()
    return body["booking"]["code"], {"X-Booking-Token": body["accessToken"]}


def _send(client, code, headers, ref, name="Juan dela Cruz"):
    return client.post(f"/api/bookings/{code}/reference", headers=headers, json={"referenceNumber": ref, "payerName": name})


def test_a_duplicate_looks_exactly_like_a_made_up_number_to_the_guest(client, booking_payload):
    a, ha = _book(client, booking_payload)
    assert _send(client, a, ha, "4821 905 337164").status_code == 200
    b, hb = _book(client, booking_payload, customerPhone="09181112222", hour=20)

    duplicate = _send(client, b, hb, "4821905337164")
    made_up = _send(client, b, hb, "1111111111111")
    wrong_day = _send(client, b, hb, "GT2026100309410293")
    for res in (duplicate, made_up, wrong_day):
        assert res.status_code == 400
    assert duplicate.json() == made_up.json() == wrong_day.json()
    assert duplicate.json()["error"]["code"] == "reference_rejected"
    text = duplicate.text.lower()
    assert not any(word in text for word in ("already", "used", "taken", "exists", "another booking"))
    assert client.get(f"/api/bookings/{b}", headers=hb).json()["status"] == "held"


def test_a_wrong_shape_is_a_hint_not_the_generic_reply(client, booking_payload):
    code, headers = _book(client, booking_payload)
    res = _send(client, code, headers, "48219053371")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "reference_invalid" and res.json()["error"]["message"] == REFERENCE_INSTAPAY_HINT


def test_after_five_turned_away_tries_the_booking_goes_to_the_host(client, booking_payload):
    code, headers = _book(client, booking_payload)
    for _ in range(booking_service.REFERENCE_TRIES):
        assert _send(client, code, headers, "1111111111111").json()["error"]["code"] == "reference_rejected"
    locked = _send(client, code, headers, "4821905337164")  # even a good one now
    assert locked.status_code == 429 and locked.json()["error"]["code"] == "reference_locked"
    assert client.get(f"/api/bookings/{code}", headers=headers).json()["status"] == "held"


def test_the_cap_is_per_booking_and_only_the_owner_can_use_it_up(client, booking_payload):
    a, ha = _book(client, booking_payload)
    b, hb = _book(client, booking_payload, customerPhone="09181112222", hour=20)
    for _ in range(booking_service.REFERENCE_TRIES + 3):  # someone without a's token can't burn a's tries
        assert _send(client, a, {"X-Booking-Token": "wrong"}, "1111111111111").status_code == 404
    for _ in range(booking_service.REFERENCE_TRIES):
        _send(client, b, hb, "1111111111111")
    assert _send(client, a, ha, "4821905337164").status_code == 200  # a is untouched by b's mistakes


def test_a_good_reference_after_a_few_slips_still_works(client, booking_payload):
    code, headers = _book(client, booking_payload)
    _send(client, code, headers, "12345")
    _send(client, code, headers, "1111111111111")
    assert _send(client, code, headers, "Ref No. 4821 905 337164").status_code == 200
