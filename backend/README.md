# HousePickle Club — Booking API

FastAPI + SQLite backend for court booking with manual GCash / GoTyme payment verification.

## Run it

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # optional; every setting has a default
uvicorn app.main:app --reload --port 8000
```

Then run the frontend (`npm run dev` in the repo root). Vite proxies `/api` to port 8000.

Tests: `pytest` (they use a throwaway database and a fake clock).

## Booking rules (what the code enforces)

| Rule | Where |
|---|---|
| A slot is **held for 15 minutes** from "Confirm & hold". The deadline is stored in the database; the phone only shows a countdown to it. | `booking_service.create_booking` |
| While held, nobody else can book it. Double booking is impossible: one row per court-hour with a primary key. | `booking_slots` table |
| No proof within 15 min (+30 s grace) → booking **expires** and the slot is released. Runs on every request and every 30 s in the background. | `release_expired`, `main._sweep_forever` |
| Proof = **receipt screenshot** (main path) or **typed reference + payment time + payer name** (fallback). | `submit_receipt`, `submit_reference` |
| The same receipt image or reference number can never back two bookings, even after deletion or rejection. | unique indexes on `receipt_sha256`, `reference_number` |
| A typed payment time must fall inside the hold window (±5 min). | `_resolve_paid_time` |
| A typed all-digit GCash reference must be 13 digits. Other references (GoTyme `GT…`, banks paying the InstaPay QR) are only sanity-checked. | `validation.normalize_reference` |
| Proof **confirms the booking at once**. A receipt image is read on our server (amount, reference, date, recipient); anything that doesn't fit the booking becomes a review flag, and the host can still reject it. | `submit_receipt`, `receipt_reader.assess` |
| One payment can never confirm two bookings: the same image (hash) or the same reference number, whether typed or read off a different screenshot. | `submit_receipt`, `uq_bookings_reference` |
| The player can cancel while held or pending; the slot is freed immediately. | `cancel` |
| One active hold per mobile number, two per IP. Rate limits on create and proof. The player's IP is stored only while the booking is `held`, then erased. | `create_booking`, `ratelimit.py` |
| Each hour is priced by its own rate (₱250 standard, ₱200 from 10 PM to 6 AM), plus ₱80 for paddles. Totals are computed on the server only. | `slots.price_hours` |
| 12 AM–5 AM belong to the previous night's "play day". All times are Manila time. | `slots.py` |
| Consent is required, versioned and timestamped per booking. Receipt images are deleted 7 days after the host decides (14 days at most if nobody ever reviews them); the hash is kept. | `CONSENT_VERSION`, `purge_old_receipts` |

Status flow: `held → confirmed` (on proof), then possibly `rejected` by the host; plus `expired` and `cancelled`.
`pending_verification` only remains on bookings made before automatic confirmation.

## Reading receipts (OCR)

`app/ocr.py` runs [RapidOCR](https://github.com/RapidAI/RapidOCR) (PaddleOCR models on ONNX Runtime) on our own server:
no image leaves it, the ~30 MB of models ship inside the pip package, and a phone screenshot takes about 1-3 s.
`app/receipt_reader.py` turns the text into fields by their labels, so it handles GCash, GoTyme and most bank receipts:

| Field | Labels it looks for |
|---|---|
| Amount | Total Amount Sent, Total amount, Amount sent, Amount, else the first `PHP` / `₱` amount |
| Reference | Ref No., Reference number, Reference ID, Transaction ID; GCash's 13 digits as a fallback |
| Paid at | `Oct 06, 2026 8:47 PM`, `07 Oct 2026, 10:22 PM`, `2026-10-07 22:22`, `10/07/2026 10:22 PM` |
| Recipient | Sent to / Recipient + Account number, or GCash's masked name and mobile at the top |

Flags (`review_flags`): `unreadable`, `not_successful`, `amount_missing`, `amount_mismatch`, `reference_missing`,
`time_missing`, `time_outside` (outside the hold ± `PAID_TIME_TOLERANCE_MINUTES`), `recipient_mismatch` (last 4 digits
or name don't match the club's GCash / GoTyme account), `recipient_missing`, and `typed_reference` for typed-in proof.
Results are stored in `receipt_scans`; the raw text is erased together with the image.

OCR never blocks a booking. If the engine is missing or fails, the booking is still confirmed and flagged `unreadable`.
Turn it off with `OCR_ENABLED=0`. On slim Linux images opencv needs `apt-get install -y libgl1 libglib2.0-0`.
GoTyme doesn't publish its receipt layout, so the GoTyme rules were written from the sample in this repo's tests;
check the first real GoTyme receipts in the desk.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | Courts, rates, payment accounts, hold minutes, today's play date |
| GET | `/api/availability?date=YYYY-MM-DD` | Per hour and court: `available`, `held`, `booked` or `past` |
| POST | `/api/bookings` | Creates the hold; returns the booking and an `accessToken` |
| GET | `/api/bookings/{code}` | Header `X-Booking-Token` |
| POST | `/api/bookings/{code}/receipt` | multipart field `receipt` (JPG, PNG, WebP or HEIC, max 8 MB) |
| POST | `/api/bookings/{code}/reference` | `{referenceNumber, paidTime: "HH:MM", payerName}` |
| POST | `/api/bookings/{code}/cancel` | |

Errors are always `{"error": {"code", "message"}}`, with a message that is safe to show to players.

## Admin desk

The host's desk lives at `/admin` (a code-split part of the same app; players never download it) and talks to `/api/admin/*`.
It has an overview with sales analytics, a bookings list with search and filters, a day schedule, a payment-review sheet
(receipt image, what to match in GCash/GoTyme, Confirm / Reject), and full create / edit / cancel / restore / delete,
including walk-ins, custom prices and blocking a court.

**Turn it on.** With no password configured nobody can sign in.

```bash
python -m app.admin_auth          # prompts twice, prints ADMIN_PASSWORD_HASH=...
```

Put the printed line in `backend/.env` (or Render's Environment tab). Use 12+ characters. `ADMIN_PASSWORD` (plain text) also works
for quick local tests, but the hash is better. Changing the password signs every device out.

**How it is protected** (hiding the "Staff" link is only a courtesy):

| Layer | Detail |
|---|---|
| Password | scrypt hash, constant-time compare, ~0.6 s pause after a wrong guess |
| Rate limits | 8 sign-in attempts per IP per 15 min, 200 per hour across everyone |
| Session | random secret in an **HttpOnly, SameSite=Strict** cookie scoped to `/api/admin` (and `Secure` over HTTPS); only its hash is stored; expires after `ADMIN_SESSION_HOURS` (default 168) |
| CSRF | every write also needs the header `X-HP-Admin: 1`, which a forged cross-site form can't send |
| Receipts | served only through `/api/admin/bookings/{code}/receipt`, `Cache-Control: no-store`, path-checked |
| Search engines | `X-Robots-Tag: noindex` and a `noindex` meta tag |

Behind a proxy (Render), start uvicorn with `--proxy-headers --forwarded-allow-ips="*"` so the per-IP limits see real client addresses.

| Method | Path | Notes |
|---|---|---|
| GET / POST | `/api/admin/session`, `/login`, `/logout` | sign-in state |
| GET | `/api/admin/counts` | `{pending, held}` for the badge |
| GET | `/api/admin/overview?days=30` | KPIs, daily revenue, busiest hours, weekday, court / method / rate splits, outcomes, up next, regulars |
| GET | `/api/admin/schedule?date=` | bookings on a play day |
| GET / POST | `/api/admin/bookings` | list (`q`, `status`, `dateFrom`, `dateTo`, `courtId`, `sort`, `page`, `pageSize`) / add walk-in or block |
| GET / PATCH / DELETE | `/api/admin/bookings/{code}` | detail with history / edit (reschedule is clash-checked) / delete for good |
| POST | `/api/admin/bookings/{code}/check` | "Looks good": marks an automatically confirmed payment as looked at |
| POST | `/api/admin/bookings/{code}/confirm` \| `reject` \| `cancel` | confirm also restores a rejected / expired / cancelled booking if its hours are still free; reject works on online payments, even after automatic confirmation |
| GET | `/api/admin/bookings/{code}/receipt` | the image, if still stored |

Every admin change is written to `admin_events`, which survives deleting the booking.

## Data & deployment

- Everything lives in `DATA_DIR` (default `backend/data/`): `housepickle.db` plus `receipts/`. Put it on a persistent disk and back it up. Serverless hosts won't work.
- Receipts are never served publicly. Only the signed-in admin can open them.
- Production: `npm run build` in `frontend/`, then `uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*"`. The API serves the built PWA from the same origin, so no CORS setup is needed. Put it behind HTTPS, which PWAs and the clipboard require.
- Payment methods: each needs an account number or a QR image to be offered, otherwise it shows "Coming soon". The QR images live in `frontend/public/images/` (`payment-qr-gcash.jpg`, `payment-qr-gotyme.jpg`) and can be swapped via `GCASH_QR_IMAGE` / `GOTYME_QR_IMAGE`. GoTyme shows `GOTYME_ACCOUNT_HINT` (last digits only) because the full account number was never shared.
