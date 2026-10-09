"""Rain forecast for the admin desk, from Open-Meteo (free, no account or key).

The court is outdoors, so rain means rescheduling. The forecast only *informs* the host: tropical showers are
hard to predict, so nothing is moved automatically. Results are cached for 15 minutes; if the service can't be
reached the last good answer is used for up to 3 hours, then the desk just says the forecast is unavailable.
"""

from __future__ import annotations

import json
import logging
import threading
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta

from app import clock
from app.clock import MANILA
from app.config import settings

log = logging.getLogger("housepickle.weather")

CACHE_SECONDS = 15 * 60
STALE_SECONDS = 3 * 60 * 60
FORECAST_DAYS = 4

_lock = threading.Lock()
_cache: tuple[datetime, list["Hour"]] | None = None


@dataclass(frozen=True)
class Hour:
    start: datetime  # aware; the hour it covers begins here
    probability: int  # chance of rain, 0-100
    mm: float  # expected rain in that hour


def _fetch() -> dict:
    """One call to Open-Meteo. Kept separate so tests can replace it."""
    query = urllib.parse.urlencode({
        "latitude": settings.weather_latitude,
        "longitude": settings.weather_longitude,
        "hourly": "precipitation_probability,precipitation",
        "timezone": "Asia/Manila",
        "forecast_days": FORECAST_DAYS,
    })
    req = urllib.request.Request(f"https://api.open-meteo.com/v1/forecast?{query}", headers={"User-Agent": "HousePickleClub/1.0"})
    with urllib.request.urlopen(req, timeout=6) as res:  # noqa: S310 (fixed https URL)
        return json.loads(res.read().decode("utf-8"))


def _parse(payload: dict) -> list[Hour]:
    hourly = payload["hourly"]
    hours = []
    for at, prob, mm in zip(hourly["time"], hourly["precipitation_probability"], hourly["precipitation"]):
        hours.append(Hour(
            start=datetime.fromisoformat(at).replace(tzinfo=MANILA),  # requested in Manila time, so these are local
            probability=int(prob or 0),
            mm=float(mm or 0.0),
        ))
    return hours


def forecast(now: datetime | None = None) -> list[Hour] | None:
    """Hourly forecast from the current hour onward, or None if there is none to show."""
    if not settings.weather_enabled:
        return None
    global _cache
    now = now or clock.now()
    with _lock:
        if _cache and (now - _cache[0]).total_seconds() < CACHE_SECONDS:
            hours = _cache[1]
        else:
            try:
                hours = _parse(_fetch())
                _cache = (now, hours)
            except Exception:  # offline, rate limited, odd payload...
                log.warning("weather forecast unavailable", exc_info=True)
                if not _cache or (now - _cache[0]).total_seconds() > STALE_SECONDS:
                    return None
                hours = _cache[1]
    current = now.astimezone(MANILA).replace(minute=0, second=0, microsecond=0)
    return [h for h in hours if h.start >= current]


def reset() -> None:
    """Forget the cached forecast (tests)."""
    global _cache
    with _lock:
        _cache = None


def peak(hours: list[Hour], start: datetime, end: datetime) -> int | None:
    """Highest rain chance among the forecast hours that overlap [start, end), None if none are covered."""
    window = [h.probability for h in hours if h.start < end and h.start + timedelta(hours=1) > start]
    return max(window) if window else None
