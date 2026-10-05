"""Receipt image validation and private storage.

Receipts can show account details and balances, so they are stored outside any
public static directory and will only ever be served to the admin.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

from app.config import settings
from app.errors import BookingError


@dataclass(frozen=True)
class StoredReceipt:
    path: str  # relative to data_dir
    sha256: str


def _sniff_extension(head: bytes) -> str | None:
    """Trust the bytes, not the filename or the client's content-type."""
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"heif", b"mif1", b"msf1", b"hevc"):
        return ".heic"
    return None


def validate(data: bytes) -> tuple[str, str]:
    """Return (extension, sha256) or raise."""
    if not data:
        raise BookingError("receipt_empty", "The receipt file is empty. Please choose the screenshot again.")
    if len(data) > settings.max_receipt_bytes:
        mb = settings.max_receipt_bytes // (1024 * 1024)
        raise BookingError("receipt_too_large", f"That image is over {mb} MB. Try a screenshot instead of a photo.")
    ext = _sniff_extension(data[:16])
    if ext is None:
        raise BookingError("receipt_bad_type", "Upload a JPG, PNG, WebP or HEIC image of your receipt.")
    return ext, hashlib.sha256(data).hexdigest()


def save(booking_id: str, data: bytes, ext: str, sha256: str) -> StoredReceipt:
    settings.receipts_dir.mkdir(parents=True, exist_ok=True)
    name = f"{booking_id}{ext}"
    target = settings.receipts_dir / name
    tmp = target.with_suffix(target.suffix + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, target)
    return StoredReceipt(path=f"receipts/{name}", sha256=sha256)


def delete(relative_path: str) -> None:
    try:
        (settings.data_dir / relative_path).unlink(missing_ok=True)
    except OSError:
        pass
