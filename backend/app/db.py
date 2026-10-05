"""SQLite connection handling and schema."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from app.config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS courts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    day_rate    INTEGER NOT NULL,
    night_rate  INTEGER NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bookings (
    id                  TEXT PRIMARY KEY,
    code                TEXT NOT NULL UNIQUE,
    status              TEXT NOT NULL CHECK (status IN
                          ('held','pending_verification','confirmed','rejected','expired','cancelled')),
    source              TEXT NOT NULL DEFAULT 'online',
    court_id            TEXT NOT NULL REFERENCES courts(id),
    start_at            TEXT NOT NULL,
    hours               INTEGER NOT NULL,
    customer_name       TEXT NOT NULL,
    customer_phone      TEXT NOT NULL,
    payment_method      TEXT NOT NULL,
    paddles             INTEGER NOT NULL DEFAULT 0,
    court_cost          INTEGER NOT NULL,
    addons_cost         INTEGER NOT NULL,
    total               INTEGER NOT NULL,
    consent_at          TEXT NOT NULL,
    consent_version     TEXT NOT NULL,
    marketing_opt_in    INTEGER NOT NULL DEFAULT 0,
    client_ip           TEXT,
    created_at          TEXT NOT NULL,
    hold_expires_at     TEXT NOT NULL,
    submitted_at        TEXT,
    proof_type          TEXT CHECK (proof_type IN ('receipt','reference')),
    receipt_path        TEXT,
    receipt_sha256      TEXT,
    reference_number    TEXT,
    paid_at             TEXT,
    payer_name          TEXT,
    closed_at           TEXT,
    close_reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_status_expiry ON bookings(status, hold_expires_at);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(customer_phone, status);
-- A payment proof can back exactly one booking, forever (even after rejection).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_receipt ON bookings(receipt_sha256) WHERE receipt_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_reference ON bookings(reference_number) WHERE reference_number IS NOT NULL;

-- One row per occupied court-hour. The primary key is what makes double booking
-- impossible; rows are deleted when a booking expires, is cancelled or rejected.
CREATE TABLE IF NOT EXISTS booking_slots (
    court_id    TEXT NOT NULL REFERENCES courts(id),
    slot_start  TEXT NOT NULL,
    booking_id  TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    PRIMARY KEY (court_id, slot_start)
);
CREATE INDEX IF NOT EXISTS idx_slots_booking ON booking_slots(booking_id);

-- Bearer secrets that let a device read/act on its booking. Only hashes are stored.
CREATE TABLE IF NOT EXISTS booking_access (
    token_hash  TEXT PRIMARY KEY,
    booking_id  TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL
);
"""

SEED_COURTS = [
    ("court-1", "Court 1", 250, 200, 1),
    ("court-2", "Court 2", 250, 200, 2),
]


def connect() -> sqlite3.Connection:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    # isolation_level=None: we issue BEGIN IMMEDIATE ourselves for write transactions.
    conn = sqlite3.connect(settings.db_path, timeout=10, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def init_db() -> None:
    settings.receipts_dir.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        conn.executemany(
            "INSERT OR IGNORE INTO courts (id, name, day_rate, night_rate, sort_order) VALUES (?, ?, ?, ?, ?)",
            SEED_COURTS,
        )
    finally:
        conn.close()


@contextmanager
def write_transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """BEGIN IMMEDIATE takes the write lock up front, so check-then-insert is race-free."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def get_conn() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: one connection per request."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
