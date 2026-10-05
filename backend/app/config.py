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

    @property
    def enabled(self) -> bool:
        return bool(self.account_number.strip())


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
    # Privacy Notice promise: receipt images are deleted after this many days (the hash is kept to block reuse)
    receipt_retention_days: int = field(default_factory=lambda: _env_int("RECEIPT_RETENTION_DAYS", 90))
    consent_version: str = field(default_factory=lambda: _env("CONSENT_VERSION", "2026-10-v1"))
    gcash: PaymentAccount = field(
        default_factory=lambda: PaymentAccount(
            "gcash", "GCash", _env("GCASH_ACCOUNT_NAME", "Reymark Vergara"), _env("GCASH_ACCOUNT_NUMBER", "09128285344")
        )
    )
    gotyme: PaymentAccount = field(
        default_factory=lambda: PaymentAccount(
            "gotyme", "GoTyme", _env("GOTYME_ACCOUNT_NAME", "Reymark Vergara"), _env("GOTYME_ACCOUNT_NUMBER", "")
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
