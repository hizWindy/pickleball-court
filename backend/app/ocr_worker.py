"""One-shot receipt reader, run as `python -m app.ocr_worker` by app/ocr.py.

Reads one image from stdin, prints one JSON document on stdout, exits. The engine (RapidOCR on ONNX Runtime) needs about
340 MB just to load, so it lives and dies in this short-lived process: the web server stays small between receipts, and
if a receipt ever runs the box out of memory only this process is killed, not the site.
"""

from __future__ import annotations

import json
import sys
import types


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


def rows(boxes, texts, scores) -> list[dict]:
    """Group the engine's word boxes into visual rows, so 'Sent to' and 'JUAN DELA CRUZ' land on one line."""
    items = []
    for box, text, score in zip(boxes, texts, scores):
        ys = [float(p[1]) for p in box]
        xs = [float(p[0]) for p in box]
        items.append((min(ys), max(ys) - min(ys), min(xs), str(text).strip(), float(score)))
    items.sort(key=lambda i: (i[0], i[2]))

    grouped: list[list[tuple]] = []
    for item in items:
        top, height = item[0], item[1]
        if grouped:
            last = grouped[-1]
            row_top = min(i[0] for i in last)
            row_h = max(i[1] for i in last)
            if abs(top - row_top) < 0.6 * max(height, row_h):  # same baseline
                last.append(item)
                continue
        grouped.append([item])

    lines = []
    for row in grouped:
        row.sort(key=lambda i: i[2])
        text = "  ".join(i[3] for i in row if i[3])
        if text:
            lines.append(
                {"text": text, "top": min(i[0] for i in row), "height": max(i[1] for i in row), "score": min(i[4] for i in row)}
            )
    return lines


def main() -> int:
    data = sys.stdin.buffer.read()
    out = sys.stdout.buffer
    sys.stdout = sys.stderr  # anything a library prints must not corrupt the JSON on the real stdout

    _shapely_fallback()
    from rapidocr import RapidOCR

    # No angle classifier: it only rights upside-down text lines, which a screenshot never has, and skipping it
    # saves about a third of the time with identical results on GCash / GoTyme receipts.
    engine = RapidOCR(params={"Global.log_level": "error", "Global.use_cls": False})
    result = engine(data)
    if not result or result.txts is None or result.boxes is None:
        lines: list[dict] = []
    else:
        lines = rows(result.boxes, result.txts, result.scores)
    out.write(json.dumps({"lines": lines}).encode("utf-8"))
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
