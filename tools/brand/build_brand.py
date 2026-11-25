"""Build the brand files from the traced geometry.

Usage: python -I build_brand.py <geometry.json> <out_dir>

SVG: logo-stacked.svg, logo-stacked-on-dark.svg, emblem.svg, emblem-on-dark.svg, favicon.svg
PNG: apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png, favicon-32.png
"""
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

NAVY, LIME, CREAM = "#112D43", "#91B843", "#FBF7EC"
BASELINE = 1202.5  # the house halves and the ball all stand on it

geometry = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)


# ── Tidy the trace: walls exactly upright, everything on one baseline ─────────
def snap(shapes):
    for s in shapes:
        if s["kind"] == "ball":
            cx, cy, r = s["circle"]
            rx, ry = s["axes"]
            s["ellipse"] = [cx, BASELINE - ry, rx, ry]  # it sits on the baseline
            dy = (BASELINE - ry) - cy
            s["holes"] = [[hx, hy + dy, a, b, ang] for hx, hy, a, b, ang in s["holes"]]
        elif s["part"] == "house":
            pts = s["rings"][0]
            for p in pts:
                if abs(p[1] - BASELINE) < 2:
                    p[1] = BASELINE
            # Upright walls: two points sharing (almost) one x become exactly upright.
            for i, p in enumerate(pts):
                q = pts[(i + 1) % len(pts)]
                if abs(p[0] - q[0]) < 2 and abs(p[1] - q[1]) > 100:
                    p[0] = q[0] = round((p[0] + q[0]) / 2, 2)
    return shapes


navy, lime = snap(geometry["navy"]), snap(geometry["lime"])
emblem_navy = [s for s in navy if s.get("part") == "house"]
emblem_lime = [s for s in lime if s["kind"] == "ball" or s.get("part") == "house"]


def bbox(shapes):
    xs, ys = [], []
    for s in shapes:
        if s["kind"] == "ball":
            cx, cy, rx, ry = s["ellipse"]
            xs += [cx - rx, cx + rx]
            ys += [cy - ry, cy + ry]
        else:
            for p in s["rings"][0]:
                xs.append(p[0])
                ys.append(p[1])
    return min(xs), min(ys), max(xs), max(ys)


# ── SVG ───────────────────────────────────────────────────────────────────────
def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def ellipse_d(cx, cy, a, b, ang):
    t = math.radians(ang)
    x1, y1 = cx + a * math.cos(t), cy + a * math.sin(t)
    x2, y2 = cx - a * math.cos(t), cy - a * math.sin(t)
    return f"M{f(x1)} {f(y1)}A{f(a)} {f(b)} {f(ang)} 1 0 {f(x2)} {f(y2)}A{f(a)} {f(b)} {f(ang)} 1 0 {f(x1)} {f(y1)}Z"


def path_d(shape):
    if shape["kind"] == "ball":
        cx, cy, rx, ry = shape["ellipse"]
        return ellipse_d(cx, cy, rx, ry, 0) + "".join(ellipse_d(*h) for h in shape["holes"])
    return "".join("M" + "L".join(f"{f(x)} {f(y)}" for x, y in ring) + "Z" for ring in shape["rings"])


