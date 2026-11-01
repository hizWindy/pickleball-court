"""Court day model and pricing.

The venue is open 24/7, but players think of 12 AM - 4 AM as the tail of the
previous night. So a "play day" D runs from 5:00 AM on D to 4:59 AM on D+1:
picking Saturday and 1:00 AM means early Sunday morning.

All slots are one hour long and start on the hour (Manila time).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from app.clock import MANILA, UTC

DAY_START_HOUR = 5
NIGHT_START_HOUR = 18  # Morning is 5 AM - 6 PM (₱200/hr); Evening is 6 PM - 5 AM (₱250/hr)

# Display order within a play day: 5 AM ... 11 PM, 12 AM ... 4 AM
PLAY_DAY_HOURS: list[int] = list(range(DAY_START_HOUR, 24)) + list(range(0, DAY_START_HOUR))


def period_for_hour(hour: int) -> str:
    """The two booking groups players pick from. They line up with the two rates."""
    return "evening" if is_night_hour(hour) else "morning"


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
    """Each hour is priced by its own start time, so 5 PM - 7 PM = ₱200 + ₱250."""
    items = []
    for i in range(hours):
        s = start + timedelta(hours=i)
        h = s.astimezone(MANILA).hour
        night = is_night_hour(h)
        items.append(LineItem(s, h, night_rate if night else day_rate, "night_owl" if night else "standard"))
    return items
