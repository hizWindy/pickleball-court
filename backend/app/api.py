"""Public booking API. Routers only parse HTTP and delegate to booking_service."""

from __future__ import annotations

import sqlite3
from datetime import date

from fastapi import APIRouter, Depends, File, Form, Header, Request, UploadFile, status

from app import booking_service as svc
from app.config import settings
from app.db import get_conn
from app.errors import BookingError
from app.ratelimit import client_ip, limit
from app.schemas import (
    AvailabilityOut,
    BookingOut,
    BookingWithTokenOut,
    ConfigOut,
    CreateBookingIn,
    ReferenceProofIn,
)

router = APIRouter(prefix="/api")
Conn = Depends(get_conn)
TOKEN_HEADER = Header(default=None, alias="X-Booking-Token")


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/config", response_model=ConfigOut, response_model_by_alias=True)
def config(conn: sqlite3.Connection = Conn) -> ConfigOut:
    return svc.get_config(conn)


@router.get("/availability", response_model=AvailabilityOut, response_model_by_alias=True)
def availability(date: date, conn: sqlite3.Connection = Conn) -> AvailabilityOut:
    return svc.availability(conn, date)


@router.post(
    "/bookings", status_code=status.HTTP_201_CREATED,
    response_model=BookingWithTokenOut, response_model_by_alias=True,
)
def create_booking(data: CreateBookingIn, request: Request, conn: sqlite3.Connection = Conn) -> BookingWithTokenOut:
    limit(request, "create", max_hits=10, window_seconds=3600)
    booking, token = svc.create_booking(conn, data, client_ip(request))
    return BookingWithTokenOut(booking=booking, access_token=token)


@router.get("/bookings/{code}", response_model=BookingOut, response_model_by_alias=True)
def get_booking(code: str, token: str | None = TOKEN_HEADER, conn: sqlite3.Connection = Conn) -> BookingOut:
    return svc.get_booking(conn, code, token)


@router.post("/bookings/{code}/receipt", response_model=BookingOut, response_model_by_alias=True)
def submit_receipt(
    code: str,
    request: Request,
    receipt: UploadFile = File(...),
    payer_name: str | None = Form(default=None, alias="payerName", max_length=80),
    token: str | None = TOKEN_HEADER,
    conn: sqlite3.Connection = Conn,
) -> BookingOut:
    limit(request, "proof", max_hits=15, window_seconds=600)
    # Read one byte past the cap so oversized uploads are rejected without buffering them whole.
    data = receipt.file.read(settings.max_receipt_bytes + 1)
    return svc.submit_receipt(conn, code, token, data, (payer_name or "").strip() or None)


@router.post("/bookings/{code}/reference", response_model=BookingOut, response_model_by_alias=True)
def submit_reference(
    code: str, data: ReferenceProofIn, request: Request,
    token: str | None = TOKEN_HEADER, conn: sqlite3.Connection = Conn,
) -> BookingOut:
    limit(request, "proof", max_hits=15, window_seconds=600)
    return svc.submit_reference(conn, code, token, data)


@router.post("/bookings/{code}/cancel", response_model=BookingOut, response_model_by_alias=True)
def cancel(code: str, token: str | None = TOKEN_HEADER, conn: sqlite3.Connection = Conn) -> BookingOut:
    return svc.cancel(conn, code, token)


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
def api_not_found(path: str) -> None:
    raise BookingError("not_found", "Unknown API route.", status_code=404)
