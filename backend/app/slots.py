"""Court day model and pricing.

The venue is open 24/7, but players think of 12 AM - 5 AM as the tail of the
previous night. So a "play day" D runs from 6:00 AM on D to 5:59 AM on D+1:
picking Saturday and 1:00 AM means early Sunday morning.

All slots are one hour long and start on the hour (Manila time).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from app.clock import MANILA, UTC

DAY_START_HOUR = 6
NIGHT_START_HOUR = 22  # 10 PM - 6 AM is the night-owl promo rate

# Display order within a play day: 6 AM ... 11 PM, 12 AM ... 5 AM
PLAY_DAY_HOURS: list[int] = list(range(DAY_START_HOUR, 24)) + list(range(0, DAY_START_HOUR))


def period_for_hour(hour: int) -> str:
    if 6 <= hour <= 11:
        return "morning"
    if 12 <= hour <= 16:
        return "afternoon"
    if 17 <= hour <= 21:
        return "evening"
    return "night_owl"


def is_night_hour(hour: int) -> bool:
    return hour >= NIGHT_START_HOUR or hour < DAY_START_HOUR


def slot_start(play_date: date, hour: int) -> datetime:
    """Absolute start (UTC) of the slot at `hour` on play day `play_date`."""
    calendar_date = play_date + timedelta(days=1) if hour < DAY_START_HOUR else play_date
    return datetime.combine(calendar_date, time(hour), tzinfo=MANILA).astimezone(UTC)


def play_date_of(start: datetime) -> date:
    local = start.astimezone(MANILA)
    return local.date() - timedelta(days=1) if local.hour < DAY_START_HOUR else local.date()


def current_play_date(now: datetime) -> date:
    return play_date_of(now)


@dataclass(frozen=True)
class LineItem:
    start: datetime
    hour: int
    rate: int
    rate_type: str  # "standard" | "night_owl"


def price_hours(start: datetime, hours: int, day_rate: int, night_rate: int) -> list[LineItem]:
    """Each hour is priced by its own start time, so 9 PM - 11 PM = ₱250 + ₱200."""
    items = []
    for i in range(hours):
        s = start + timedelta(hours=i)
        h = s.astimezone(MANILA).hour
        night = is_night_hour(h)
        items.append(LineItem(s, h, night_rate if night else day_rate, "night_owl" if night else "standard"))
    return items
