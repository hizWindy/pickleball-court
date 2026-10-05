"""HousePickle Club booking API (FastAPI + SQLite).

Run:  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import booking_service
from app.api import router
from app.config import settings
from app.db import connect, init_db
from app.errors import BookingError, booking_error_handler

log = logging.getLogger("housepickle")
SWEEP_INTERVAL_SECONDS = 30


async def _sweep_forever() -> None:
    """Expire overdue holds even when nobody is browsing, so the record is accurate for admin.
    Roughly once an hour, also delete receipt images past their retention period."""
    ticks = 0
    while True:
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
        ticks += 1
        try:
            conn = connect()
            try:
                if n := booking_service.sweep(conn):
                    log.info("expired %d hold(s)", n)
                if ticks % 120 == 1 and (n := booking_service.purge_old_receipts(conn)):
                    log.info("deleted %d old receipt image(s)", n)
            finally:
                conn.close()
        except Exception:  # never let the sweeper die
            log.exception("hold sweep failed")


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    task = asyncio.create_task(_sweep_forever())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="HousePickle Club Booking API", version="1.0.0", lifespan=lifespan)
app.add_exception_handler(BookingError, booking_error_handler)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields = []
    for err in exc.errors():
        msg = str(err.get("msg", "Invalid value")).removeprefix("Value error, ")
        fields.append({"field": ".".join(str(p) for p in err.get("loc", ()) if p != "body"), "message": msg})
    message = fields[0]["message"] if fields else "Please check your details."
    return JSONResponse(status_code=422, content={"error": {"code": "invalid_input", "message": message, "fields": fields}})


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"  # availability and bookings must never be stale
    return response


app.include_router(router)

# In production, serve the built PWA from the same origin (no CORS, one deployment).
_dist = settings.frontend_dist
if (_dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        candidate = (_dist / path).resolve()
        if path and candidate.is_file() and _dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
