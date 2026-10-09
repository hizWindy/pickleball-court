"""Admin sign-in: one shared password, server-side sessions, an HttpOnly cookie.

Hiding the link to the desk is only a courtesy. What keeps it safe is this module:

* The password is checked in constant time against a scrypt hash (or a plain env var for quick setups).
* Sign-in attempts are rate limited per IP and, more loosely, across everyone.
* The cookie is HttpOnly (scripts can't read it), SameSite=Strict (other sites can't use it) and only
  sent to /api/admin. Over HTTPS it is also Secure.
* Sessions live in the database as hashes, expire (or never, when ADMIN_SESSION_HOURS=0), and die when the password changes.
* Every write must carry a custom header that a cross-site form can't add.

Make a hash:  python -m app.admin_auth
"""

from __future__ import annotations

import functools
import getpass
import hashlib
import hmac
import secrets
import sqlite3
import time
from datetime import datetime, timedelta

from fastapi import Depends, Request, Response

from app import clock
from app.clock import to_iso
from app.config import settings
from app.db import get_conn
from app.errors import BookingError

COOKIE = "hp_admin"
COOKIE_PATH = "/api/admin"
CSRF_HEADER = "X-HP-Admin"
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


# ── Password ──────────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt:{_SCRYPT['n']}:{_SCRYPT['r']}:{_SCRYPT['p']}:{salt.hex()}:{digest.hex()}"


def _check_hash(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split(":")
        if scheme != "scrypt":
            return False
        candidate = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(digest) // 2
        )
        return hmac.compare_digest(candidate, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False


def configured() -> bool:
    return bool(settings.admin_password_hash or settings.admin_password)


def verify_password(password: str) -> bool:
    if settings.admin_password_hash:
        return _check_hash(password, settings.admin_password_hash)
    if settings.admin_password:
        return hmac.compare_digest(password.encode(), settings.admin_password.encode())
    return False


@functools.cache
def _plain_fingerprint(password: str) -> str:
    # Slow on purpose: this value is stored in the database, and a plain password must not be guessable from it.
    return hashlib.scrypt(password.encode(), salt=b"hp-admin-session-fp", **_SCRYPT).hex()[:24]


def password_fingerprint() -> str:
    """Changes whenever the configured password changes, which signs every session out."""
    if settings.admin_password_hash:
        return hashlib.sha256(settings.admin_password_hash.encode()).hexdigest()[:24]
    return _plain_fingerprint(settings.admin_password)


# ── Sessions ──────────────────────────────────────────────────────────────────
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _session_lifetime() -> timedelta:
    """ADMIN_SESSION_HOURS=0 means the host stays signed in until they sign out or change the password."""
    return timedelta(hours=settings.admin_session_hours) if settings.admin_session_hours > 0 else timedelta(days=3650)


def start_session(conn: sqlite3.Connection, request: Request, response: Response) -> None:
    now = clock.now()
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM admin_sessions WHERE expires_at <= ?", (to_iso(now),))
    conn.execute(
        "INSERT INTO admin_sessions (token_hash, pw_fp, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
        (
            _hash_token(token), password_fingerprint(), to_iso(now),
            to_iso(now + _session_lifetime()),
            request.client.host if request.client else None,
            (request.headers.get("user-agent") or "")[:200],
        ),
    )
    response.set_cookie(
        COOKIE, token, max_age=int(_session_lifetime().total_seconds()), path=COOKIE_PATH,
        httponly=True, samesite="strict", secure=request.url.scheme == "https",
    )


def end_session(conn: sqlite3.Connection, request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        conn.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (_hash_token(token),))
    response.delete_cookie(COOKIE, path=COOKIE_PATH)


def _valid_session(conn: sqlite3.Connection, token: str | None, now: datetime) -> bool:
    if not token or not configured():
        return False
    row = conn.execute("SELECT pw_fp, expires_at FROM admin_sessions WHERE token_hash = ?", (_hash_token(token),)).fetchone()
    return bool(row and row["expires_at"] > to_iso(now) and hmac.compare_digest(row["pw_fp"], password_fingerprint()))


def is_signed_in(request: Request, conn: sqlite3.Connection) -> bool:
    return _valid_session(conn, request.cookies.get(COOKIE), clock.now())


def require_admin(request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> None:
    """Dependency for every admin route."""
    if not is_signed_in(request, conn):
        raise BookingError("unauthorized", "Please sign in again.", status_code=401)
    if request.method not in _SAFE_METHODS and request.headers.get(CSRF_HEADER) != "1":
        raise BookingError("forbidden", "Request blocked.", status_code=403)


def failed_attempt_pause() -> None:
    """A short stall per wrong password makes online guessing painfully slow."""
    time.sleep(0.6)


if __name__ == "__main__":
    first = getpass.getpass("New admin password: ")
    if len(first) < 10:
        raise SystemExit("Use at least 10 characters.")
    if first != getpass.getpass("Repeat it: "):
        raise SystemExit("Those don't match.")
    print("\nSet this in your environment (Render > Environment, or backend/.env):\n")
    print(f"ADMIN_PASSWORD_HASH={hash_password(first)}")
