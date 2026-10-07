"""Admin desk API. Everything except sign-in sits behind `require_admin`."""

from __future__ import annotations

import sqlite3
from datetime import date

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import FileResponse

from app import admin_auth, admin_service as svc
from app.admin_schemas import (
    AdminBookingDetail,
    AdminBookingList,
    AdminCreateIn,
    AdminSchedule,
    AdminUpdateIn,
    LoginIn,
    NavCounts,
    OverviewOut,
    ReasonIn,
    SessionOut,
)
from app.db import get_conn
from app.errors import BookingError
from app.ratelimit import limit

router = APIRouter(prefix="/api/admin")
Conn = Depends(get_conn)
Guard = [Depends(admin_auth.require_admin)]
OUT = {"response_model_by_alias": True}

_MEDIA = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic"}


# ── Sign in / out ─────────────────────────────────────────────────────────────
@router.get("/session", response_model=SessionOut, **OUT)
def session(request: Request, conn: sqlite3.Connection = Conn) -> SessionOut:
    return SessionOut(authenticated=admin_auth.is_signed_in(request, conn))


@router.post("/login", response_model=SessionOut, **OUT)
def login(data: LoginIn, request: Request, response: Response, conn: sqlite3.Connection = Conn) -> SessionOut:
    limit(request, "admin-login", max_hits=8, window_seconds=900)  # per IP
    limit(request, "admin-login-all", max_hits=200, window_seconds=3600, per_ip=False)  # across everyone, bounds distributed guessing
    if not admin_auth.configured():
        raise BookingError("not_configured", "Admin sign-in isn't set up on this server yet.", status_code=503)
    if not admin_auth.verify_password(data.password):
        admin_auth.failed_attempt_pause()
        raise BookingError("bad_password", "That password isn't right.", status_code=401)
    admin_auth.start_session(conn, request, response)
    return SessionOut(authenticated=True)


@router.post("/logout", response_model=SessionOut, **OUT)
def logout(request: Request, response: Response, conn: sqlite3.Connection = Conn) -> SessionOut:
    admin_auth.end_session(conn, request, response)
    return SessionOut(authenticated=False)


# ── Dashboard ─────────────────────────────────────────────────────────────────
@router.get("/counts", response_model=NavCounts, dependencies=Guard, **OUT)
def counts(conn: sqlite3.Connection = Conn) -> NavCounts:
    return svc.nav_counts(conn)


@router.get("/overview", response_model=OverviewOut, dependencies=Guard, **OUT)
def overview(days: int = 30, conn: sqlite3.Connection = Conn) -> OverviewOut:
    return svc.overview(conn, days)


@router.get("/schedule", response_model=AdminSchedule, dependencies=Guard, **OUT)
def schedule(date: date, conn: sqlite3.Connection = Conn) -> AdminSchedule:
    return svc.schedule(conn, date)


# ── Bookings ──────────────────────────────────────────────────────────────────
@router.get("/bookings", response_model=AdminBookingList, dependencies=Guard, **OUT)
def list_bookings(
    q: str | None = None,
    status: str | None = None,
    review: str | None = None,
    date_from: date | None = Query(default=None, alias="dateFrom"),
    date_to: date | None = Query(default=None, alias="dateTo"),
    court_id: str | None = Query(default=None, alias="courtId"),
    sort: str = "start_desc",
    page: int = 1,
    page_size: int = Query(default=25, alias="pageSize"),
    conn: sqlite3.Connection = Conn,
) -> AdminBookingList:
    return svc.list_bookings(
        conn, q=q, status=status, review=review, date_from=date_from, date_to=date_to,
        court_id=court_id, sort=sort, page=page, page_size=page_size,
    )


@router.post("/bookings", status_code=status.HTTP_201_CREATED, response_model=AdminBookingDetail, dependencies=Guard, **OUT)
def create_booking(data: AdminCreateIn, conn: sqlite3.Connection = Conn) -> AdminBookingDetail:
    return svc.create(conn, data)


@router.get("/bookings/{code}", response_model=AdminBookingDetail, dependencies=Guard, **OUT)
def get_booking(code: str, conn: sqlite3.Connection = Conn) -> AdminBookingDetail:
    return svc.get_detail(conn, code)


@router.patch("/bookings/{code}", response_model=AdminBookingDetail, dependencies=Guard, **OUT)
def update_booking(code: str, data: AdminUpdateIn, conn: sqlite3.Connection = Conn) -> AdminBookingDetail:
    return svc.update(conn, code, data)


@router.post("/bookings/{code}/confirm", response_model=AdminBookingDetail, dependencies=Guard, **OUT)
def confirm_booking(code: str, conn: sqlite3.Connection = Conn) -> AdminBookingDetail:
    return svc.confirm(conn, code)


@router.post("/bookings/{code}/check", response_model=AdminBookingDetail, dependencies=Guard, **OUT)
def check_booking(code: str, conn: sqlite3.Connection = Conn) -> AdminBookingDetail:
    return svc.mark_checked(conn, code)


@router.post("/bookings/{code}/reject", response_model=AdminBookingDetail, dependencies=Guard, **OUT)
def reject_booking(code: str, data: ReasonIn | None = None, conn: sqlite3.Connection = Conn) -> AdminBookingDetail:
    return svc.reject(conn, code, data.reason if data else None)


@router.post("/bookings/{code}/cancel", response_model=AdminBookingDetail, dependencies=Guard, **OUT)
def cancel_booking(code: str, data: ReasonIn | None = None, conn: sqlite3.Connection = Conn) -> AdminBookingDetail:
    return svc.cancel(conn, code, data.reason if data else None)


@router.delete("/bookings/{code}", status_code=status.HTTP_204_NO_CONTENT, dependencies=Guard)
def delete_booking(code: str, conn: sqlite3.Connection = Conn) -> Response:
    svc.delete(conn, code)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/bookings/{code}/receipt", dependencies=Guard)
def receipt(code: str, conn: sqlite3.Connection = Conn) -> FileResponse:
    path = svc.receipt_file(conn, code)
    return FileResponse(
        path,
        media_type=_MEDIA.get(path.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "private, no-store", "Content-Disposition": "inline"},
    )
