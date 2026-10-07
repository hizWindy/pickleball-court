"""Turns the text on a payment receipt into fields, then compares them with the booking.

Works from labels ("Total Amount Sent", "Reference number", "Sent to"...), so it handles the
GCash and GoTyme layouts and most bank / e-wallet receipts that follow the same conventions.
Nothing here is trusted as proof: the result decides which bookings the host should look at.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.clock import MANILA
from app.ocr import Line

MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

# Amount labels, most specific first ("Total Amount Sent" beats "Amount", which beats "Fee").
AMOUNT_LABELS = ["total amount sent", "total amount paid", "total amount", "amount sent", "amount paid", "total paid", "amount", "total"]
REFERENCE_LABEL = re.compile(
    r"\b(?:ref(?:erence)?\s*(?:no|number|num|id|#)?|transaction\s*(?:id|no|number|ref)|trace\s*(?:no|number)|invoice\s*no)\b\.?\s*[:#]?\s*",
    re.I,
)
RECIPIENT_LABEL = re.compile(r"^\s*(?:sent\s+to|send\s+to|transfer(?:red)?\s+to|paid\s+to|recipient(?:\s+name)?|to)\b\s*[:\-]?\s*", re.I)
SENDER_SECTION = re.compile(r"\b(?:transferred\s+from|sent\s+from|from\s+account|source\s+account|from)\b", re.I)
NUMBER_LABEL = re.compile(r"\b(?:account\s*(?:number|no)|mobile\s*(?:number|no)|phone|gcash\s*number|wallet)\b\.?\s*[:\-]?\s*", re.I)

# A value runs until a double space (the gap before the next box on the row).
VALUE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9\-]|\s(?!\s)){4,40}")
MONEY = re.compile(r"(?:PHP|Php|php|₱|P|#)?\s*(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{2})|\d+\.\d{2})(?!\d)")
PHONE = re.compile(r"(?:\+?63|0)\s?9\d{2}[\s\-•·*.]*(?:\d{3}|[•·*.\s]{1,6})?[\s\-•·*.]*\d{4}")

DATE_PATTERNS = [
    # Oct 06, 2026 8:47 PM  ·  October 6, 2026, 8:47 PM  ·  Oct 6 2026 at 20:47
    re.compile(r"(?P<mon>[A-Za-z]{3,9})\.?\s+(?P<day>\d{1,2}),?\s+(?P<year>\d{4}),?\s*(?:at\s*)?(?P<h>\d{1,2}):(?P<m>\d{2})(?::\d{2})?\s*(?P<ap>[AaPp]\.?\s?[Mm]\.?)?"),
    # 07 Oct 2026, 10:22 PM
    re.compile(r"(?P<day>\d{1,2})\s+(?P<mon>[A-Za-z]{3,9})\.?,?\s+(?P<year>\d{4}),?\s*(?:at\s*)?(?P<h>\d{1,2}):(?P<m>\d{2})(?::\d{2})?\s*(?P<ap>[AaPp]\.?\s?[Mm]\.?)?"),
    # 2026-10-07 22:22
    re.compile(r"(?P<year>\d{4})-(?P<monnum>\d{1,2})-(?P<day>\d{1,2})[ T,]+(?P<h>\d{1,2}):(?P<m>\d{2})(?::\d{2})?\s*(?P<ap>[AaPp]\.?\s?[Mm]\.?)?"),
    # 10/07/2026 10:22 PM (month first, as Philippine apps print it)
    re.compile(r"(?P<monnum>\d{1,2})/(?P<day>\d{1,2})/(?P<year>\d{4}),?\s*(?P<h>\d{1,2}):(?P<m>\d{2})(?::\d{2})?\s*(?P<ap>[AaPp]\.?\s?[Mm]\.?)?"),
]

SUCCESS_WORDS = ("success", "sent via", "you have sent", "you sent", "completed", "transfer complete", "payment received", "paid")
FAILURE_WORDS = ("unsuccessful", "failed", "declined", "pending", "processing", "cancelled", "reversed")


@dataclass
class Reading:
    provider: str | None = None  # gcash | gotyme | maya | other
    amount_centavos: int | None = None
    reference: str | None = None
    paid_at: datetime | None = None  # timezone-aware (Manila)
    recipient_name: str | None = None
    recipient_number: str | None = None
    success: bool | None = None
    text: str = ""


@dataclass(frozen=True)
class Flag:
    code: str
    message: str


@dataclass
class Expected:
    """What a genuine payment for this booking looks like."""

    total: int  # pesos
    window_start: datetime  # booking created (aware)
    window_end: datetime  # proof submitted (aware)
    tolerance: timedelta
    recipient_names: list[str] = field(default_factory=list)
    recipient_last4: set[str] = field(default_factory=set)


# ── Reading ───────────────────────────────────────────────────────────────────
def clean_reference(raw: str) -> str:
    ref = re.sub(r"[\s\-.:]", "", raw or "").upper()
    if sum(c.isdigit() for c in ref) >= len(ref) - 2:  # a numeric reference: fix the classic OCR swaps
        ref = ref.replace("O", "0").replace("I", "1").replace("L", "1")
    return ref


def _money(text: str) -> int | None:
    m = MONEY.search(text)
    if not m:
        return None
    digits = m.group(1).replace(",", "").replace(" ", "")
    pesos, _, cents = digits.partition(".")
    try:
        return int(pesos) * 100 + int((cents or "0").ljust(2, "0")[:2])
    except ValueError:
        return None


def _amount(lines: list[str]) -> int | None:
    lowered = [ln.lower() for ln in lines]
    for label in AMOUNT_LABELS:
        for i, ln in enumerate(lowered):
            pos = ln.find(label)
            if pos < 0 or (label in ("amount", "total") and any(w in ln for w in ("fee", "balance", "discount"))):
                continue
            value = _money(lines[i][pos + len(label):])
            if value is None and i + 1 < len(lines):
                value = _money(lines[i + 1])
            if value is not None:
                return value
    # No label: the first peso amount printed with a currency sign (receipts lead with it).
    for ln in lines:
        if re.search(r"(PHP|₱)", ln, re.I) and (value := _money(ln)) is not None and value > 0:
            return value
    return None


def _reference(lines: list[str]) -> str | None:
    for i, ln in enumerate(lines):
        m = REFERENCE_LABEL.search(ln)
        if not m:
            continue
        rest = ln[m.end():]
        candidate = VALUE.search(rest)
        if not candidate and i + 1 < len(lines):
            candidate = VALUE.search(lines[i + 1])
        if candidate:
            ref = clean_reference(candidate.group(0))
            if len(ref) >= 6 and any(c.isdigit() for c in ref):
                return ref
    # GCash prints a 13-digit reference, sometimes grouped as 4-3-6
    for ln in lines:
        if m := re.search(r"(?<!\d)(\d{4}\s?\d{3}\s?\d{6})(?!\d)", ln):
            return clean_reference(m.group(1))
    return None


def _paid_at(lines: list[str]) -> datetime | None:
    for ln in lines:
        for pattern in DATE_PATTERNS:
            m = pattern.search(ln)
            if not m:
                continue
            g = m.groupdict()
            try:
                month = int(g["monnum"]) if g.get("monnum") else MONTHS[g["mon"][:3].lower()]
                hour, minute = int(g["h"]), int(g["m"])
                ap = (g.get("ap") or "").lower().replace(".", "").replace(" ", "")
                if ap == "pm" and hour < 12:
                    hour += 12
                elif ap == "am" and hour == 12:
                    hour = 0
                return datetime(int(g["year"]), month, int(g["day"]), hour, minute, tzinfo=MANILA)
            except (KeyError, ValueError):
                continue
    return None


def _recipient(lines: list[str]) -> tuple[str | None, str | None]:
    name = number = None
    for i, ln in enumerate(lines):
        m = RECIPIENT_LABEL.match(ln)
        if not m:
            continue
        rest = ln[m.end():].strip()
        name = rest or (lines[i + 1].strip() if i + 1 < len(lines) else None)
        # The recipient's account number follows, before the sender's section starts.
        for nxt in lines[i + 1 : i + 6]:
            if SENDER_SECTION.search(nxt):
                break
            if nm := NUMBER_LABEL.search(nxt):
                number = nxt[nm.end():].strip() or None
                break
            if p := PHONE.search(nxt):
                number = p.group(0)
                break
        break
    if name is None and number is None:
        # GCash style: no labels; the (masked) name, then the mobile number, sit at the top.
        for i, ln in enumerate(lines[:8]):
            if p := PHONE.search(ln):
                number = p.group(0)
                above = lines[i - 1].strip() if i > 0 else ""
                if above and re.search(r"[A-Za-z]", above) and not re.search(r"\d", above):
                    name = above
                break
    return (name or None), (number or None)


def _provider(text: str) -> str:
    low = text.lower()
    if "gotyme" in low:
        return "gotyme"
    if "gcash" in low:
        return "gcash"
    if re.search(r"\bmaya\b", low):
        return "maya"
    return "other"


def _success(text: str) -> bool | None:
    low = text.lower()
    if any(w in low for w in FAILURE_WORDS):
        return False
    if any(w in low for w in SUCCESS_WORDS):
        return True
    return None


def read(lines: Iterable[Line | str]) -> Reading:
    rows = [ln.text if isinstance(ln, Line) else str(ln) for ln in lines]
    # Keep double spaces: they separate a label from its value on the same row.
    rows = [r.strip() for r in rows if r and r.strip()]
    text = "\n".join(rows)
    name, number = _recipient(rows)
    return Reading(
        provider=_provider(text),
        amount_centavos=_amount(rows),
        reference=_reference(rows),
        paid_at=_paid_at(rows),
        recipient_name=name,
        recipient_number=number,
        success=_success(text),
        text=text,
    )


# ── Comparing with the booking ────────────────────────────────────────────────
def _letters(s: str) -> str:
    return re.sub(r"[^A-Z]", "", s.upper())


def name_matches(read_name: str, expected: list[str]) -> bool:
    """Handles full names ("REY MARK VERGARA"), short forms ("REY MARK V.") and GCash masks ("RE••••K V.")."""
    tokens = [t for t in re.split(r"\s+", read_name.strip()) if t]
    if not tokens:
        return False
    masked = bool(re.search(r"[^A-Za-z\s.\-']", read_name))
    for full in expected:
        exp = [t for t in re.split(r"\s+", full.strip()) if t]
        if not exp:
            continue
        surname_initial = _letters(exp[-1])[:1]
        given = _letters("".join(exp[:-1])) or _letters(exp[0])
        read_last = _letters(tokens[-1])
        if surname_initial and read_last and read_last[0] != surname_initial:
            continue
        if masked:
            if _letters(read_name)[:2] == given[:2]:
                return True
        else:
            read_given = _letters("".join(tokens[:-1])) if len(tokens) > 1 else _letters(tokens[0])
            if read_given and (given.startswith(read_given) or read_given.startswith(given)):
                return True
    return False


def _peso(centavos: int) -> str:
    pesos, cents = divmod(centavos, 100)
    return f"₱{pesos:,}" + (f".{cents:02d}" if cents else "")


def _when(dt: datetime) -> str:
    local = dt.astimezone(MANILA)
    return local.strftime("%b %d, %I:%M %p").replace(" 0", " ")


def assess(reading: Reading | None, exp: Expected) -> list[Flag]:
    """Everything about this receipt that doesn't look like a payment for this booking."""
    if reading is None:
        return [Flag("unreadable", "The receipt couldn't be read automatically. Check the image.")]
    flags: list[Flag] = []
    if reading.success is False:
        flags.append(Flag("not_successful", "The receipt doesn't say the transfer was successful."))

    if reading.amount_centavos is None:
        flags.append(Flag("amount_missing", "No amount could be read."))
    elif reading.amount_centavos != exp.total * 100:
        flags.append(Flag("amount_mismatch", f"Receipt shows {_peso(reading.amount_centavos)}, the booking is ₱{exp.total:,}."))

    if not reading.reference:
        flags.append(Flag("reference_missing", "No reference number could be read."))

    if reading.paid_at is None:
        flags.append(Flag("time_missing", "No payment date could be read."))
    else:
        lo = exp.window_start - exp.tolerance
        hi = exp.window_end + exp.tolerance + timedelta(minutes=1)  # receipts show whole minutes
        if not lo <= reading.paid_at <= hi:
            flags.append(Flag("time_outside", f"Paid {_when(reading.paid_at)}, but the booking was made {_when(exp.window_start)}."))

    who = " · ".join(p for p in (reading.recipient_name, reading.recipient_number) if p)
    last4 = re.sub(r"\D", "", reading.recipient_number or "")[-4:]
    number_known = len(last4) == 4
    if number_known:
        recipient_ok = last4 in exp.recipient_last4 if exp.recipient_last4 else None
    elif reading.recipient_name:
        recipient_ok = name_matches(reading.recipient_name, exp.recipient_names) if exp.recipient_names else None
    else:
        recipient_ok = None
    if recipient_ok is False:
        flags.append(Flag("recipient_mismatch", f"Sent to {who}, which isn't your account."))
    elif recipient_ok is None and not who:
        flags.append(Flag("recipient_missing", "Who the money went to couldn't be read."))
    return flags


def typed_flags() -> list[Flag]:
    return [Flag("typed_reference", "Typed in by the player, with no receipt image.")]
