import os
import tempfile
from datetime import datetime, timedelta

import pytest

# Point the app at a throwaway data dir *before* it is imported.
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="housepickle-test-")
# GoTyme starts "unconfigured" in tests; one test switches it on with a QR image only.
os.environ["GOTYME_ACCOUNT_NUMBER"] = ""
os.environ["GOTYME_QR_IMAGE"] = ""
os.environ["ADMIN_PASSWORD"] = "correct horse battery"
os.environ["ADMIN_PASSWORD_HASH"] = ""  # empty (not unset) so a real .env can't override the test password
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
# The real OCR engine is only loaded by the tests that ask for it (see test_receipts.py).
os.environ["OCR_ENABLED"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app import clock, ratelimit, weather  # noqa: E402
from app.clock import MANILA  # noqa: E402
from app.db import connect  # noqa: E402
from app.main import app  # noqa: E402


class FakeClock:
    def __init__(self, start: datetime):
        self.current = start

    def __call__(self) -> datetime:
        return self.current

    def advance(self, **kwargs) -> None:
        self.current += timedelta(**kwargs)


@pytest.fixture
def fake_now(monkeypatch):
    fc = FakeClock(datetime(2026, 10, 10, 10, 0, tzinfo=MANILA).astimezone(clock.UTC))
    monkeypatch.setattr(clock, "now", fc)
    return fc


@pytest.fixture
def client(fake_now):
    with TestClient(app) as c:
        conn = connect()
        conn.executescript(
            "DELETE FROM booking_access; DELETE FROM booking_slots; DELETE FROM bookings;"
            "DELETE FROM admin_sessions; DELETE FROM admin_events; DELETE FROM receipt_scans; DELETE FROM notices_sent;"
        )
        conn.close()
        ratelimit.reset()
        weather.reset()
        yield c


@pytest.fixture
def admin(client):
    """The same client, signed in to the admin desk (cookie + the header every write must carry)."""
    res = client.post("/api/admin/login", json={"password": ADMIN_PASSWORD})
    assert res.status_code == 200, res.text
    client.headers["X-HP-Admin"] = "1"
    return client


@pytest.fixture
def booking_payload():
    def make(**overrides):
        body = {
            "courtId": "court-1",
            "date": "2026-10-10",
            "hour": 19,
            "hours": 1,
            "paddles": False,
            "customerName": "Juan dela Cruz",
            "customerPhone": "0917 123 4567",
            "paymentMethod": "gcash",
            "consent": True,
            "consentVersion": "2026-10-v1",
        }
        body.update(overrides)
        return body

    return make