def svg(layers, box, title, background=None, radius=0):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(x0)} {f(y0)} {f(w)} {f(h)}" role="img" aria-label="{title}">',
             f"<title>{title}</title>"]
    if background:
        parts.append(f'<rect x="{f(x0)}" y="{f(y0)}" width="{f(w)}" height="{f(h)}" rx="{f(radius)}" fill="{background}"/>')
    for colour, shapes in layers:
        if shapes:
            parts.append(f'<path fill="{colour}" fill-rule="evenodd" d="{"".join(path_d(s) for s in shapes)}"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def pad_box(box, margin):
    x0, y0, x1, y1 = box
    return x0 - margin, y0 - margin, x1 + margin, y1 + margin


def square_box(box, fill):
    """A square around `box` in which the box takes `fill` of the side, centred."""
    x0, y0, x1, y1 = box
    side = max(x1 - x0, y1 - y0) / fill
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2


logo_box = pad_box(bbox(navy + lime), 40)
emblem_box = pad_box(bbox(emblem_navy + emblem_lime), 12)
files = {
    "logo-stacked.svg": svg([(NAVY, navy), (LIME, lime)], logo_box, "House Pickle Club"),
    "logo-stacked-on-dark.svg": svg([(CREAM, navy), (LIME, lime)], logo_box, "House Pickle Club"),
    "emblem.svg": svg([(NAVY, emblem_navy), (LIME, emblem_lime)], emblem_box, "House Pickle Club"),
    "emblem-on-dark.svg": svg([(CREAM, emblem_navy), (LIME, emblem_lime)], emblem_box, "House Pickle Club"),
}
fav_box = square_box(bbox(emblem_navy + emblem_lime), 0.78)
files["favicon.svg"] = svg([(NAVY, emblem_navy), (LIME, emblem_lime)], fav_box, "House Pickle Club", background=CREAM,
                           radius=(fav_box[2] - fav_box[0]) * 0.22)
for name, text in files.items():
    (out / name).write_text(text, encoding="utf-8")
    print(f"{name}: {len(text.encode()) / 1024:.1f} KB")


# ── PNG (drawn from the same shapes, 8x supersampled) ─────────────────────────
def rgb(hex_rgb):
    return tuple(int(hex_rgb[i:i + 2], 16) for i in (1, 3, 5))


def render(size, layers, box, background, radius=0.0, ss=8):
    big = size * ss
    x0, y0, x1, y1 = box
    k = big / (x1 - x0)
    canvas = np.zeros((big, big, 4), np.float32)
    if background:
        bg_mask = np.zeros((big, big), np.uint8)
        r = int(radius * k)
        if r:
            cv2.rectangle(bg_mask, (r, 0), (big - r, big), 255, -1)
            cv2.rectangle(bg_mask, (0, r), (big, big - r), 255, -1)
            for cx, cy in ((r, r), (big - r, r), (r, big - r), (big - r, big - r)):
                cv2.circle(bg_mask, (cx, cy), r, 255, -1)
        else:
            bg_mask[:] = 255
        a = bg_mask.astype(np.float32) / 255
        canvas[..., :3] = np.array(rgb(background), np.float32) * a[..., None]
        canvas[..., 3] = a
    for colour, shapes in layers:
        mask = np.zeros((big, big), np.uint8)
        for s in shapes:
            if s["kind"] == "ball":
                cx, cy, rx, ry = s["ellipse"]
                polys = [cv2.ellipse2Poly((int((cx - x0) * k), int((cy - y0) * k)), (int(rx * k), int(ry * k)), 0, 0, 360, 1)]
                for hx, hy, a, b, ang in s["holes"]:
                    polys.append(cv2.ellipse2Poly((int((hx - x0) * k), int((hy - y0) * k)), (int(a * k), int(b * k)), int(round(ang)), 0, 360, 1))
            else:
                polys = [np.array([[(x - x0) * k, (y - y0) * k] for x, y in ring], np.int32) for ring in s["rings"]]
            cv2.fillPoly(mask, polys, 255)  # holes inside the outline stay empty
        a = mask.astype(np.float32)[..., None] / 255
        canvas[..., :3] = canvas[..., :3] * (1 - a) + np.array(rgb(colour), np.float32) * a
        canvas[..., 3:] = canvas[..., 3:] * (1 - a) + a
    small = cv2.resize(canvas, (size, size), interpolation=cv2.INTER_AREA)
    rgba = np.clip(np.round(small), 0, 255)
    rgba[..., 3] = np.clip(np.round(small[..., 3] * 255), 0, 255)
    # premultiplied -> straight colour where partly transparent
    alpha = small[..., 3:4]
    rgba[..., :3] = np.where(alpha > 0, np.clip(np.round(small[..., :3] / np.maximum(alpha, 1e-6)), 0, 255), 0)
    return cv2.cvtColor(rgba.astype(np.uint8), cv2.COLOR_RGBA2BGRA)


emblem_layers = [(NAVY, emblem_navy), (LIME, emblem_lime)]
emblem_bbox = bbox(emblem_navy + emblem_lime)
diag = math.dist(emblem_bbox[:2], emblem_bbox[2:])
side = max(emblem_bbox[2] - emblem_bbox[0], emblem_bbox[3] - emblem_bbox[1])
icons = {
    # iPhone shows transparent parts as black, and rounds the corners itself: full square, cream.
    "apple-touch-icon.png": (180, square_box(emblem_bbox, 0.78), CREAM, 0),
    "icon-192.png": (192, square_box(emblem_bbox, 0.80), CREAM, 0),
    "icon-512.png": (512, square_box(emblem_bbox, 0.80), CREAM, 0),
    # Android crops maskable icons to a circle or a rounded square: the emblem stays inside the middle 80% circle.
    "icon-maskable-512.png": (512, square_box(emblem_bbox, side / diag * 0.80 * 0.94), CREAM, 0),
    "favicon-32.png": (32, fav_box, CREAM, (fav_box[2] - fav_box[0]) * 0.22),
}
for name, (size, box, background, radius) in icons.items():
    cv2.imwrite(str(out / name), render(size, emblem_layers, box, background, radius))
    print(f"{name}: {size}x{size}, {(out / name).stat().st_size / 1024:.1f} KB")

# A big preview of the shapes, to compare with the original by eye. Written next to geometry.json, not into the site.
previews = Path(sys.argv[1]).parent
cv2.imwrite(str(previews / "preview-logo.png"), render(1000, [(NAVY, navy), (LIME, lime)], square_box(bbox(navy + lime), 0.94), CREAM))
cv2.imwrite(str(previews / "preview-logo-on-dark.png"), render(1000, [(CREAM, navy), (LIME, lime)], square_box(bbox(navy + lime), 0.94), "#0B0F17"))
