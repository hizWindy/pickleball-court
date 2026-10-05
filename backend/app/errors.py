"""Domain errors carry a stable machine code plus a message that is safe to show to a player."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse


class BookingError(Exception):
    status_code = 400

    def __init__(self, code: str, message: str, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class NotFound(BookingError):
    status_code = 404


class Conflict(BookingError):
    status_code = 409


class Gone(BookingError):
    status_code = 410


class TooMany(BookingError):
    status_code = 429


async def booking_error_handler(_: Request, exc: BookingError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message}})
