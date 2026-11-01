"""Small in-process sliding-window limiter. Enough for a single-server deployment."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.errors import TooMany

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)
_strikes: dict[str, deque[float]] = defaultdict(deque)


def client_ip(request: Request) -> str:
    # Behind a reverse proxy, run uvicorn with --proxy-headers so this is the real client.
    return request.client.host if request.client else "unknown"


def limit(request: Request, bucket: str, max_hits: int, window_seconds: int, per_ip: bool = True) -> None:
    """Count one hit. `per_ip=False` shares a single budget across everyone (used to cap sign-in guessing overall)."""
    key = f"{bucket}:{client_ip(request)}" if per_ip else bucket
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        while q and q[0] <= now - window_seconds:
            q.popleft()
        if len(q) >= max_hits:
            raise TooMany("rate_limited", "Too many attempts. Please wait a few minutes and try again.")
        q.append(now)


def struck_out(key: str, max_strikes: int, window_seconds: int) -> bool:
    """Has this key used up its allowed turned-away tries within the window? (Reading never adds one.)"""
    now = time.monotonic()
    with _lock:
        q = _strikes.get(key)
        if q is None:
            return False
        while q and q[0] <= now - window_seconds:
            q.popleft()
        if not q:
            del _strikes[key]
            return False
        return len(q) >= max_strikes


def add_strike(key: str, window_seconds: int) -> None:
    now = time.monotonic()
    with _lock:
        q = _strikes[key]
        while q and q[0] <= now - window_seconds:
            q.popleft()
        q.append(now)


def reset() -> None:
    with _lock:
        _hits.clear()
        _strikes.clear()
