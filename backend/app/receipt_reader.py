"""Turns the text on a payment receipt into fields, then compares them with the booking.

Works from labels ("Total Amount Sent", "Reference number", "Sent to", "From"...), so it handles the
GCash and GoTyme layouts and most bank / e-wallet receipts that follow the same conventions.
Nothing here is trusted as proof and nothing here blocks a booking: a receipt confirms it, and what doesn't
fit (a short amount, another account, an odd time) becomes a note for the host, who looks at receipts anyway.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app import clock
from app.clock import MANILA
from app.ocr import Line

MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

# Amount labels, most specific first ("Total Amount Sent" beats "Amount", which beats "Fee").
AMOUNT_LABELS = ["total amount sent", "total amount paid", "total amount", "amount sent", "amount paid", "total paid", "amount", "total"]
REFERENCE_LABEL = re.compile(
    r"\b(?:ref(?:erence)?\s*(?:no|number|num|id|#)?|transaction\s*(?:id|no|number|ref)|trace\s*(?:no|number)|invoice\s*no)\b\.?\s*[:#]?\s*",
    re.I,
)
# Who the money went to, and who sent it. A label opens that party's section; the name and number
# printed after it (same row, or the rows below) belong to it until the other party's label comes up.
RECIPIENT_LABEL = re.compile(
    r"^\s*(?:sent\s+to|send\s+to|transfer(?:red)?\s+to|paid\s+to|pay\s+to|to\s+account|receiver(?:'?s)?(?:\s+name)?|"
    r"recipient(?:'?s)?(?:\s+name)?|beneficiary(?:\s+name)?|merchant(?:\s+name)?|to)\b\s*[:\-]?\s*",
    re.I,
)
SENDER_LABEL = re.compile(
    r"^\s*(?:sent\s+from|transferred\s+from|transfer\s+from|from\s+account|source\s+account|source\s+of\s+funds|"
    r"sender(?:'?s)?(?:\s+(?:name|account))?|paid\s+by|payer(?:'?s)?(?:\s+name)?|from)\b\s*[:\-]?\s*",
    re.I,
)
ACCOUNT_NAME_LABEL = re.compile(r"^\s*account\s*name\b\s*[:\-]?\s*", re.I)
NUMBER_LABEL = re.compile(r"\b(?:account\s*(?:number|no)|mobile\s*(?:number|no)|phone(?:\s*number)?|gcash\s*number|wallet)\b\.?\s*[:\-]?\s*", re.I)
# "My Everyday Account", "Maya Wallet", "GoTyme Bank": an account or bank, not a person's name.
NOT_A_PERSON = re.compile(r"\b(?:account|wallet|savings|everyday|checking|bank|gcash|maya|gotyme|instapay|pesonet)\b", re.I)

# A value runs until a double space (the gap before the next box on the row).
VALUE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9\-]|\s(?!\s)){4,40}")
MONEY = re.compile(r"(?:PHP|Php|php|₱|P|#)?\s*(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{2})|\d+\.\d{2})(?!\d)")
MONEY_WHOLE = re.compile(r"(?:PHP|₱)\s*(\d{1,6})(?![\d.,])", re.I)  # "₱250" with no centavos
# GCash masks the middle of names and numbers with dots ("+63 9•••••2753"); OCR often merges a run of
# them into two or three, so a masked number is "9", any mix of digits and mask dots, then the last 4 digits.
MASK = "•·∙●*"
PHONE = re.compile(rf"(?:\+?63|0)\s?9[\d\s\-.{MASK}]{{1,12}}?\d{{4}}(?!\d)")
ACCOUNT_DIGITS = re.compile(rf"[\d{MASK}xX][\d\s\-{MASK}xX]{{2,24}}\d")  # "0917  4567", "•••• 1204", "XXXX-XXXX-1204"
MASKED_NAME_INITIAL = re.compile(rf"(?<=[A-Za-z{MASK}])([A-Z])\.$")  # "HA••ZD." → the surname initial lost its space

# Dates and times are found separately, so any order and any split over two rows works:
# "Oct 11, 2026 10:58 PM", "10:58 PM · 11 Oct 2026", "Date  2026-10-11" with "Time  22:58" below it...
_MON = r"(?P<mon>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])"
DATE_PATTERNS = [
    # Oct 11, 2026 · October 11 2026 · Oct. 11th, 2026 · Oct 11 (no year: this year)
    re.compile(rf"\b{_MON}\.?\s*(?P<day>\d{{1,2}})(?:st|nd|rd|th)?\b,?\s*(?P<year>\d{{4}})?", re.I),
    # 11 Oct 2026 · 11-Oct-2026 · 11 October, 2026
    re.compile(rf"\b(?P<day>\d{{1,2}})(?:st|nd|rd|th)?[\s\-/]*{_MON}\.?[\s\-/,]*(?P<year>\d{{4}})?", re.I),
    # 2026-10-11 · 2026/10/11 · 2026.10.11
    re.compile(r"\b(?P<year>20\d{2})[-/.](?P<monnum>\d{1,2})[-/.](?P<day>\d{1,2})\b"),
    # 10/11/2026 · 10-11-26 (month first, as Philippine apps print it; day first when that's the only valid reading)
    re.compile(r"\b(?P<monnum>\d{1,2})[/\-.](?P<day>\d{1,2})[/\-.](?P<year>(?:20)?\d{2})\b"),
]
TIME_PATTERNS = [
    # 10:58 PM · 22:58 · 10:58:07 pm · 10 : 58PM
    re.compile(r"(?<![\d:])(?P<h>[01]?\d|2[0-3])\s?:\s?(?P<m>[0-5]\d)(?::[0-5]\d)?\s*(?P<ap>[ap]\.?\s?m\b\.?)?", re.I),
    # 10.58 PM (OCR read the colon as a dot): only with AM/PM, or it would be an amount
    re.compile(r"(?<![\d.])(?P<h>[01]?\d)\s?[.,]\s?(?P<m>[0-5]\d)\s*(?P<ap>[ap]\.?\s?m\b\.?)", re.I),
]

SUCCESS_WORDS = ("success", "sent via", "you have sent", "you sent", "completed", "transfer complete", "payment received", "paid", "sent to")
FAILURE_WORDS = ("unsuccessful", "failed", "declined", "pending", "processing", "cancelled", "reversed")


@dataclass
class Reading:
    provider: str | None = None  # gcash | gotyme | maya | other
    amount_centavos: int | None = None
    reference: str | None = None
    paid_at: datetime | None = None  # timezone-aware (Manila)
    recipient_name: str | None = None
    recipient_number: str | None = None
    sender_name: str | None = None
    sender_number: str | None = None
    success: bool | None = None
    text: str = ""
    amounts: list[int] = field(default_factory=list)  # every peso amount printed, in centavos


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
        if w := MONEY_WHOLE.search(text):
            return int(w.group(1)) * 100
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


def _all_amounts(lines: list[str]) -> list[int]:
    found = []
    for ln in lines:
        for m in MONEY.finditer(ln):
            if (value := _money(m.group(0))) is not None:
                found.append(value)
    return found


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


# ── Date and time ─────────────────────────────────────────────────────────────
def _ocr_digits(text: str) -> str:
    """Undo the usual OCR slips around numbers: "0ct" → "Oct", "1O:58" → "10:58", "1O PM" → "10 PM"."""
    text = re.sub(r"\b0(?=ct\b|ct\.|ct\s*\d)", "O", text, flags=re.I)
    return re.sub(r"(?<=\d)[Oo]|[Oo](?=\d)", "0", text)


def _find_date(text: str, now: datetime) -> tuple[tuple[int, int, int], tuple[int, int]] | None:
    for pattern in DATE_PATTERNS:
        for m in pattern.finditer(text):
            g = m.groupdict()
            try:
                month = int(g["monnum"]) if g.get("monnum") else MONTHS[g["mon"][:3].lower()]
                day = int(g["day"])
                if g.get("monnum") and month > 12 and day <= 12:  # 25/10/2026: day first
                    month, day = day, month
                year = int(g["year"]) if g.get("year") else None
                if year is not None and year < 100:
                    year += 2000
                if year is None:  # "Oct 11, 10:58 PM": this year, unless that would be in the future
                    year = now.year
                    if datetime(year, month, day, tzinfo=MANILA) > now + timedelta(days=2):
                        year -= 1
                if not 2020 <= year <= now.year + 1:
                    continue
                datetime(year, month, day)  # validates the day of the month
            except (KeyError, ValueError, TypeError):
                continue
            return (year, month, day), m.span()
    return None


def _find_time(text: str) -> tuple[int, int] | None:
    for pattern in TIME_PATTERNS:
        if m := pattern.search(text):
            hour, minute = int(m.group("h")), int(m.group("m"))
            ap = (m.group("ap") or "").lower().replace(".", "").replace(" ", "")
            if ap and hour > 12:
                continue
            if ap == "pm" and hour < 12:
                hour += 12
            elif ap == "am" and hour == 12:
                hour = 0
            return hour, minute
    return None


def _paid_at(lines: list[str], now: datetime | None = None) -> datetime | None:
    """The first date on the receipt, with the time printed on its row, or the row below or above it."""
    now = (now or clock.now()).astimezone(MANILA)
    rows = [_ocr_digits(ln) for ln in lines]
    for i, row in enumerate(rows):
        found = _find_date(row, now)
        if not found:
            continue
        (year, month, day), (start, end) = found
        hm = _find_time(row[:start] + "  " + row[end:])
        if hm is None and i + 1 < len(rows) and not _find_date(rows[i + 1], now):
            hm = _find_time(rows[i + 1])
        if hm is None and i > 0:
            hm = _find_time(rows[i - 1])
        if hm is not None:
            return datetime(year, month, day, hm[0], hm[1], tzinfo=MANILA)
    return None


# ── Who sent it, and to whom ──────────────────────────────────────────────────
def _masked_name(name: str) -> str:
    """Put back the space OCR drops before a masked name's surname initial: "HA••ZD." → "HA••Z D."."""
    if any(c in name for c in MASK) and " " not in name.strip():
        return MASKED_NAME_INITIAL.sub(r" \1.", name.strip())
    return name


