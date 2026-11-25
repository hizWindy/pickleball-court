"""Crop the MariBank screenshot to its QR, like the GCash and GoTyme images (720x720, QR with a white margin), and prove
the crop still scans to exactly the same payment details.

Usage: python -I crop_qr.py <screenshot.jpg> <out.jpg>
"""
import sys

import cv2
import numpy as np

src, out = sys.argv[1], sys.argv[2]
img = cv2.imread(src)
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def decode(image):
    detector = cv2.QRCodeDetector()
    text, points, _ = detector.detectAndDecode(image)
    return text, points


def tlv(payload):
    """EMVCo QR (QR Ph) fields: two-digit tag, two-digit length, value."""
    fields, i = {}, 0
    while i + 4 <= len(payload):
        tag, n = payload[i:i + 2], int(payload[i + 2:i + 4])
        fields[tag] = payload[i + 4:i + 4 + n]
        i += 4 + n
    return fields


original, points = decode(img)
assert original, "the original screenshot did not scan"

# Where the detector found the code; then snap to the outermost dark modules inside that box (the detector's corners
# can be a pixel or two off).
px, py = points[0][:, 0], points[0][:, 1]
bx0, bx1, by0, by1 = int(px.min()) - 8, int(px.max()) + 8, int(py.min()) - 8, int(py.max()) + 8
ys, xs = np.nonzero(gray[by0:by1, bx0:bx1] < 128)
x0, x1, y0, y1 = bx0 + xs.min(), bx0 + xs.max() + 1, by0 + ys.min(), by0 + ys.max() + 1
print("QR found at", (int(x0), int(y0)), "size", int(x1 - x0), "x", int(y1 - y0))
qr = img[y0:y1, x0:x1]

# Same framing as the GCash and GoTyme images: the code takes 78% of a white square (its quiet zone all round).
side = int(round(max(x1 - x0, y1 - y0) / 0.78))
canvas = np.full((side, side, 3), 255, np.uint8)
ox, oy = (side - (x1 - x0)) // 2, (side - (y1 - y0)) // 2
canvas[oy:oy + (y1 - y0), ox:ox + (x1 - x0)] = qr
final = cv2.resize(canvas, (720, 720), interpolation=cv2.INTER_AREA)
cv2.imwrite(out, final, [cv2.IMWRITE_JPEG_QUALITY, 95])

cropped, _ = decode(cv2.imread(out))
assert cropped == original, "the cropped QR scans differently"
f = tlv(original)
print("scans the same as the screenshot:", cropped == original)
print("payload format:", f.get("00"), "| point of initiation:", f.get("01"), "| currency:", f.get("53"), "| country:", f.get("58"))
print("merchant name (tag 59):", f.get("59"), "| city (60):", f.get("60"))
print("amount in the QR (54):", f.get("54", "none: the player types it"))
