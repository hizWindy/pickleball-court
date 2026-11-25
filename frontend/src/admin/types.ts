// Mirrors backend/app/admin_schemas.py
import type { BookingStatus, LineItem, PaidWith } from '../types';

export type AdminPayment = PaidWith;
export type Source = 'online' | 'walk_in' | 'blocked';

/**
 * The one word on a booking. Day to day it's Paid, Late, Done (and Rain delay when you've called one);
 * the rest are rare states. A Late or rain-delayed booking is still `status: 'confirmed'`. `paid_late`: the hold ran
 * out, then a payment came in while someone else had the slot (status `expired`): move it or refund it.
 */
export type AdminLabel = 'paid' | 'late' | 'done' | 'rain_delay' | 'blocked' | 'awaiting' | 'rejected' | 'expired' | 'cancelled' | 'paid_late';

export interface AdminBooking {
  code: string;
  status: BookingStatus;
  label: AdminLabel;
  source: Source;
  courtId: string;
  courtName: string;
  playDate: string;
  hour: number;
  startAt: string;
  endAt: string;
  hours: number;
  customerName: string;
  customerPhone: string;
  paymentMethod: AdminPayment;
  paddles: boolean;
  courtCost: number;
  addonsCost: number;
  total: number;
  customPrice: boolean;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  holdExpiresAt: string;
  proofType: 'receipt' | 'reference' | null;
  hasReceipt: boolean;
  referenceNumber: string | null;
  paidAt: string | null;
  payerName: string | null;
  adminNote: string | null;
  checkedAt: string | null;
  reviewFlags: ReviewFlag[];
  /** Paid online and confirmed automatically, but nobody has looked yet. */
  needsReview: boolean;
  /** The host marked the group as on site (this is what stops a booking going Late). */
  arrivedAt: string | null;
  /** When the group was Late: 15 min after the start without Arrived. The court stays theirs until the host decides. */
  lateAt: string | null;
  /** When the host called a rain delay. */
  weatherHoldAt: string | null;
  /** When the host gave a Late or rain-delayed booking's hours back (Release court / Open these hours). */
  releasedAt: string | null;
  /** When a payment came in after the hold ran out, while someone else had the slot. */
  paidLateAt: string | null;
  rescheduleCount: number;
  /** Owns its court-hours right now: a Late or rain-delayed booking does until it is released. */
  holdsCourt: boolean;
  /** Paid after its hold ran out, and the slot was taken: move it to a free time, or refund it. */
  paidLate: boolean;
  /** Released Late (inside the short undo) or rain-delayed: the host can put it back with Restore. */
  restorable: boolean;
  /** End of that undo for a released Late booking (guests are never told). Null for rain delays. */
  restoreUntil: string | null;
  canMarkArrived: boolean;
  /** Late or rain-delayed and still holding its court: Release court / Open these hours. */
  canRelease: boolean;
  /**
   * Both courts booked at once: each court is its own booking here (Arrived, Late and Release work per court), linked
   * to the other. The player paid once for both (`groupTotal`); the payment is stored on the first court's booking.
   */
  groupId: string | null;
  /** The other court(s) of the booking. Empty for one court. */
  linked: LinkedBooking[];
  /** The whole booking's price, every court of it (this booking's total for one court). */
  groupTotal: number;
  /** On the second court: the booking whose record holds the shared payment. */
  paymentCode: string | null;
}

/** The other court of a two-court booking. */
export interface LinkedBooking {
  code: string;
  courtId: string;
  courtName: string;
  status: BookingStatus;
  label: AdminLabel;
  holdsCourt: boolean;
}

export interface ReviewFlag {
  code: string;
  message: string;
}

/** What the server read off the receipt image. */
export interface ReceiptScan {
  engine: string;
  provider: string | null;
  amount: number | null;
  reference: string | null;
  paidAt: string | null;
  recipientName: string | null;
  recipientNumber: string | null;
  /** Who paid, when the receipt shows it (GoTyme, Maya and bank receipts do; GCash does not). */
  senderName: string | null;
  senderNumber: string | null;
  success: boolean | null;
  rawText: string | null;
  durationMs: number | null;
}

export interface AdminEvent {
  action: string;
  detail: string | null;
  createdAt: string;
}

export interface AdminBookingDetail extends AdminBooking {
  lineItems: LineItem[];
  events: AdminEvent[];
  scan: ReceiptScan | null;
}

