"""Reads the text off a receipt screenshot, on our own server (no image ever leaves it).

Uses RapidOCR (PaddleOCR models on ONNX Runtime): about 30 MB of models shipped inside the
pip package, no system install, roughly 1-3 s per screenshot on a small CPU.

The engine itself runs in a short-lived child process (app/ocr_worker.py) for every receipt. Loading it costs about
340 MB, which a 512 MB server can't spare around the clock; this way the site idles small, a receipt borrows the
memory for a few seconds and gives it back, and an out-of-memory kill takes down the child, not the site.

OCR is a helper, never a gate: if the engine is missing, disabled or fails, `read_lines`
returns None and the booking still goes through, flagged for the host to look at.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import subprocess
import sys
import threading
from dataclasses import dataclass

from app.config import BASE_DIR, settings

log = logging.getLogger("housepickle.ocr")

_lock = threading.Lock()  # one image at a time keeps memory flat on a 512 MB server


@dataclass(frozen=True)
class Line:
    """One row of text as it appears on the receipt, left to right."""

    text: str
    top: float
    height: float
    score: float


def available() -> bool:
    """OCR is on and the engine is installed (checked without loading it)."""
    return settings.ocr_enabled and importlib.util.find_spec("rapidocr") is not None


def read_lines(image: bytes) -> list[Line] | None:
    """Text rows of the image, top to bottom. None if OCR is off, unavailable or failed."""
    if not settings.ocr_enabled:
        return None
    try:
        with _lock:
            done = subprocess.run(
                [sys.executable, "-m", "app.ocr_worker"],
                input=image,
                capture_output=True,
                cwd=BASE_DIR,
                timeout=settings.ocr_timeout_seconds,
            )
    except subprocess.TimeoutExpired:
        log.error("OCR took longer than %s s and was stopped; the receipt will be flagged", settings.ocr_timeout_seconds)
        return None
    except OSError:
        log.exception("OCR could not be started; receipts will be flagged for a manual look")
        return None

    if done.returncode != 0:  # includes -9 / 137 when the box killed it for memory
        log.error(
            "OCR worker failed (exit %s); the receipt will be flagged. %s",
            done.returncode, done.stderr.decode("utf-8", "replace")[-600:].strip(),
        )
        return None
    try:
        rows = json.loads(done.stdout)["lines"]
        return [Line(text=r["text"], top=r["top"], height=r["height"], score=r["score"]) for r in rows]
    except (ValueError, KeyError, TypeError):
        log.exception("OCR worker returned something unreadable")
        return None
