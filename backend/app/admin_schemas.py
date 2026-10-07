"""Request/response models for the admin desk (camelCase JSON, like the public API)."""

from __future__ import annotations

from datetime import date as Day
from typing import Literal

from pydantic import Field, field_validator

from app.schemas import ApiModel, BookingStatus, LineItemOut
from app.validation import clean_name, normalize_ph_mobile

AdminPayment = Literal["gcash", "gotyme", "cash", "none"]
Source = Literal["online", "walk_in", "blocked"]


def _optional_phone(v: str | None) -> str | None:
    if v is None or not v.strip():
        return "" if v is not None else None
    return normalize_ph_mobile(v)


# ── Session ───────────────────────────────────────────────────────────────────
class LoginIn(ApiModel):
    password: str = Field(max_length=200)


class SessionOut(ApiModel):
    authenticated: bool


# ── Bookings ──────────────────────────────────────────────────────────────────
class FlagOut(ApiModel):
    code: str
    message: str


class ScanOut(ApiModel):
    """What was read off the receipt image."""

    engine: str
    provider: str | None
    amount: float | None  # pesos
    reference: str | None
    paid_at: str | None
    recipient_name: str | None
    recipient_number: str | None
    success: bool | None
    raw_text: str | None  # erased with the image
    duration_ms: int | None


class EventOut(ApiModel):
    action: str
    detail: str | None
    created_at: str


class AdminBookingOut(ApiModel):
    code: str
    status: BookingStatus
    source: Source
    court_id: str
    court_name: str
    play_date: Day
    hour: int  # clock hour (Manila) the booking starts at
    start_at: str
    end_at: str
    hours: int
    customer_name: str
    customer_phone: str
    payment_method: AdminPayment
    paddles: bool
    court_cost: int
    addons_cost: int
    total: int
    custom_price: bool  # the host overrode the computed price
    created_at: str
    submitted_at: str | None
    decided_at: str | None
    closed_at: str | None
    close_reason: str | None
    hold_expires_at: str
    proof_type: Literal["receipt", "reference"] | None
    has_receipt: bool
    reference_number: str | None
    paid_at: str | None
    payer_name: str | None
    admin_note: str | None
    checked_at: str | None
    review_flags: list[FlagOut]
    needs_review: bool  # paid online, confirmed automatically, not looked at yet


class AdminBookingDetail(AdminBookingOut):
    line_items: list[LineItemOut]
    events: list[EventOut]
    scan: ScanOut | None


class StatusCounts(ApiModel):
    all: int
    held: int
    pending_verification: int
    confirmed: int
    rejected: int
    expired: int
    cancelled: int
    to_review: int
    flagged: int


class AdminBookingList(ApiModel):
    items: list[AdminBookingOut]
    total: int
    page: int
    page_size: int
    counts: StatusCounts


class NavCounts(ApiModel):
    to_review: int
    flagged: int
    held: int


class AdminCreateIn(ApiModel):
    kind: Literal["walk_in", "block"] = "walk_in"
    court_id: str
    date: Day
    hour: int = Field(ge=0, le=23)
    hours: int = Field(ge=1, le=12)
    paddles: bool = False
    customer_name: str  # for a block, the reason ("Maintenance")
    customer_phone: str = ""
    payment_method: AdminPayment = "cash"
    total: int | None = Field(default=None, ge=0, le=100_000)
    note: str | None = Field(default=None, max_length=300)

    @field_validator("customer_name")
    @classmethod
    def _name(cls, v: str) -> str:
        return clean_name(v)

    @field_validator("customer_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return _optional_phone(v) or ""


class AdminUpdateIn(ApiModel):
    """Only the fields that are sent are changed. Send `total: null` to go back to the computed price."""

    court_id: str | None = None
    date: Day | None = None
    hour: int | None = Field(default=None, ge=0, le=23)
    hours: int | None = Field(default=None, ge=1, le=12)
    paddles: bool | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    payment_method: AdminPayment | None = None
    total: int | None = Field(default=None, ge=0, le=100_000)
    note: str | None = Field(default=None, max_length=300)

    @field_validator("customer_name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return clean_name(v) if v is not None else None

    @field_validator("customer_phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return _optional_phone(v)


class ReasonIn(ApiModel):
    reason: str | None = Field(default=None, max_length=200)


# ── Schedule ──────────────────────────────────────────────────────────────────
class AdminSchedule(ApiModel):
    date: Day
    server_now: str
    bookings: list[AdminBookingOut]


# ── Overview ──────────────────────────────────────────────────────────────────
class Kpis(ApiModel):
    revenue: int
    revenue_prev: int
    bookings: int
    bookings_prev: int
    hours: int
    avg_booking: int
    paddle_revenue: int
    utilisation_pct: float
    court_hours_available: int
    conversion_pct: float | None  # None until a few online bookings have closed
    repeat_customers: int
    customers: int


class DayPoint(ApiModel):
    date: Day
    revenue: int
    bookings: int
    hours: int


class WeekdayPoint(ApiModel):
    weekday: int  # 0 = Monday
    revenue: int
    bookings: int


class CourtPoint(ApiModel):
    court_id: str
    name: str
    revenue: int
    hours: int
    bookings: int


class MethodPoint(ApiModel):
    method: AdminPayment
    revenue: int
    bookings: int


class RatePoint(ApiModel):
    rate_type: Literal["standard", "night_owl"]
    revenue: int
    hours: int


class Funnel(ApiModel):
    confirmed: int
    pending_verification: int
    held: int
    rejected: int
    expired: int
    cancelled: int


class TopCustomer(ApiModel):
    name: str
    phone: str
    bookings: int
    hours: int
    spent: int


class Pipeline(ApiModel):
    count: int
    amount: int
    flagged: int


class OverviewOut(ApiModel):
    days: int
    date_from: Day
    date_to: Day
    today: Day
    server_now: str
    kpis: Kpis
    daily: list[DayPoint]
    by_hour: list[int]  # booked hours per clock hour 0-23
    by_weekday: list[WeekdayPoint]
    by_court: list[CourtPoint]
    by_method: list[MethodPoint]
    by_rate: list[RatePoint]
    funnel: Funnel
    pending: Pipeline
    up_next: list[AdminBookingOut]
    top_customers: list[TopCustomer]
