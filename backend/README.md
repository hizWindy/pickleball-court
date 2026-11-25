# HousePickle Club — Booking API

FastAPI + SQLite backend for court booking with manual GCash / GoTyme / MariBank payment verification.

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

Tests: `pytest` (they use a throwaway database and a fake clock). Among them:

- `tests/test_simulated_day.py` plays one fixed day and 50 random days at the club (players booking, paying late and
  walking away; the desk adding walk-ins and blocks, editing, forgetting to tap Arrived, calling rain delays) and checks
  after every step that no court-hour has two owners, the slot table matches the bookings, a payment reference backs one
  booking, every filter chip's number matches its list, and no unpaid hold is stuck. A failure names its seed and step;
  `SIM_DAYS=200 pytest tests/test_simulated_day.py` plays more days.
- `tests/test_double_booking.py` holds the 2026-11-25 audit's scenarios: a phone booking and a paid group losing their
  hours when nobody tapped Arrived, payments just after the timer, a rain delay. They failed on that day's code and pass
  since release 3 of the plan.

Load test (a real server on a throwaway database, 100+ simultaneous requests from players and the desk for the same
court-hours): `.venv\Scripts\python scripts\stress_double_booking.py`. It passes when every court-hour has one owner.

**Demo data for your own computer:** `python -m app.seed_demo` makes 19 bookings under one demo number (`0999 000 0001`;
blocks carry a demo note instead): paid ones (one by MariBank), two **rain-delayed** guests (they see *Rebook now* on "Check my booking"),
an unpaid hold, an expired one, a block, a Late booking, and walk-ins at the hours that are easy to get wrong (5 AM,
7 PM and 4 AM on both courts, and 11 PM - 2 AM). `--many` adds 270 walk-ins to try "Show more" past 200. It prints the
codes. Run it again for a fresh set (only the demo bookings are replaced) and it refuses to run on Render. Try it: the
site's *Check my booking* with a code and that number, and `/admin` > Schedule, Bookings and Weather > *Rebook guests*.

## Booking rules (what the code enforces)

