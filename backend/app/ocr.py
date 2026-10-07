"""Reads the text off a receipt screenshot, on our own server (no image ever leaves it).

Uses RapidOCR (PaddleOCR models on ONNX Runtime): about 30 MB of models shipped inside the
pip package, no system install, roughly 1-3 s per screenshot on a small CPU.

OCR is a helper, never a gate: if the engine is missing, disabled or fails, `read_lines`
returns None and the booking still goes through, flagged for the host to look at.
"""

from __future__ import annotations

import logging
import sys
import threading
import types
from dataclasses import dataclass

from app.config import settings

log = logging.getLogger("housepickle.ocr")

_engine = None
_engine_failed = False
_lock = threading.Lock()  # one image at a time keeps memory flat on a 512 MB server


@dataclass(frozen=True)
class Line:
    """One row of text as it appears on the receipt, left to right."""

    text: str
    top: float
    height: float
    score: float


def _shapely_fallback() -> None:
    """RapidOCR only needs a polygon's area and perimeter from Shapely. Some Windows PCs block
    Shapely's DLL (Smart App Control), so provide those two numbers in plain Python instead."""
    try:
        import shapely.geometry  # noqa: F401

        return
    except ImportError:
        pass

    class Polygon:
        def __init__(self, points):
            self._p = [(float(x), float(y)) for x, y in points]

        @property
        def area(self) -> float:
            p, n = self._p, len(self._p)
            return abs(sum(p[i][0] * p[(i + 1) % n][1] - p[(i + 1) % n][0] * p[i][1] for i in range(n))) / 2

        @property
        def length(self) -> float:
            p, n = self._p, len(self._p)
            return sum(((p[i][0] - p[(i + 1) % n][0]) ** 2 + (p[i][1] - p[(i + 1) % n][1]) ** 2) ** 0.5 for i in range(n))

    for name in [m for m in sys.modules if m == "shapely" or m.startswith("shapely.")]:
        del sys.modules[name]
    geometry = types.ModuleType("shapely.geometry")
    geometry.Polygon = Polygon
    shapely = types.ModuleType("shapely")
    shapely.geometry = geometry
    sys.modules["shapely"] = shapely
    sys.modules["shapely.geometry"] = geometry


def _get_engine():
    global _engine, _engine_failed
    if _engine is not None or _engine_failed:
        return _engine
    try:
        _shapely_fallback()
        from rapidocr import RapidOCR

        _engine = RapidOCR(params={"Global.log_level": "error"})
    except Exception:  # missing package, blocked DLL, bad model file...
        _engine_failed = True
        log.exception("receipt OCR is unavailable; receipts will be flagged for a manual look")
    return _engine


def available() -> bool:
    return settings.ocr_enabled and _get_engine() is not None


def _rows(boxes, texts, scores) -> list[Line]:
    """Group the engine's word boxes into visual rows, so 'Sent to' and 'JUAN DELA CRUZ' land on one line."""
    items = []
    for box, text, score in zip(boxes, texts, scores):
        ys = [float(p[1]) for p in box]
        xs = [float(p[0]) for p in box]
        items.append((min(ys), max(ys) - min(ys), min(xs), str(text).strip(), float(score)))
    items.sort(key=lambda i: (i[0], i[2]))

    rows: list[list[tuple]] = []
    for item in items:
        top, height = item[0], item[1]
        if rows:
            last = rows[-1]
            row_top = min(i[0] for i in last)
            row_h = max(i[1] for i in last)
            if abs(top - row_top) < 0.6 * max(height, row_h):  # same baseline
                last.append(item)
                continue
        rows.append([item])

    lines = []
    for row in rows:
        row.sort(key=lambda i: i[2])
        text = "  ".join(i[3] for i in row if i[3])
        if text:
            lines.append(Line(text=text, top=min(i[0] for i in row), height=max(i[1] for i in row), score=min(i[4] for i in row)))
    return lines


def read_lines(image: bytes) -> list[Line] | None:
    """Text rows of the image, top to bottom. None if OCR is off, unavailable or failed."""
    if not settings.ocr_enabled:
        return None
    engine = _get_engine()
    if engine is None:
        return None
    try:
        with _lock:
            result = engine(image)
    except Exception:
        log.exception("OCR failed on a receipt")
        return None
    if not result or result.txts is None or result.boxes is None:
        return []
    return _rows(result.boxes, result.txts, result.scores)
