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


def _env_lengths(name: str, default: str) -> tuple[int, ...]:
    """A list of lengths: "12,16", a range "10-20", or both ("12,14-16"). Empty means none."""
    lengths: set[int] = set()
    for part in filter(None, (p.strip() for p in _env(name, default).split(","))):
        low, _, high = part.partition("-")
        lengths.update(range(int(low), int(high or low) + 1))
    return tuple(sorted(lengths))


# Every way to pay online, in the order players see them (plan D8: GCash, GoTyme, MariBank). A new method is a name here
# and an account in `Settings.payment_accounts`; the API's types follow this list.
PAYMENT_METHODS = ("gcash", "gotyme", "maribank")


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
    # Lengths of an all-digit reference this bank's own receipts may show, besides GCash's 13. Only bookings paid to
    # this account accept them; the made-up-number rules still apply.
    reference_digits: tuple[int, ...] = ()

    @property
    def enabled(self) -> bool:
        """A method is usable once players have a number to send to or a QR to scan."""
        return bool(self.account_number.strip() or self.qr_image.strip())


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(BASE_DIR / "data"))))
    # Rules from the business process
    # Unpaid slots are freed quickly: nobody sits on a court without paying.
    hold_minutes: int = field(default_factory=lambda: _env_int("HOLD_MINUTES", 10))
    # Silent server-side tolerance so a proof sent a second before the deadline isn't lost to network latency
    hold_grace_seconds: int = field(default_factory=lambda: _env_int("HOLD_GRACE_SECONDS", 10))
    # The longest booking. Any length works as long as every hour is free (the slot table guarantees nobody
    # is bumped); the quick-pick chips only offer the common lengths, the +/- stepper goes up to this.
    max_hours: int = field(default_factory=lambda: _env_int("MAX_HOURS", 24))
    quick_hours: int = field(default_factory=lambda: _env_int("QUICK_HOURS", 5))
    # House rule: a group that hasn't arrived this long after its start is Late. It keeps its court until the host decides
    # (Arrived, or Release court): an idle court costs less than two groups on one court (plan D1).
    late_after_minutes: int = field(default_factory=lambda: _env_int("LATE_AFTER_MINUTES", 15))
    # After the host releases a Late booking's court, they can still undo it (Restore) for this long, if the hours are
    # still free. Guests are never told about it.
    restore_window_minutes: int = field(default_factory=lambda: _env_int("RESTORE_WINDOW_MINUTES", 5))
    # A payment that arrives this long after the hold ran out still claims the slot if nobody else took it; if someone
    # did, it is kept for the host to move or refund (plan D3). After that, the usual "your hold ran out".
    late_payment_minutes: int = field(default_factory=lambda: _env_int("LATE_PAYMENT_MINUTES", 30))
    # Who can move a paid booking. Off (default): only when the host calls a rebooking for bad weather (`weather_hold_at`),
    # because the host is the one watching the weather. On: guests also get one self-service move of their own.
    guest_reschedule: bool = field(default_factory=lambda: _env("GUEST_RESCHEDULE", "0").strip().lower() in ("1", "true", "yes", "on"))
    # Self-service rescheduling (GUEST_RESCHEDULE=1): once per booking, at least this long before the start; the new date
    # must be within `reschedule_window_days` of the original one. Weather delays are exempt from the once-only rule.
    reschedule_min_hours: int = field(default_factory=lambda: _env_int("RESCHEDULE_MIN_HOURS", 48))
    reschedule_window_days: int = field(default_factory=lambda: _env_int("RESCHEDULE_WINDOW_DAYS", 30))
    # Weather for the admin desk (Open-Meteo: free, no key). Defaults to Koronadal City.
    weather_enabled: bool = field(default_factory=lambda: _env("WEATHER_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off"))
    weather_latitude: float = field(default_factory=lambda: float(_env("WEATHER_LATITUDE", "6.5031")))
    weather_longitude: float = field(default_factory=lambda: float(_env("WEATHER_LONGITUDE", "124.8469")))
    # Rain chance (%) from which the desk warns about a booking.
    rain_warn_percent: int = field(default_factory=lambda: _env_int("RAIN_WARN_PERCENT", 60))
    # The desk's "All" list leaves out unpaid holds that ran out (they stay under More → Expired). A search still finds
    # them. Set to 1 to show them under "All" again.
    all_includes_expired: bool = field(default_factory=lambda: _env("ALL_INCLUDES_EXPIRED", "0").strip().lower() in ("1", "true", "yes", "on"))
    # Optional Telegram alerts to the host (create a bot with @BotFather, send it a message, use your chat id).
    telegram_bot_token: str = field(default_factory=lambda: _env("TELEGRAM_BOT_TOKEN", ""))
    telegram_chat_id: str = field(default_factory=lambda: _env("TELEGRAM_CHAT_ID", ""))
    booking_window_days: int = field(default_factory=lambda: _env_int("BOOKING_WINDOW_DAYS", 30))
    max_active_holds_per_ip: int = field(default_factory=lambda: _env_int("MAX_HOLDS_PER_IP", 2))
    max_receipt_bytes: int = field(default_factory=lambda: _env_int("MAX_RECEIPT_BYTES", 8 * 1024 * 1024))
    # How far a receipt's payment time may sit outside the hold window (typed references must be inside it).
    # Generous on purpose: phone clocks drift and some apps stamp the time the transfer settled.
    paid_time_tolerance_minutes: int = field(default_factory=lambda: _env_int("PAID_TIME_TOLERANCE_MINUTES", 30))
    paddle_fee: int = field(default_factory=lambda: _env_int("PADDLE_FEE", 80))
    # Privacy Notice promise: a receipt image is deleted this many days after the host confirms or rejects the
    # payment, or after the hard cap below if nobody ever reviewed it. The hash is kept to block reuse.
    receipt_keep_after_decision_days: int = field(default_factory=lambda: _env_int("RECEIPT_KEEP_AFTER_DECISION_DAYS", 7))
    receipt_retention_days: int = field(default_factory=lambda: _env_int("RECEIPT_RETENTION_DAYS", 14))
    # How a player proves payment. "reference" (default): they type the reference number and the sender's name, nothing is
    # uploaded and the OCR never runs, so a 512 MB server is plenty. "receipt": they upload a screenshot that is read on this
    # server (needs ~400 MB spare while reading; see app/ocr.py). Switch back to "receipt" after upgrading the server's RAM.
    proof_mode: str = field(default_factory=lambda: "receipt" if _env("PROOF_MODE", "reference").strip().lower() == "receipt" else "reference")
    # Read amount / reference / date / recipient off uploaded receipts (on this server; see app/ocr.py).
    ocr_enabled: bool = field(default_factory=lambda: _env("OCR_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off"))
    # A receipt that takes longer than this to read (model loading included) is abandoned and flagged for the host.
    ocr_timeout_seconds: int = field(default_factory=lambda: _env_int("OCR_TIMEOUT_SECONDS", 60))
    # Admin desk. With neither password set the admin API stays locked and no one can sign in.
    # ADMIN_PASSWORD_HASH (made with `python -m app.admin_auth`) is preferred over a plain ADMIN_PASSWORD.
    admin_password: str = field(default_factory=lambda: _env("ADMIN_PASSWORD", ""))
    admin_password_hash: str = field(default_factory=lambda: _env("ADMIN_PASSWORD_HASH", ""))
    # Hours a sign-in lasts; 0 = never expires (the single host account stays signed in until sign-out or a password change)
    admin_session_hours: int = field(default_factory=lambda: _env_int("ADMIN_SESSION_HOURS", 0))
    consent_version: str = field(default_factory=lambda: _env("CONSENT_VERSION", "2026-10-v1"))
    gcash: PaymentAccount = field(
        default_factory=lambda: PaymentAccount(
            "gcash",
            "GCash",
            _env("GCASH_ACCOUNT_NAME", "Reymark Vergara"),
            _env("GCASH_ACCOUNT_NUMBER", "09128285344"),
            qr_image=_env("GCASH_QR_IMAGE", "/images/payment-qr-gcash.jpg?v=2"),
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
    # MariBank's QR is InstaPay too, so it can be paid from GCash, Maya, MariBank or any bank app. Only the masked number
    # is shown (plan D8). MariBank's own receipt reference format isn't known yet (plan A2): until it is, a MariBank
    # booking also takes an all-digit reference of 10 to 20 numbers. Set MARIBANK_REFERENCE_DIGITS to the real
    # length(s) once the receipts are in.
    maribank: PaymentAccount = field(
        default_factory=lambda: PaymentAccount(
            "maribank",
            "MariBank",
            _env("MARIBANK_ACCOUNT_NAME", "Reymark Vergara"),
            _env("MARIBANK_ACCOUNT_NUMBER", ""),
            qr_image=_env("MARIBANK_QR_IMAGE", "/images/payment-qr-maribank.jpg"),
            account_hint=_env("MARIBANK_ACCOUNT_HINT", "•••• 8703"),
            reference_digits=_env_lengths("MARIBANK_REFERENCE_DIGITS", "10-20"),
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

    @property
    def payment_accounts(self) -> tuple[PaymentAccount, ...]:
        """Every account players can pay, in PAYMENT_METHODS order. Everything that lists or checks accounts reads this."""
        return (self.gcash, self.gotyme, self.maribank)

    def payment_account(self, method: str) -> PaymentAccount | None:
        return next((a for a in self.payment_accounts if a.method == method), None)


settings = Settings()
