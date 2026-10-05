"""Single source of "now" so tests can move time without sleeping."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

UTC = timezone.utc
# The Philippines has no daylight saving time, so a fixed offset is exact
# (and avoids depending on tzdata, which Windows Python doesn't ship).
MANILA = timezone(timedelta(hours=8), "Asia/Manila")


def now() -> datetime:
    """Current time, timezone-aware UTC."""
    return datetime.now(UTC)


def to_iso(dt: datetime) -> str:
    """Canonical storage format. Fixed width, so string comparison == time comparison."""
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def from_iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