def _tidy_number(number: str | None) -> str | None:
    """A GCash-masked mobile as GCash prints it. OCR merges or misreads the five dots ("+63 9.•2753",
    "+63 9•2753"), so when only the leading 9 and the last four digits show, rebuild "+63 9•••••2753".
    Numbers that show more digits (Maya's "+63 912 *** 5344") are kept as printed."""
    if not number or not any(c in number for c in MASK):
        return number
    digits = re.sub(r"\D", "", number)
    m = re.fullmatch(r"(?:63|0)9(\d{4})", digits)
    return f"+63 9•••••{m.group(1)}" if m else number


def _person(value: str) -> tuple[str | None, str | None]:
    """Split a party's value into (name, number): "REY MARK V.  +63 912 828 5344" → both parts."""
    value = value.strip(" :-|")
    number = None
    if p := PHONE.search(value):
        number = p.group(0).strip()
        value = (value[: p.start()] + " " + value[p.end():]).strip(" :-|")
    name = re.sub(r"\s{2,}.*$", "", value).strip(" :-|,")  # the next box on the row isn't part of the name
    words = name.split()
    looks_like_a_name = (
        name
        and not re.search(r"\d", name)
        and len(words) <= 6
        and len(name) <= 48
        and sum(c.isalpha() for c in name) >= 2
        and not NOT_A_PERSON.search(name)
    )
    return (_masked_name(name) if looks_like_a_name else None), number


