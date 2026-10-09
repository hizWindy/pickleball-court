// Mirrors backend/app/admin_schemas.py
import type { BookingStatus, LineItem } from '../types';

export type AdminPayment = 'gcash' | 'gotyme' | 'cash' | 'none';
export type Source = 'online' | 'walk_in' | 'blocked';

/**
 * The one word on a booking. Day to day it's Paid, Late, Done (and Rain delay when you've called one);
 * the rest are rare states. A Late or rain-delayed booking is still `status: 'confirmed'`.
 */
export type AdminLabel = 'paid' | 'late' | 'done' | 'rain_delay' | 'blocked' | 'awaiting' | 'needs_check' | 'rejected' | 'expired' | 'cancelled';

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
  /** When the court was released because the group didn't show up. */
  lateAt: string | null;
  /** When a rain delay gave the hours back. */
  weatherHoldAt: string | null;
  rescheduleCount: number;
  /** Late (inside the quiet window) or rain-delayed: the host can put it back with Restore. */
  restorable: boolean;
  /** End of that quiet window for a Late booking (guests are never told). Null for rain delays. */
  restoreUntil: string | null;
  canMarkArrived: boolean;
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
  label?: 'paid' | 'late' | 'done' | 'rain_delay';
  dateFrom?: string;
  dateTo?: string;
  courtId?: string;
  sort?: 'start_desc' | 'start_asc' | 'created_desc';
  page?: number;
  pageSize?: number;
}

export interface NavCounts {
  toReview: number;
  flagged: number;
  held: number;
  /** Late bookings the host can still restore. */
  late: number;
  /** Guests waiting to pick a new time after a rain delay. */
  rainDelay: number;
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
  revenue: number;
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
