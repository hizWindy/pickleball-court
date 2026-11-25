// ── Marketing content (static) ───────────────────────────────────────────────
export type CourtType = 'standard' | 'championship' | 'tournament' | 'training';

export interface Court {
  id: string;
  name: string;
  tagline: string;
  type: CourtType;
  surface: string;
  image: string;
  dayRate: number; // 5 AM - 6 PM (₱200/hr)
  nightRate: number; // 6 PM - 5 AM (₱250/hr)
  badge: string;
  features: string[];
  dimensions: string;
}

/** Morning is 5 AM - 6 PM (day rate), Evening is 6 PM - 5 AM (night rate). */
export type TimePeriod = 'morning' | 'evening';

export interface TimeSlot {
  id: string; // e.g., "slot-06"
  time: string; // "06:00 AM"
  hour: number; // 0-23
  period: TimePeriod;
  isPeak: boolean;
  rateType: 'standard' | 'night_owl';
}

// ── Booking API (mirrors backend/app/schemas.py) ─────────────────────────────
/** The accounts a player can pay online, in the order they are offered (PAYMENT_METHODS in backend/app/config.py). */
export type PaymentMethod = 'gcash' | 'gotyme' | 'maribank';
/** How a booking was paid: online, or cash at the desk for a booking the host added ('none' for a block). */
export type PaidWith = PaymentMethod | 'cash' | 'none';
export type BookingStatus = 'held' | 'pending_verification' | 'confirmed' | 'rejected' | 'expired' | 'cancelled';
export type SlotState = 'available' | 'held' | 'booked' | 'past';
export type RateType = 'standard' | 'night_owl';

export interface CourtConfig {
  id: string;
  name: string;
  dayRate: number;
  nightRate: number;
}

export interface PaymentAccount {
  method: PaymentMethod;
  label: string;
  accountName: string;
  accountNumber: string;
  qrImage: string;
  accountHint: string;
  enabled: boolean;
  /** All-digit reference lengths this bank's receipts may show, besides GCash's 13 (MariBank's). */
  referenceDigits: number[];
}

export interface AppConfig {
  courts: CourtConfig[];
  paymentAccounts: PaymentAccount[];
  paddleFee: number;
  holdMinutes: number;
  /** The longest booking: the +/- stepper goes up to this (as long as every hour is free). */
  maxHours: number;
  /** Quick-pick chips for the common lengths: 1 to this many hours. */
  quickHours: number;
  bookingWindowDays: number;
  /** House rule: a group not there this long after its start is Late, and the host may give the court to others. */
  lateAfterMinutes: number;
  /** A payment that comes in this long after the hold ran out still counts (the slot, if nobody took it). */
  latePaymentMinutes: number;
  /** false: a booking moves only when the host calls a weather rebooking. true: guests also get one self-service move. */
  guestReschedule: boolean;
  /** Self-service rescheduling (when guestReschedule): once per booking, at least this many hours before the start. */
  rescheduleMinHours: number;
  /** ...and the new date must be within this many days of the original one. */
  rescheduleWindowDays: number;
  consentVersion: string;
  /** How a player proves payment: type the reference number + sender name, or (when the server has the RAM) upload a receipt. */
  proofMode: 'reference' | 'receipt';
  today: string; // current play day, YYYY-MM-DD (Manila)
  serverNow: string;
}

export interface SlotAvailability {
  hour: number;
  startAt: string;
  period: TimePeriod;
  rateType: RateType;
  courts: Record<string, SlotState>;
}

export interface Availability {
  date: string;
  serverNow: string;
  slots: SlotAvailability[];
}

export interface LineItem {
  startAt: string;
  rate: number;
  rateType: RateType;
  /** The court the hour is on: a two-court booking lists each hour once per court. */
  courtId?: string | null;
}

/** One court of a booking (a two-court booking has two). The host may end one court on its own. */
export interface BookingCourt {
  courtId: string;
  courtName: string;
  status: BookingStatus;
  total: number;
}

/** Whether the guest can move this booking: once, 48 h ahead (`open`), after a rain delay (`weather`), or not. */
export type RescheduleState = 'open' | 'weather' | 'used' | 'too_late' | 'unavailable';
/** Why a payment waits for the host instead of confirming. */
export type PendingReason = 'amount_short' | 'amount_unreadable';

export interface Booking {
  /** The booking's code: for two courts, the first court's. */
  code: string;
  status: BookingStatus;
  /** The (first) court still on. */
  courtId: string;
  /** Every court still on, e.g. "Court 1 & Court 2". */
  courtName: string;
  /** Each court of the booking, first court first (one for a one-court booking). Missing from an older server. */
  courts?: BookingCourt[];
  playDate: string;
  startAt: string;
  endAt: string;
  hours: number;
  customerName: string;
  customerPhoneMasked: string;
  paymentMethod: PaidWith;
  /** Paddle rental: one pair per court. */
  paddles: boolean;
  lineItems: LineItem[];
  /** For the courts still on, added up: two courts are paid with one payment of `total`. */
  courtCost: number;
  addonsCost: number;
  total: number;
  createdAt: string;
  holdExpiresAt: string;
  submittedAt: string | null;
  proofType: 'receipt' | 'reference' | null;
  closedAt: string | null;
  serverNow: string;
  /** The host marked the group as here. */
  arrived: boolean;
  /** Not there in time: the host may give the court to others. */
  late: boolean;
  /** The host called a rain delay: the guest picks a new time (free, doesn't use the one reschedule). */
  weatherHold: boolean;
  /** Paid after the hold ran out while someone else had the slot: the host will be in touch (status `expired`). */
  paidLate: boolean;
  /** Check-in is open right now (from 30 min before the start until the session ends). */
  reschedule: RescheduleState;
  rescheduleCount: number;
  /** Set while status is `pending_verification`: why the payment is waiting for the host. */
  pendingReason: PendingReason | null;
  /** Pesos the receipt showed, if the server could read it. */
  amountPaid: number | null;
  /** The reference of the payment (GCash, GoTyme, MariBank...), once proof is in (read off the receipt, or typed in). */
  paymentReference: string | null;
}

export interface BookingWithToken {
  booking: Booking;
  accessToken: string;
}

export interface RescheduleLookup {
  booking: Booking;
  /** Lets this device keep reading the booking after finding it by code + number. */
  accessToken: string;
  earliestDate: string;
  latestDate: string;
}

export interface RescheduleRequest {
  code: string;
  /** Mobile number on the booking. Not needed when `token` (this device's booking token) is passed to the API call. */
  customerPhone?: string;
  courtId?: string;
  date: string;
  hour: number;
}

export interface CreateBookingRequest {
  /** One court, or both at once. (The server still takes `courtId` from older versions of the site.) */
  courtIds: string[];
  date: string;
  hour: number;
  hours: number;
  paddles: boolean;
  customerName: string;
  customerPhone: string;
  paymentMethod: PaymentMethod;
  consent: boolean;
  consentVersion: string;
  marketingOptIn: boolean;
}

/** What the booking sheet can be pre-filled with (e.g. from the hero console). */
export interface BookingDraftSeed {
  date?: string;
  hour?: number;
  courtId?: string;
}