def _number_in(line: str) -> str | None:
    """An account or mobile number on a row of its own, or after "Account number" / "Mobile no.".

    A row with other words on it (like "Ref No. 8046 090 281757") never counts as a bare number."""
    if nm := NUMBER_LABEL.search(line):
        rest = line[nm.end():].strip()
        if m := PHONE.search(rest) or ACCOUNT_DIGITS.search(rest):
            return m.group(0).strip()
        return None
    if not re.search(r"[A-Za-z]", line) and (p := PHONE.search(line)):
        return p.group(0).strip()
    return None


def _label(line: str) -> tuple[str, re.Match] | None:
    """Which party a row introduces. Receipt labels are capitalised; a sentence ("...from transportation") isn't one."""
    if not line.lstrip()[:1].isupper():
        return None
    if m := SENDER_LABEL.match(line):
        return "from", m
    if m := RECIPIENT_LABEL.match(line):
        return "to", m
    return None


def _parties(lines: list[str]) -> dict[str, dict[str, str | None]]:
    party: dict[str, dict[str, str | None]] = {"to": {"name": None, "number": None}, "from": {"name": None, "number": None}}
    section: str | None = None
    for i, ln in enumerate(lines):
        if labelled := _label(ln):
            section, m = labelled
            rest = ln[m.end():]
            if not rest.strip() and i + 1 < len(lines) and not _label(lines[i + 1]) and not NUMBER_LABEL.search(lines[i + 1]):
                rest = lines[i + 1]  # the value sits on the row below its label
            name, number = _person(rest)
            party[section]["name"] = party[section]["name"] or name
            party[section]["number"] = party[section]["number"] or number
            continue
        if (an := ACCOUNT_NAME_LABEL.match(ln)) and (name := _person(ln[an.end():])[0]):
            section = section or "to"  # GCash bank transfers: "Account name", then "Account number" below it
            party[section]["name"] = party[section]["name"] or name
            continue
        if section and party[section]["number"] is None and (number := _number_in(ln)):
            party[section]["number"] = number

    if party["to"]["name"] is None and party["to"]["number"] is None:
        # GCash style: no labels; the (masked) name, then the mobile number on a line of its own, sit at the top.
        for i, ln in enumerate(lines[:8]):
            if re.search(r"[A-Za-z]", ln):
                continue
            if p := PHONE.search(ln):
                party["to"]["number"] = p.group(0)
                above = lines[i - 1].strip() if i > 0 else ""
                if above and re.search(r"[A-Za-z]", above) and not re.search(r"\d", above):
                    party["to"]["name"] = _masked_name(above)
                break
    return party


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
    """A receipt that says it went through counts, even if a word like "failed" turns up in its small print."""
    low = text.lower()
    if any(w in low for w in SUCCESS_WORDS):
        return True
    if any(w in low for w in FAILURE_WORDS):
        return False
    return None


