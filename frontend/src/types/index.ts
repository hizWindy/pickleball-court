// ── Marketing content (static) ───────────────────────────────────────────────
export type CourtType = 'standard' | 'championship' | 'tournament' | 'training';

export interface Court {
  id: string;
  name: string;
  tagline: string;
  type: CourtType;
  surface: string;
  image: string;
  dayRate: number; // 6 AM - 10 PM
  nightRate: number; // 10 PM - 6 AM
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
  maxHours: number;
  bookingWindowDays: number;
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
}

export interface BookingWithToken {
  booking: Booking;
  accessToken: string;
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
