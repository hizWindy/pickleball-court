# Brand files

How `frontend/public/brand/` and `frontend/public/images/payment-qr-maribank.jpg` were made, so they can be made again.
They need OpenCV and NumPy, which the backend's virtual environment already has (for receipt reading).

## The logo

There was no vector file, only `logo-source.jpg` (2000 × 2000 px, the owner's logo on cream). It was traced:

```powershell
cd tools\brand
..\..\backend\.venv\Scripts\python -I vectorize_logo.py logo-source.jpg out
..\..\backend\.venv\Scripts\python -I build_brand.py out\geometry.json ..\..\frontend\public\brand
```

- `vectorize_logo.py` splits the image into its navy (`#112D43`) and lime (`#91B843`) shapes. The two halves of the house
  become straight-edged polygons, the ball a circle with elliptical holes, and the lettering is traced at 4× for smooth
  edges. The small navy dash below and left of "CLUB" is left out (plan D7: it looks like a mistake).
- `build_brand.py` writes the SVGs (`logo-stacked`, `emblem`, both also `-on-dark` with the navy in cream, and
  `favicon.svg`) and draws the PNG icons from the same shapes: `apple-touch-icon.png` (180, on cream: iPhones show
  transparency as black), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (the emblem inside the middle 80%
  circle, so Android's round and rounded-square masks never cut it) and `favicon-32.png`. It also writes two big
  previews next to `geometry.json`, to compare with the original by eye.

When a designer's vector file arrives, use it instead and keep the same file names and colours.

## The MariBank QR

`crop_qr.py <screenshot.jpg> <out.jpg>` cuts the QR out of the MariBank app's screenshot and frames it like the GCash and
GoTyme images (720 × 720, the code on 78% of a white square), leaving out the logo, the name, the referral offer and the
app-store badges. It stops if the crop doesn't scan to exactly the same payment details as the screenshot. (The
screenshot isn't kept here: it shows the owner's referral code.)
