"""Input normalisation shared by schemas and services."""

from __future__ import annotations

import re

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


def normalize_reference(method: str, raw: str) -> str:
    ref = re.sub(r"[\s\-]", "", raw or "").upper()
    if method == "gcash" and ref.isdigit() and len(ref) != 13:
        raise ValueError("GCash reference numbers are 13 digits. Check your GCash receipt.")
    # The club's QR codes are InstaPay QR Ph, so a payment can come from any bank or e-wallet
    # (GoTyme's look like GT2026100789410293). Only a loose sanity check for those.
    if not re.fullmatch(r"[A-Z0-9]{6,32}", ref):
        raise ValueError("Enter the reference number exactly as shown on your receipt.")
    return ref


def mask_phone(phone: str) -> str:
    return phone[:4] + " ••• " + phone[-4:] if len(phone) == 11 else phone