export interface StatusCounts {
  all: number;
  held: number;
  pendingVerification: number;
  confirmed: number;
  rejected: number;
  expired: number;
  cancelled: number;
  toReview: number;
  flagged: number;
  /** Confirmed bookings by the host's words (Late includes ones past their restore window). */
  paid: number;
  late: number;
  done: number;
  rainDelay: number;
  /** Courts the host closed. */
  blocked: number;
  /** Paid after the hold ran out, with the slot taken (they show under All, and under Expired). */
  paidLate: number;
}

export interface AdminBookingList {
  items: AdminBooking[];
  total: number;
  page: number;
  pageSize: number;
  counts: StatusCounts;
}

export interface ListQuery {
  q?: string;
  status?: string;
  review?: 'unchecked' | 'flagged';
  label?: 'paid' | 'late' | 'done' | 'rain_delay' | 'blocked' | 'paid_late';
  dateFrom?: string;
  dateTo?: string;
  courtId?: string;
  /** `upcoming_first`: what is still to play (soonest first), then what has ended (latest first). */
  sort?: 'start_desc' | 'start_asc' | 'created_desc' | 'upcoming_first';
  page?: number;
  pageSize?: number;
}

export interface NavCounts {
  toReview: number;
  flagged: number;
  held: number;
  /** Late bookings still holding their court: the host decides (Arrived, or Release court). */
  late: number;
  /** Guests waiting to pick a new time after a rain delay. */
  rainDelay: number;
  /** Payments that came in after the hold ran out while the slot was taken: move or refund them. */
  paidLate: number;
  /** Online payments received so far: the desk announces it when this goes up. */
  payments: number;
  /** Goes up whenever any booking changes (a new hold, a payment, a release...). */
  rev: number;
}

export interface CreateBody {
  kind: 'walk_in' | 'block';
  courtId: string;
  date: string;
  hour: number;
  hours: number;
  paddles: boolean;
  customerName: string;
  customerPhone: string;
  paymentMethod: AdminPayment;
  total?: number | null;
  note?: string | null;
}

export type UpdateBody = Partial<Omit<CreateBody, 'kind'>>;

export interface AdminSchedule {
  date: string;
  serverNow: string;
  bookings: AdminBooking[];
}

// ── Weather and rain delays ───────────────────────────────────────────────────
export interface HourForecast {
  /** Start of the hour, ISO (UTC). */
  at: string;
  /** Chance of rain, 0-100. */
  probability: number;
  mm: number;
}

export interface RainRisk {
  booking: AdminBooking;
  peak: number;
}

export interface WeatherReport {
  /** False when the forecast service couldn't be reached. */
  available: boolean;
  updatedAt: string | null;
  warnPercent: number;
  hours: HourForecast[];
  atRisk: RainRisk[];
}

export interface RainDelayPreview {
  windowStart: string;
  windowEnd: string;
  bookings: AdminBooking[];
}

export interface RainDelayBody {
  /** Play-day date; hours after midnight belong to the previous day's date. */
  date: string;
  fromHour: number;
  hours: number;
  codes?: string[];
  note?: string;
}

export interface RainDelayResult {
  moved: AdminBooking[];
}

export interface Kpis {
  /** Paid in the chosen range, counted on the day it was paid. */
  revenue: number;
  /** Everything ever paid, whatever the range. */
  revenueAllTime: number;
  paidBookingsAllTime: number;
  revenuePrev: number;
  bookings: number;
  bookingsPrev: number;
  hours: number;
  avgBooking: number;
  paddleRevenue: number;
  utilisationPct: number;
  courtHoursAvailable: number;
  conversionPct: number | null;
  repeatCustomers: number;
  customers: number;
}

export interface Overview {
  days: number;
  dateFrom: string;
  dateTo: string;
  today: string;
  serverNow: string;
  kpis: Kpis;
  daily: { date: string; revenue: number; bookings: number; hours: number }[];
  byHour: number[];
  byWeekday: { weekday: number; revenue: number; bookings: number }[];
  byCourt: { courtId: string; name: string; revenue: number; hours: number; bookings: number }[];
  byMethod: { method: AdminPayment; revenue: number; bookings: number }[];
  byRate: { rateType: 'standard' | 'night_owl'; revenue: number; hours: number }[];
  funnel: Record<'confirmed' | 'pendingVerification' | 'held' | 'rejected' | 'expired' | 'cancelled', number>;
  pending: { count: number; amount: number; flagged: number };
  upNext: AdminBooking[];
  topCustomers: { name: string; phone: string; bookings: number; hours: number; spent: number }[];
}