def read(lines: Iterable[Line | str], now: datetime | None = None) -> Reading:
    rows = [ln.text if isinstance(ln, Line) else str(ln) for ln in lines]
    # Keep double spaces: they separate a label from its value on the same row.
    rows = [r.strip() for r in rows if r and r.strip()]
    text = "\n".join(rows)
    party = _parties(rows)
    return Reading(
        provider=_provider(text),
        amount_centavos=_amount(rows),
        reference=_reference(rows),
        paid_at=_paid_at(rows, now),
        recipient_name=party["to"]["name"],
        recipient_number=_tidy_number(party["to"]["number"]),
        sender_name=party["from"]["name"],
        sender_number=_tidy_number(party["from"]["number"]),
        success=_success(text),
        text=text,
        amounts=_all_amounts(rows),
    )


# ── Comparing with the booking ────────────────────────────────────────────────
def _letters(s: str) -> str:
    return re.sub(r"[^A-Z]", "", s.upper())


def name_matches(read_name: str, expected: list[str]) -> bool:
    """Handles full names ("REY MARK VERGARA"), short forms ("REY MARK V.") and GCash masks ("RE••••K V.")."""
    read_name = _masked_name(read_name)
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


# Nothing here holds a booking: a receipt confirms it, and these flags are notes for the host.


def assess(reading: Reading | None, exp: Expected, engine_ran: bool = False) -> list[Flag]:
    """Everything about this receipt that doesn't look like a payment for this booking.

    `engine_ran` says the OCR worked. If it wasn't available (off, missing, crashed) a receipt can't be
    judged and is only flagged `unreadable`; if it worked but found no text, the image isn't a receipt."""
    if reading is None:
        if engine_ran:
            return [Flag("no_text", "Nothing could be read on this image. Check that it is the payment receipt.")]
        return [Flag("unreadable", "The receipt couldn't be read automatically. Check the image.")]
    flags: list[Flag] = []
    if reading.success is False:
        flags.append(Flag("not_successful", "The receipt doesn't say the transfer was successful."))

    total = exp.total * 100
    paid = reading.amount_centavos
    if paid != total and total in reading.amounts:
        paid = total  # the right amount is printed; the label next to it was misread
    if paid is None:
        flags.append(Flag("amount_missing", "No amount could be read. Check it in your app."))
    elif paid < total:
        flags.append(Flag("amount_short", f"Receipt shows {_peso(paid)}, {_peso(total - paid)} short of the ₱{exp.total:,} total."))
    elif paid > total:
        flags.append(Flag("amount_over", f"Receipt shows {_peso(paid)}, {_peso(paid - total)} more than the ₱{exp.total:,} total."))

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
    return flags


def typed_flags() -> list[Flag]:
    return [Flag("typed_reference", "Typed in by the player, with no receipt image.")]
