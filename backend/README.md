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
| A slot is **held for 10 minutes** (`HOLD_MINUTES`) from "Confirm & hold". The deadline is stored in the database; the phone only shows a countdown to it. | `booking_service.create_booking` |
| While held, nobody else can book it. Double booking is impossible: one row per court-hour with a primary key. | `booking_slots` table |
| No proof in time (+10 s grace) → booking **expires** and the slot is released. Runs on every request and every 15 s in the background. | `release_expired`, `main._sweep_forever` |
| Proof = **receipt screenshot** (main path) or **typed reference + payment time + payer name** (fallback). | `submit_receipt`, `submit_reference` |
| The same receipt image or reference number can never back two bookings, even after deletion or rejection. | unique indexes on `receipt_sha256`, `reference_number` |
| A typed payment time must fall inside the hold window (±5 min). | `_resolve_paid_time` |
| A typed all-digit GCash reference must be 13 digits. Other references (GoTyme `GT…`, banks paying the InstaPay QR) are only sanity-checked. | `validation.normalize_reference` |
| Full payment **confirms the booking at once**. A receipt image is read on our server (amount, reference, date, recipient). **The amount is checked against the checkout total:** equal → confirmed; more → confirmed and flagged `amount_over`; **short, or no amount readable although the OCR worked → the slot stays reserved but the booking waits for the host** (`pending_verification`). Other mismatches are review flags the host can reject. If the OCR engine is unavailable, the booking is still confirmed and flagged `unreadable`. | `submit_receipt`, `receipt_reader.assess`, `HOLD_FOR_HOST` |
| One payment can never confirm two bookings: the same image (hash) or the same reference number, whether typed or read off a different screenshot. | `submit_receipt`, `uq_bookings_reference` |
| **No cancellations.** A paid booking is final (no refunds). A guest can only *release an unpaid hold*; anything else answers `409 bookings_final`. The host can still void a booking from the desk (mistakes, duplicates). | `release_hold` |
| **Late rule (15 min).** A paid booking whose group hasn't arrived `LATE_AFTER_MINUTES` after its start is **Late**: its court-hours are released automatically (status stays `confirmed`, `late_at` is set, no refund). "Arrived" is set by the host (Arrived button) or by the guest on their pass (opens 30 min before the start). Walk-ins added for a time that has begun, and blocks, are never late. | `release_late`, `check_in`, `admin_service.mark_arrived` |
| **Hidden restore window.** For `RESTORE_WINDOW_MINUTES` (5) after it went late the host (only) can **Restore** the booking if the hours are still free. Guests are never told; the public API doesn't expose it. After that, the host can still move the booking with Edit. | `admin_service.restore` |
| **Rescheduling by the guest**: once, at least 48 h before the start, same length, new date within 30 days of the original, never to a slot that costs more than was paid (cheaper is allowed, no refund). Proof of ownership = booking code + mobile number (or the device's token). | `reschedule.py` |
| **Rain delay** (host): gives the hours of paid bookings in a window back and sets `weather_hold_at`. The guest then picks a new time themselves (any time, free, doesn't use their one reschedule). The host can undo it with Restore. | `admin_service.rain_delay` |
| One active hold per mobile number, two per IP. Rate limits on create and proof. The player's IP is stored only while the booking is `held`, then erased. | `create_booking`, `ratelimit.py` |
| Each hour is priced by its own rate (₱250 standard, ₱200 from 10 PM to 6 AM), plus ₱80 for paddles. Totals are computed on the server only. | `slots.price_hours` |
| 12 AM–5 AM belong to the previous night's "play day". All times are Manila time. | `slots.py` |
| Consent is required, versioned and timestamped per booking. Receipt images are deleted 7 days after the host decides (14 days at most if nobody ever reviews them); the hash is kept. | `CONSENT_VERSION`, `purge_old_receipts` |

Status flow: `held → confirmed` (on full payment) | `pending_verification` (receipt short or amount unreadable: the host decides), then possibly `rejected` by the host; plus `expired` (hold ran out) and `cancelled` (released unpaid hold, or voided by the host).
`Late` and `rain delay` are not statuses: the booking stays `confirmed` and carries `late_at` / `weather_hold_at`.
The desk shows one **label** per booking, computed from those: **Paid · Late · Done · Rain delay** (plus Blocked, Paying now, Needs check, Rejected, Expired, Cancelled).

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

Flags (`review_flags`): `unreadable`, `not_successful`, `amount_missing`, `amount_short`, `amount_over`, `reference_missing`,
`time_missing`, `time_outside` (outside the hold ± `PAID_TIME_TOLERANCE_MINUTES`), `recipient_mismatch` (last 4 digits
or name don't match the club's GCash / GoTyme account), `recipient_missing`, and `typed_reference` for typed-in proof.
Results are stored in `receipt_scans`; the raw text is erased together with the image.

`amount_short` and `amount_missing` (the engine worked but found no amount, or no text at all) are the only flags that stop a
booking from confirming: it becomes `pending_verification`, keeps its slot, and waits for the host (who might have been
sent the balance, or can reject it). Everything else is a flag on a confirmed booking.
If the OCR engine itself is missing, off or crashes, the booking is still confirmed and flagged `unreadable`: our tooling
failing never punishes a guest. Turn it off with `OCR_ENABLED=0`. On slim Linux images opencv needs `apt-get install -y libgl1 libglib2.0-0`.
A typed reference has no amount to check; it stays flagged `typed_reference` for the host.
GoTyme doesn't publish its receipt layout, so the GoTyme rules were written from the sample in this repo's tests;
check the first real GoTyme receipts in the desk.

## Weather, rain delays and host alerts

The courts are open-air, so rain means moving people. `app/weather.py` reads the hourly rain forecast from
[Open-Meteo](https://open-meteo.com) (free, no account; coordinates default to Koronadal City, see `.env.example`), cached for
15 minutes, and falls back to the last good answer for up to 3 hours if the service is unreachable. The forecast only
*informs* the host; nothing is moved automatically.

**Rain-delay flow** (admin desk → Weather): pick the window (date, start hour, how many hours) → preview who is affected →
call it. Every paid booking in the window gives its hours back and becomes **Rain delay** (still paid, nothing cancelled or
refunded). The host texts each guest (the desk prefills an `sms:` message with the link `/?reschedule=CODE`); the guest picks a
new time themselves on the site, at any time, for free, without using their one reschedule. The host can undo with Restore.

**Telegram alerts (optional)**: set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` and the server messages the host once when a
booking goes Late ("restore it if they turn up") and once per day when rain is forecast during paid bookings. Each alert is
sent a single time (`notices_sent`). Without those two settings nothing is sent and nothing else changes.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | Courts, rates, payment accounts, hold minutes, today's play date |
| GET | `/api/availability?date=YYYY-MM-DD` | Per hour and court: `available`, `held`, `booked` or `past` |
| POST | `/api/bookings` | Creates the hold; returns the booking and an `accessToken` |
| GET | `/api/bookings/{code}` | Header `X-Booking-Token` |
| POST | `/api/bookings/{code}/receipt` | multipart field `receipt` (JPG, PNG, WebP or HEIC, max 8 MB) |
| POST | `/api/bookings/{code}/reference` | `{referenceNumber, paidTime: "HH:MM", payerName}` |
| POST | `/api/bookings/{code}/release` | Let go of an *unpaid* hold. A paid booking answers `409 bookings_final` (`/cancel` is kept as an alias) |
| POST | `/api/bookings/{code}/arrive` | Guest check-in (opens 30 min before the start); stops the booking from going Late |
| POST | `/api/reschedule/find` | `{code, customerPhone?}` (or the booking token header) → the booking, a token, and the allowed date range |
| POST | `/api/reschedule` | `{code, customerPhone?, courtId?, date, hour}` → the moved booking (`reschedule_*`, `costs_more`, `slot_taken`… errors) |

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
| POST | `/api/admin/bookings/{code}/confirm` \| `reject` \| `cancel` | confirm also restores a rejected / expired / cancelled booking if its hours are still free, and confirms a short payment once the balance arrived; reject works on online payments, even after automatic confirmation; `cancel` is the host's "void" (guests can't cancel) |
| POST | `/api/admin/bookings/{code}/arrived` | The group is on site: stops the booking from going Late |
| POST | `/api/admin/bookings/{code}/restore` | `{note?}`. Puts a Late booking (within the host's `RESTORE_WINDOW_MINUTES`) or a rain-delayed one back on court; `409 slot_taken` if someone booked the hours meanwhile |
| GET | `/api/admin/weather` | Next days' hourly rain chance (Open-Meteo, cached 15 min) and the paid bookings caught in it |
| GET / POST | `/api/admin/rain-delay` | GET `?date&fromHour&hours` previews who is affected; POST `{date, fromHour, hours, codes?, note?}` calls the delay |
| GET | `/api/admin/bookings/{code}/receipt` | the image, if still stored |

Every admin change is written to `admin_events`, which survives deleting the booking.

## Data & deployment

- Everything lives in `DATA_DIR` (default `backend/data/`): `housepickle.db` plus `receipts/`. Put it on a persistent disk and back it up. Serverless hosts won't work.
- Receipts are never served publicly. Only the signed-in admin can open them.
- Production: `npm run build` in `frontend/`, then `uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*"`. The API serves the built PWA from the same origin, so no CORS setup is needed. Put it behind HTTPS, which PWAs and the clipboard require.
- Payment methods: each needs an account number or a QR image to be offered, otherwise it shows "Coming soon". The QR images live in `frontend/public/images/` (`payment-qr-gcash.jpg`, `payment-qr-gotyme.jpg`) and can be swapped via `GCASH_QR_IMAGE` / `GOTYME_QR_IMAGE`. GoTyme shows `GOTYME_ACCOUNT_HINT` (last digits only) because the full account number was never shared.