| Rule | Where |
|---|---|
| A slot is **held for 10 minutes** (`HOLD_MINUTES`) from "Confirm & hold". The deadline is stored in the database; the phone only shows a countdown to it. | `booking_service.create_booking` |
| While held, nobody else can book it. Double booking is impossible: one row per court-hour with a primary key. | `booking_slots` table |
| No proof in time (+10 s grace) → booking **expires** and the slot is released. Runs on every request and every 15 s in the background. | `release_expired`, `main._sweep_forever` |
| **A payment after the timer** (within `LATE_PAYMENT_MINUTES`, 30) still counts: if nobody took the hours meanwhile they are taken back and the booking confirms as usual; if someone did, the payment is kept on the expired booking (`paid_late_at`, label **Paid late**), the host is pinged and the player is told the host will move or refund it. Later than that: the usual `hold_expired`. The reference rules don't change. | `_held_for_proof`, `_settle_late_payment`, `_keep_late_payment` |
| Proof = **receipt screenshot** (main path) or **typed reference + payment time + payer name** (fallback). | `submit_receipt`, `submit_reference` |
| The same receipt image or reference number can never back two bookings, even after deletion or rejection. | unique indexes on `receipt_sha256`, `reference_number` |
| A typed payment time must fall inside the hold window (±5 min). | `_resolve_paid_time` |
| A typed all-digit GCash reference must be 13 digits. Other references (GoTyme `GT…`, banks paying the InstaPay QR) are only sanity-checked. A booking paid to MariBank also takes MariBank's own all-digit references (`MARIBANK_REFERENCE_DIGITS`, 10-20 until real receipts confirm the length). | `validation.normalize_reference` |
| Full payment **confirms the booking at once**. A receipt image is read on our server (amount, reference, date, recipient). **The amount is checked against the checkout total:** equal → confirmed; more → confirmed and flagged `amount_over`; **short, or no amount readable although the OCR worked → the slot stays reserved but the booking waits for the host** (`pending_verification`). Other mismatches are review flags the host can reject. If the OCR engine is unavailable, the booking is still confirmed and flagged `unreadable`. | `submit_receipt`, `receipt_reader.assess`, `HOLD_FOR_HOST` |
| One payment can never confirm two bookings: the same image (hash) or the same reference number, whether typed or read off a different screenshot. | `submit_receipt`, `uq_bookings_reference` |
| **No cancellations.** A paid booking is final (no refunds). A guest can only *release an unpaid hold*; anything else answers `409 bookings_final`. The host can still void a booking from the desk (mistakes, duplicates). | `release_hold` |
| **Late rule (15 min).** A paid booking whose group hasn't arrived `LATE_AFTER_MINUTES` after its start is **Late** (status stays `confirmed`, `late_at` is set, no refund) but **keeps its court until the host decides**: **Arrived** (they're playing: no longer Late) or **Release court** (the hours go back on sale, `released_at`). Giving the hours away by itself let two groups end up on one court when the host hadn't tapped Arrived; an idle court costs less. "Arrived" is set only by the host; guests have no way to check in. Walk-ins added for a time that has begun, and blocks, are never late. | `mark_late`, `admin_service.mark_arrived`, `admin_service.release` |
| **Undo a release.** For `RESTORE_WINDOW_MINUTES` (5) after releasing a Late booking's court the host (only) can **Restore** it if the hours are still free. Guests are never told. After that, the host can still move the booking with Edit. | `admin_service.restore` |
| **Moving a booking** happens only when the host calls a weather rebooking (below), because the host is the one watching the weather. Optional, off by default (`GUEST_RESCHEDULE=1`): one self-service move per guest, at least 48 h before the start, same length, new date within 30 days of the original, never to a slot that costs more than was paid (cheaper is allowed, no refund). Proof of ownership = booking code + mobile number (or the device's token). | `reschedule.py` |
| **Rain delay** (host): sets `weather_hold_at` on the paid bookings in a window. Their hours **stay closed** until the guest picks a new time on "Check my booking" (any time, free): the move gives up the old hours and takes the new ones in one step. The host can **Open these hours** sooner (`released_at`), and undo the delay with Restore. | `admin_service.rain_delay`, `admin_service.release`, `reschedule.py` |
| Which bookings own their hours: an unpaid hold that is still running and a paid booking, Late and rain-delayed ones included, until released. `booking_slots` always holds exactly those bookings' hours; the scripted-day test and the load test check it from the bookings themselves. | `booking_service.holds_court`, `HOLDS_COURT_SQL` |
| Two unpaid bookings per device (IP) at a time (a two-court booking counts once); a mobile number isn't limited, since families and groups share one. Rate limits on create and proof. The player's IP is stored only while the booking is `held`, then erased. | `create_booking`, `ratelimit.py` |
| Each hour is priced by its own rate (Morning ₱200 from 5 AM to 6 PM, Evening ₱250 from 6 PM to 5 AM; the booking picker groups start times the same way), plus ₱80 for paddles (per court). Totals are computed on the server only. | `slots.price_hours` |
| **Both courts at once** (plan item 11). `courtIds` takes one court or both; `courtId` (one court) still works for older phones. Each court is its own row, linked by `group_id` (the first court's row id, the "lead"). The rows are created together or not at all: if either court is taken at any of the hours nothing is booked, and the player is told which court and hour. They share one timer and are paid, expire and are let go together. The player sees one booking under the lead's code and pays once: the sum, each court at its own rates, plus the paddle fee per court (D5). The payment (reference or receipt) is stored on the lead row only, so one payment still backs one booking. At the desk each court is its own booking: Schedule, Arrived, Late, Release, Edit and the per-court figures work as for any booking. Reject and Void cover both courts or only one (`bothCourts`, D5); confirming an unpaid pair by hand confirms both. A rain-delayed pair moves both courts together when the guest picks a new time. | `create_booking`, `group_rows`, `lead_row`, `same_state`, `admin_service._both`, `reschedule.py` |
| 12 AM–4 AM belong to the previous night's "play day". All times are Manila time. | `slots.py` |
| A typed reference must look real: GCash 13 numbers, GoTyme `GT` + that day's date + 8 numbers, another bank 10 to 32 letters and numbers (spaces, dashes and a leading "Ref No." are ignored). Lazy fakes (`1111111111111`, `1234567890123`, `1212...`) and a GoTyme number from another day are turned away with the same reply a duplicate gets, same status and body, so a reply never reveals what is already in the system. A wrong shape gets a hint that depends only on what was typed. After 5 turned-away tries a booking is sent to the host (`reference_locked`). A format check cannot prove a payment: the host still checks it in their own app. | `validation.normalize_reference`, `booking_service.submit_reference` |
| Consent is required, versioned and timestamped per booking. Receipt images are deleted 7 days after the host decides (14 days at most if nobody ever reviews them); the hash is kept. | `CONSENT_VERSION`, `purge_old_receipts` |

Status flow: `held → confirmed` (on full payment) | `pending_verification` (receipt short or amount unreadable: the host decides), then possibly `rejected` by the host; plus `expired` (hold ran out; a payment within the late window brings it back to `confirmed`, or keeps it `expired` with `paid_late_at`) and `cancelled` (released unpaid hold, or voided by the host).
`Late` and `rain delay` are not statuses: the booking stays `confirmed` and carries `late_at` / `weather_hold_at`, and `released_at` once the host gives its hours back.
The desk shows one **label** per booking, computed from those: **Paid · Late · Done · Rain delay** (plus Paid late, Blocked, Paying now, Rejected, Expired, Cancelled).

## Reading receipts (OCR): off by default

`PROOF_MODE` (default `reference`) decides how a player proves payment:

- **`reference`**: the player types the GCash / GoTyme reference number and the sender's name. No upload, no OCR, no payment
  time. The booking confirms at once; the admin desk shows *Paid between* the booking time and the moment the details were
  sent, and the host matches reference, amount and sender in the GCash / GoTyme app. A reference can only pay for one booking.
  `POST /bookings/{code}/receipt` answers `receipt_disabled`. This is what a 512 MB Render instance runs.
- **`receipt`**: the original flow below (upload a screenshot, read on the server). Needs ~400 MB spare while a receipt is read:
  set `PROOF_MODE=receipt` after upgrading the instance's RAM. Everything below is kept for that.

The rest of this section describes `PROOF_MODE=receipt`.

`app/ocr.py` runs [RapidOCR](https://github.com/RapidAI/RapidOCR) (PaddleOCR models on ONNX Runtime) on our own server:
no image leaves it, the ~30 MB of models ship inside the pip package, and a phone screenshot takes about 2-3 s.
The engine needs ~350 MB to load, so each receipt is read by a short-lived child process (`app/ocr_worker.py`): the web
server idles at ~50 MB, borrows the memory for a few seconds per receipt, and if the child is ever killed or exceeds
`OCR_TIMEOUT_SECONDS` (default 60) the booking is still confirmed and flagged `unreadable`. This is what lets a 512 MB
Render instance cope; receipts are read one at a time.
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
call it. Every paid booking in the window becomes **Rain delay** (still paid, nothing cancelled or refunded) and keeps its
hours closed until the guest picks a new time. The host texts each guest (the desk prefills an `sms:` message with the link
`/?reschedule=CODE`); the guest picks a new time themselves on the site ("Check my booking"), at any time, for free. The host
can open the hours sooner (**Open hours**) or undo the delay with Restore.

**Telegram alerts (optional)**: set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` and the server messages the host once when a
booking goes Late ("the court is still theirs: Arrived or Release court"), once when a payment arrives after its time ran out
and the slot was taken ("move it or refund it"), and once per day when rain is forecast during paid bookings. Each alert is
sent a single time (`notices_sent`). Without those two settings nothing is sent, and the desk shows the same prompts. Check
that both are set on Render: under the new Late rule the host's ping is what keeps a court from sitting idle.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | Courts, rates, payment accounts, hold minutes, today's play date |
| GET | `/api/availability?date=YYYY-MM-DD` | Per hour and court: `available`, `held`, `booked` or `past` |
| POST | `/api/bookings` | Creates the hold; returns the booking and an `accessToken`. `courtIds: ["court-1", "court-2"]` books both courts at once (or one: `courtIds: ["court-1"]`, or the older `courtId`). The booking's `courts` lists each court with its own status; `courtName`, `total` and `lineItems` cover the courts still on |
| GET | `/api/bookings/{code}` | Header `X-Booking-Token` |
| POST | `/api/bookings/{code}/receipt` | multipart field `receipt` (JPG, PNG, WebP or HEIC, max 8 MB) |
| POST | `/api/bookings/{code}/reference` | `{referenceNumber, paidTime: "HH:MM", payerName}` |
| POST | `/api/bookings/{code}/release` | Let go of an *unpaid* hold (every court of it). A paid booking answers `409 bookings_final` (`/cancel` is kept as an alias) |
| POST | `/api/reschedule/find` | `{code, customerPhone?}` (or the booking token header) → the booking, a token, and the allowed date range. Either court's code finds a two-court booking |
| POST | `/api/reschedule` | `{code, customerPhone?, courtId?, date, hour}` → the moved booking (`reschedule_*`, `costs_more`, `slot_taken`… errors). A two-court booking moves both courts together (`courtId` is ignored) |

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
| GET / POST | `/api/admin/bookings` | list (`q`, `status`, `label` = paid, late, done, rain_delay or blocked, `dateFrom`, `dateTo`, `courtId`, `sort` = start_desc, start_asc, created_desc or upcoming_first, `page`, `pageSize` up to 200) / add walk-in or block. With no status or label, the list (and its `all` count) leaves out expired unpaid holds unless there is a search (`ALL_INCLUDES_EXPIRED=1` shows them) |
| GET / PATCH / DELETE | `/api/admin/bookings/{code}` | detail with history / edit (reschedule is clash-checked) / delete for good |
| POST | `/api/admin/bookings/{code}/check` | "Looks good": marks an automatically confirmed payment as looked at |
| POST | `/api/admin/bookings/{code}/confirm` \| `reject` \| `cancel` | confirm also restores a rejected / expired / cancelled booking if its hours are still free, and confirms a short payment once the balance arrived (an unpaid two-court hold is confirmed whole); reject works on online payments, even after automatic confirmation; `cancel` is the host's "void" (guests can't cancel). `reject` and `cancel` take `{reason?, bothCourts?}`: for a two-court booking, both courts or only this one. Each booking in the desk's answers carries `linked` (the other court), `groupTotal` and, on the second court, `paymentCode` |
| POST | `/api/admin/bookings/{code}/arrived` | The group is on site: stops the booking from going Late, and ends a Late that still holds its court |
| POST | `/api/admin/bookings/{code}/release` | `{note?}`. Release court (a Late booking) or Open these hours (a rain delay): its hours go back on sale (`released_at`) |
| POST | `/api/admin/bookings/{code}/restore` | `{note?}`. Undoes a rain delay, or puts back a Late booking whose court was released (within `RESTORE_WINDOW_MINUTES`); `409 slot_taken` if someone booked the hours meanwhile |
| GET | `/api/admin/weather` | Next days' hourly rain chance (Open-Meteo, cached 15 min) and the paid bookings caught in it |
| GET / POST | `/api/admin/rain-delay` | GET `?date&fromHour&hours` previews who is affected; POST `{date, fromHour, hours, codes?, note?}` calls the delay |
| GET | `/api/admin/bookings/{code}/receipt` | the image, if still stored |

Every admin change is written to `admin_events`, which survives deleting the booking.

## Data & deployment

- Everything lives in `DATA_DIR` (default `backend/data/`): `housepickle.db` plus `receipts/`. Put it on a persistent disk and back it up. Serverless hosts won't work.
- Receipts are never served publicly. Only the signed-in admin can open them.
- Production: `npm run build` in `frontend/`, then `uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*"`. The API serves the built PWA from the same origin, so no CORS setup is needed. Put it behind HTTPS, which PWAs and the clipboard require.
- Payment methods (GCash, GoTyme, MariBank, in that order: one list, `Settings.payment_accounts`): each needs an account number or a QR image to be offered, otherwise it shows "Coming soon". The QR images live in `frontend/public/images/` (`payment-qr-gcash.jpg`, `payment-qr-gotyme.jpg`, `payment-qr-maribank.jpg`, all InstaPay QR Ph, so any bank or e-wallet app can pay them) and can be swapped via `GCASH_QR_IMAGE` / `GOTYME_QR_IMAGE` / `MARIBANK_QR_IMAGE`. GoTyme and MariBank show only the last digits (`GOTYME_ACCOUNT_HINT`, `MARIBANK_ACCOUNT_HINT`).
- Brand files (the House Pickle Club logo, traced to SVG from the owner's 2000 px image until a designer's vector file replaces it): `frontend/public/brand/` (`logo-stacked*.svg`, `emblem*.svg`, `favicon.svg`, app icons as PNG). Use the `-on-dark` versions on dark colours and photos. New names on purpose: phones never mix them up with the old logo in their cache.
