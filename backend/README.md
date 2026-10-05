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
| GCash references must be 13 digits. GoTyme's format is only loosely checked. | `validation.normalize_reference` |
| After proof: `pending_verification`. The slot stays reserved until the host confirms or rejects it (admin, coming next). | |
| The player can cancel while held or pending; the slot is freed immediately. | `cancel` |
| One active hold per mobile number, two per IP. Rate limits on create and proof. | `create_booking`, `ratelimit.py` |
| Each hour is priced by its own rate (₱250 standard, ₱200 from 10 PM to 6 AM), plus ₱80 for paddles. Totals are computed on the server only. | `slots.price_hours` |
| 12 AM–5 AM belong to the previous night's "play day". All times are Manila time. | `slots.py` |
| Consent is required, versioned and timestamped per booking. Receipt images are deleted after 90 days (the hash is kept). | `CONSENT_VERSION`, `purge_old_receipts` |

Status flow: `held → pending_verification → confirmed | rejected`, plus `expired` and `cancelled`.

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

## Data & deployment

- Everything lives in `DATA_DIR` (default `backend/data/`): `housepickle.db` plus `receipts/`. Put it on a persistent disk and back it up. Serverless hosts won't work.
- Receipts are never served publicly. Only the upcoming admin will see them.
- Production: `npm run build` in `frontend/`, then `uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers`. The API serves the built PWA from the same origin, so no CORS setup is needed. Put it behind HTTPS, which PWAs and the clipboard require.
- Set `GOTYME_ACCOUNT_NUMBER` in `.env` to switch on GoTyme. Until then it shows as "Coming soon".
