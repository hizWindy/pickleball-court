"""Request/response models. JSON uses camelCase to match the frontend."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.validation import clean_name, normalize_ph_mobile

PaymentMethod = Literal["gcash", "gotyme"]
BookingStatus = Literal["held", "pending_verification", "confirmed", "rejected", "expired", "cancelled"]
SlotState = Literal["available", "held", "booked", "past"]


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ── Config ────────────────────────────────────────────────────────────────────
class CourtOut(ApiModel):
    id: str
    name: str
    day_rate: int
    night_rate: int


class PaymentAccountOut(ApiModel):
    method: PaymentMethod
    label: str
    account_name: str
    account_number: str
    qr_image: str
    account_hint: str
    enabled: bool


class ConfigOut(ApiModel):
    courts: list[CourtOut]
    payment_accounts: list[PaymentAccountOut]
    paddle_fee: int
    hold_minutes: int
    max_hours: int
    booking_window_days: int
    late_after_minutes: int
    reschedule_min_hours: int
    reschedule_window_days: int
    consent_version: str
    today: date  # current play day in Manila
    server_now: str


# ── Availability ──────────────────────────────────────────────────────────────
class SlotOut(ApiModel):
    hour: int
    start_at: str
    period: str
    rate_type: Literal["standard", "night_owl"]
    courts: dict[str, SlotState]


class AvailabilityOut(ApiModel):
    date: date
    server_now: str
    slots: list[SlotOut]


# ── Bookings ──────────────────────────────────────────────────────────────────
class CreateBookingIn(ApiModel):
    court_id: str
    date: date
    hour: int = Field(ge=0, le=23)
    hours: int = Field(ge=1, le=12)
    paddles: bool = False
    customer_name: str
    customer_phone: str
    payment_method: PaymentMethod
    consent: bool
    consent_version: str
    marketing_opt_in: bool = False

    @field_validator("customer_name")
    @classmethod
    def _name(cls, v: str) -> str:
        return clean_name(v)

    @field_validator("customer_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_ph_mobile(v)


class ReferenceProofIn(ApiModel):
    reference_number: str = Field(max_length=40)
    paid_time: str = Field(pattern=r"^\d{2}:\d{2}$", description="HH:MM (24h) as shown on the receipt")
    payer_name: str

    @field_validator("payer_name")
    @classmethod
    def _payer(cls, v: str) -> str:
        return clean_name(v)


class LineItemOut(ApiModel):
    start_at: str
    rate: int
    rate_type: Literal["standard", "night_owl"]


RescheduleState = Literal["open", "weather", "used", "too_late", "unavailable"]
PendingReason = Literal["amount_short", "amount_unreadable"]


class BookingOut(ApiModel):
    code: str
    status: BookingStatus
    court_id: str
    court_name: str
    play_date: date
    start_at: str
    end_at: str
    hours: int
    customer_name: str
    customer_phone_masked: str
    payment_method: PaymentMethod
    paddles: bool
    line_items: list[LineItemOut]
    court_cost: int
    addons_cost: int
    total: int
    created_at: str
    hold_expires_at: str
    submitted_at: str | None
    proof_type: Literal["receipt", "reference"] | None
    closed_at: str | None
    server_now: str
    # What the pass needs to know once the booking is paid
    arrived: bool  # the group has checked in
    late: bool  # not there in time: the hours were released (the host may still sort it out)
    weather_hold: bool  # the host called a rain delay: pick a new time
    can_check_in: bool
    reschedule: RescheduleState
    reschedule_count: int
    # Why a payment is waiting for the host instead of confirming, and what the receipt showed
    pending_reason: PendingReason | None = None
    amount_paid: float | None = None


class BookingWithTokenOut(ApiModel):
    booking: BookingOut
    access_token: str


# ── Rescheduling ──────────────────────────────────────────────────────────────
class RescheduleLookupIn(ApiModel):
    """Proof of ownership is the booking code plus the mobile number on it (or this device's booking token)."""

    code: str = Field(max_length=20)
    customer_phone: str | None = None

    @field_validator("customer_phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return normalize_ph_mobile(v) if v and v.strip() else None


class RescheduleIn(RescheduleLookupIn):
    court_id: str | None = None
    date: date
    hour: int = Field(ge=0, le=23)


class RescheduleLookupOut(ApiModel):
    booking: BookingOut
    access_token: str  # lets this device keep reading the booking after the lookup
    earliest_date: date
    latest_date: date
