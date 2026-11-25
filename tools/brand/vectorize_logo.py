"""Trace the House Pickle Club logo (a 2000x2000 JPG) into vector shapes.

Usage: python -I vectorize_logo.py <logo.jpg> <out_dir>

Writes <out_dir>/geometry.json: for each colour, a list of shapes in the JPG's pixel coordinates:
  {"kind": "polygon", "rings": [[[x, y], ...], ...]}           (first ring the outline, the rest holes)
  {"kind": "ball", "circle": [cx, cy, r], "holes": [[cx, cy, a, b, angle_deg], ...]}
The house halves are straight-edged polygons; the ball is a circle with elliptical holes; the lettering and dashes are
traced at 4x for smooth edges. The small navy dash below-left of "CLUB" is left out (plan D7).
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

SCALE = 4  # trace the lettering at 4x
EMBLEM_BOTTOM = 1250  # everything above this line (in JPG pixels) is the emblem

src, out = Path(sys.argv[1]), Path(sys.argv[2])
img = cv2.imread(str(src))
lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)


def lab_of(hex_rgb):
    r, g, b = (int(hex_rgb[i:i + 2], 16) for i in (1, 3, 5))
    return cv2.cvtColor(np.uint8([[[b, g, r]]]), cv2.COLOR_BGR2LAB).astype(np.float32)[0, 0]


CREAM, COLOURS = lab_of("#FBF7EC"), {"navy": lab_of("#112D43"), "lime": lab_of("#91B843")}
names = ["cream", *COLOURS]
nearest = np.argmin(np.stack([np.linalg.norm(lab - c, axis=2) for c in (CREAM, *COLOURS.values())]), axis=0)


def membership(colour):
    """0 (cream) .. 1 (the colour), projected along the line between the two: soft edges, sub-pixel accurate."""
    target = COLOURS[colour]
    axis = target - CREAM
    return np.clip(((lab - CREAM) @ axis) / (axis @ axis), 0, 1)


def components(colour):
    mask = (nearest == names.index(colour)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab_img, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    return [(j, stats[j]) for j in range(1, n) if stats[j][4] > 30], lab_img


def ring(contour, eps):
    pts = cv2.approxPolyDP(contour, eps, True).reshape(-1, 2).astype(float) / SCALE
    return [[round(x, 2), round(y, 2)] for x, y in pts]


geometry = {}
for colour in COLOURS:
    comps, lab_img = components(colour)
    soft = membership(colour)
    shapes = []
    for j, (x, y, w, h, area) in comps:
        if colour == "navy" and h < 20 and y > 1850:
            print("left out: the stray navy dash at", (int(x), int(y), int(w), int(h)))
            continue
        # This component only (a little room around it), traced at 4x from the soft edges.
        pad = 6
        x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), x + w + pad, y + h + pad
        region = cv2.dilate((lab_img[y0:y1, x0:x1] == j).astype(np.uint8), np.ones((5, 5), np.uint8))
        local = soft[y0:y1, x0:x1] * region
        big = cv2.resize(local, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC)
        binary = (big >= 0.5).astype(np.uint8)
        contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        hierarchy = hierarchy[0]
        offset = np.array([x0 * SCALE, y0 * SCALE])
        outers = [i for i, hrc in enumerate(hierarchy) if hrc[3] == -1 and cv2.contourArea(contours[i]) > 50 * SCALE * SCALE]
        for oi in outers:
            outer = contours[oi] + offset
            holes = [contours[i] + offset for i, hrc in enumerate(hierarchy) if hrc[3] == oi and cv2.contourArea(contours[i]) > 4 * SCALE * SCALE]
            emblem = y < EMBLEM_BOTTOM
            if emblem and colour == "lime" and len(holes) >= 5:  # the ball: a circle with elliptical holes
                (cx, cy), (aw, ah), _ = cv2.fitEllipse(outer)
                r = (aw + ah) / 4 / SCALE
                fitted = []
                for hc in holes:
                    (hx, hy), (hw, hh), ang = cv2.fitEllipse(hc)
                    fitted.append([round(hx / SCALE, 2), round(hy / SCALE, 2), round(hw / 2 / SCALE, 2), round(hh / 2 / SCALE, 2), round(ang, 1)])
                shapes.append({"kind": "ball", "circle": [round(cx / SCALE, 2), round(cy / SCALE, 2), round(r, 2)], "holes": fitted,
                               "axes": [round(aw / 2 / SCALE, 1), round(ah / 2 / SCALE, 1)]})
            elif emblem:  # a half of the house: straight edges, sharp corners
                shapes.append({"kind": "polygon", "part": "house", "rings": [ring(outer, 2.5 * SCALE)] + [ring(hc, 2.5 * SCALE) for hc in holes]})
            else:  # lettering and dashes
                shapes.append({"kind": "polygon", "part": "text", "rings": [ring(outer, 0.45 * SCALE)] + [ring(hc, 0.45 * SCALE) for hc in holes]})
    geometry[colour] = shapes

out.mkdir(parents=True, exist_ok=True)
(out / "geometry.json").write_text(json.dumps(geometry), encoding="utf-8")
for colour, shapes in geometry.items():
    for s in shapes:
        if s["kind"] == "ball":
            print(colour, "ball", s["circle"], "axes", s["axes"], "holes", len(s["holes"]))
        elif s["part"] == "house":
            print(colour, "house", s["rings"][0])
    text = [s for s in shapes if s.get("part") == "text"]
    print(colour, "text shapes:", len(text), "points:", sum(len(r) for s in text for r in s["rings"]))
