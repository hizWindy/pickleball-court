"""Runtime settings, read once from environment variables (and an optional .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, existing env vars win."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(BASE_DIR / ".env")


def _env(name: str, default: str) -> str:
    return os.getenv(name, default)


def _env_int(name: str, default: int) -> int:
    return int(os.getenv(name, str(default)))


@dataclass(frozen=True)
class PaymentAccount:
    method: str
    label: str
    account_name: str
    account_number: str
    # Static InstaPay / QR Ph image shown on the pay screen (a path the frontend serves)
    qr_image: str = ""
    # Shown instead of the number when only a masked version is known, e.g. "•••• 1204"
    account_hint: str = ""

    @property
    def enabled(self) -> bool:
        """A method is usable once players have a number to send to or a QR to scan."""
        return bool(self.account_number.strip() or self.qr_image.strip())


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(BASE_DIR / "data"))))
    # Rules from the business process
    hold_minutes: int = field(default_factory=lambda: _env_int("HOLD_MINUTES", 15))
    # Silent server-side tolerance so a proof sent at 14:59 isn't lost to network latency
    hold_grace_seconds: int = field(default_factory=lambda: _env_int("HOLD_GRACE_SECONDS", 30))
    max_hours: int = field(default_factory=lambda: _env_int("MAX_HOURS", 3))
    booking_window_days: int = field(default_factory=lambda: _env_int("BOOKING_WINDOW_DAYS", 30))
    max_active_holds_per_phone: int = field(default_factory=lambda: _env_int("MAX_HOLDS_PER_PHONE", 1))
    max_active_holds_per_ip: int = field(default_factory=lambda: _env_int("MAX_HOLDS_PER_IP", 2))
    max_receipt_bytes: int = field(default_factory=lambda: _env_int("MAX_RECEIPT_BYTES", 8 * 1024 * 1024))
    # Paid-time check for typed references: payment must fall inside the hold window ± this tolerance
    paid_time_tolerance_minutes: int = field(default_factory=lambda: _env_int("PAID_TIME_TOLERANCE_MINUTES", 5))
    paddle_fee: int = field(default_factory=lambda: _env_int("PADDLE_FEE", 80))
    # Privacy Notice promise: a receipt image is deleted this many days after the host confirms or rejects the
    # payment, or after the hard cap below if nobody ever reviewed it. The hash is kept to block reuse.
    receipt_keep_after_decision_days: int = field(default_factory=lambda: _env_int("RECEIPT_KEEP_AFTER_DECISION_DAYS", 7))
    receipt_retention_days: int = field(default_factory=lambda: _env_int("RECEIPT_RETENTION_DAYS", 14))
    # Read amount / reference / date / recipient off uploaded receipts (on this server; see app/ocr.py).
    ocr_enabled: bool = field(default_factory=lambda: _env("OCR_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off"))
    # Admin desk. With neither password set the admin API stays locked and no one can sign in.
    # ADMIN_PASSWORD_HASH (made with `python -m app.admin_auth`) is preferred over a plain ADMIN_PASSWORD.
    admin_password: str = field(default_factory=lambda: _env("ADMIN_PASSWORD", ""))
    admin_password_hash: str = field(default_factory=lambda: _env("ADMIN_PASSWORD_HASH", ""))
    admin_session_hours: int = field(default_factory=lambda: _env_int("ADMIN_SESSION_HOURS", 168))
    consent_version: str = field(default_factory=lambda: _env("CONSENT_VERSION", "2026-10-v1"))
    gcash: PaymentAccount = field(
        default_factory=lambda: PaymentAccount(
            "gcash",
            "GCash",
            _env("GCASH_ACCOUNT_NAME", "Reymark Vergara"),
            _env("GCASH_ACCOUNT_NUMBER", "09128285344"),
            qr_image=_env("GCASH_QR_IMAGE", "/images/payment-qr-gcash.jpg"),
        )
    )
    gotyme: PaymentAccount = field(
        default_factory=lambda: PaymentAccount(
            "gotyme",
            "GoTyme",
            _env("GOTYME_ACCOUNT_NAME", "Rey Mark Vergara"),
            _env("GOTYME_ACCOUNT_NUMBER", ""),
            qr_image=_env("GOTYME_QR_IMAGE", "/images/payment-qr-gotyme.jpg"),
            account_hint=_env("GOTYME_ACCOUNT_HINT", "•••• 1204"),
        )
    )
    frontend_dist: Path = field(
        default_factory=lambda: Path(_env("FRONTEND_DIST", str(BASE_DIR.parent / "frontend" / "dist")))
    )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "housepickle.db"

    @property
    def receipts_dir(self) -> Path:
        return self.data_dir / "receipts"

    def payment_account(self, method: str) -> PaymentAccount | None:
        return {"gcash": self.gcash, "gotyme": self.gotyme}.get(method)


settings = Settings()
