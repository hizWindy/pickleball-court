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

export type TimePeriod = 'morning' | 'afternoon' | 'evening' | 'night_owl';

export interface TimeSlot {
  id: string; // e.g., "slot-06"
  time: string; // "06:00 AM"
  hour: number; // 0-23
  period: TimePeriod;
  isPeak: boolean;
  rateType: 'standard' | 'night_owl';
}

// ── Booking API (mirrors backend/app/schemas.py) ─────────────────────────────
export type PaymentMethod = 'gcash' | 'gotyme';
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
  /** House rule: a group not there this long after its start is Late and the court is released. */
  lateAfterMinutes: number;
  /** Rescheduling: once per booking, at least this many hours before the start. */
  rescheduleMinHours: number;
  /** ...and the new date must be within this many days of the original one. */
  rescheduleWindowDays: number;
  consentVersion: string;
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
}

/** Whether the guest can move this booking: once, 48 h ahead (`open`), after a rain delay (`weather`), or not. */
export type RescheduleState = 'open' | 'weather' | 'used' | 'too_late' | 'unavailable';
/** Why a payment waits for the host instead of confirming. */
export type PendingReason = 'amount_short' | 'amount_unreadable';

export interface Booking {
  code: string;
  status: BookingStatus;
  courtId: string;
  courtName: string;
  playDate: string;
  startAt: string;
  endAt: string;
  hours: number;
  customerName: string;
  customerPhoneMasked: string;
  paymentMethod: PaymentMethod;
  paddles: boolean;
  lineItems: LineItem[];
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
  /** Not there in time: the court was released. Only the host can put it back. */
  late: boolean;
  /** The host called a rain delay: the guest picks a new time (free, doesn't use the one reschedule). */
  weatherHold: boolean;
  /** Check-in is open right now (from 30 min before the start until the session ends). */
  reschedule: RescheduleState;
  rescheduleCount: number;
  /** Set while status is `pending_verification`: why the payment is waiting for the host. */
  pendingReason: PendingReason | null;
  /** Pesos the receipt showed, if the server could read it. */
  amountPaid: number | null;
  /** The GCash / GoTyme reference of the payment, once proof is in (read off the receipt, or typed in). */
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
  courtId: string;
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
