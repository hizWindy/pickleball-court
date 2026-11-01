"""Input normalisation shared by schemas and services."""

from __future__ import annotations

import re
from datetime import date, datetime

_PH_MOBILE = re.compile(r"^09\d{9}$")


def normalize_ph_mobile(raw: str) -> str:
    """Accept 09XX..., +639XX..., 639XX... with spaces/dashes; return 09XXXXXXXXX."""
    digits = re.sub(r"[\s\-().]", "", raw or "")
    if digits.startswith("+63"):
        digits = "0" + digits[3:]
    elif digits.startswith("63") and len(digits) == 12:
        digits = "0" + digits[2:]
    if not _PH_MOBILE.match(digits):
        raise ValueError("Enter a valid PH mobile number, e.g. 0912 345 6789.")
    return digits


def clean_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", raw or "").strip()
    if len(name) < 2:
        raise ValueError("Enter your full name.")
    if len(name) > 80:
        raise ValueError("Name is too long.")
    return name


# ── Reference numbers ─────────────────────────────────────────────────────────
# The club's QR codes are InstaPay QR Ph, so a player can pay from any bank or e-wallet and the reference may be
# GCash's (13 numbers), GoTyme's (GT + date + 8 numbers) or another bank's. The shape typed decides the rules, not
# which QR was picked. A format check cannot prove a payment happened (the host still checks it in their own app); it
# only turns away mistakes and lazy made-up numbers.
REFERENCE_FORMAT_HINT = "Enter the reference exactly as shown on your receipt."
REFERENCE_INSTAPAY_HINT = "That looks like the short InstaPay number. Use the 13-digit Ref No. from your receipt."
REFERENCE_GCASH_HINT = "A GCash reference has 13 numbers. Check it against your receipt."
# One reply for a made-up looking number, a GoTyme date from another day and a duplicate, so the reply never tells
# anyone whether a number already exists in the system.
REFERENCE_REJECTED = "We couldn't accept that reference. Please copy it again from your receipt."
# The example the payment page shows. Nobody should be able to submit it.
EXAMPLE_REFERENCE = "1092837461928"

_INVISIBLE = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u200e\u200f\u2060\u00ad\ufeff"), None)
_REF_LABEL = re.compile(r"^\s*ref(?:erence)?[\s.:#]+(?:(?:no|num|number)\b[\s.:#]*)?", re.I)
_REF_SEPARATORS = re.compile(r"[\s\-.:]")
_LOOKALIKES = str.maketrans("OIL", "011")
_GOTYME = re.compile(r"GT([0-9]{8})([0-9]{8})")
_OTHER_BANK = re.compile(r"(?=.*[A-Z])[A-Z0-9]{10,32}")


class ReferenceRejected(ValueError):
    """A reference that looks like a reference but that we won't take. `reason` is for the server log only."""

    def __init__(self, reason: str):
        super().__init__(REFERENCE_REJECTED)
        self.reason = reason


def clean_reference(raw: str) -> str:
    """What was typed or pasted, minus a leading "Ref No.", spaces, dashes, dots and invisible characters, in capitals."""
    text = _REF_LABEL.sub("", (raw or "").translate(_INVISIBLE))
    ref = _REF_SEPARATORS.sub("", text).upper()
    # Typed by hand: a letter O for zero, or I or L for one, when the rest are numbers.
    head, body = (ref[:2], ref[2:]) if ref.startswith("GT") else ("", ref)
    if body and sum(c in "0123456789" for c in body) >= len(body) - 2:
        body = body.translate(_LOOKALIKES)
    return head + body


def _longest_step_run(ref: str) -> int:
    """The longest stretch that counts up or down by one, like 123456 or FEDCBA."""
    best = up = down = 1
    for a, b in zip(ref, ref[1:]):
        up = up + 1 if ord(b) - ord(a) == 1 else 1
        down = down + 1 if ord(a) - ord(b) == 1 else 1
        best = max(best, up, down)
    return best


def _looks_made_up(ref: str) -> bool:
    """Lazy fakes: 1111111111111, 1234567890123, 1212121212121, our own example. Seven in a row, not fewer: on 200,000
    random 13-digit numbers six wrongly turned away 1 in 6,000 and seven turned away 1 in 50,000."""
    if ref == EXAMPLE_REFERENCE:
        return True
    if re.search(r"(.)\1{6,}", ref) or _longest_step_run(ref) >= 7:
        return True
    if any(all(ref[i] == ref[i + p] for i in range(len(ref) - p)) for p in range(1, 5)):  # 1212..., 123123...
        return True
    return ref.isdigit() and len(set(ref)) < 4


def normalize_reference(raw: str, *, booked_on: date | None = None) -> str:
    """The clean reference, or a ValueError. A plain ValueError carries a hint that depends only on what was typed;
    ReferenceRejected carries the one generic reply. `booked_on` (Manila date of the booking) is for the GoTyme date."""
    ref = clean_reference(raw)
    if not ref or not ref.isascii():
        raise ValueError(REFERENCE_FORMAT_HINT)
    if ref.isdigit():
        if len(ref) != 13:
            raise ValueError(REFERENCE_INSTAPAY_HINT if 8 <= len(ref) <= 12 else REFERENCE_GCASH_HINT)
    elif m := _GOTYME.fullmatch(ref):
        try:
            stamped = datetime.strptime(m.group(1), "%Y%m%d").date()
        except ValueError:
            raise ReferenceRejected("not_a_date") from None
        # GoTyme stamps the day of the payment. A day either side covers midnight and a different clock.
        if booked_on and abs((stamped - booked_on).days) > 1:
            raise ReferenceRejected("other_day")
    elif not _OTHER_BANK.fullmatch(ref):
        raise ValueError(REFERENCE_FORMAT_HINT)
    if _looks_made_up(ref):
        raise ReferenceRejected("made_up")
    return ref


def mask_phone(phone: str) -> str:
    return phone[:4] + " ••• " + phone[-4:] if len(phone) == 11 else phone
