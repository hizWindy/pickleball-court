export type CourtType = 'standard' | 'championship' | 'tournament' | 'training';

export interface Court {
  id: string;
  name: string;
  tagline: string;
  type: CourtType;
  surface: string;
  image: string;
  dayRate: number; // 6 AM - 10 PM
  nightRate: number; // 10 PM - 6 AM (Night Owl discount/lighting included)
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

export interface BookingAddon {
  id: string;
  name: string;
  price: number;
  perHour?: boolean;
  description: string;
  image?: string;
}

export interface Promotion {
  id: string;
  code: string;
  title: string;
  discountPercent?: number;
  discountFixed?: number;
  description: string;
  badge: string;
  nightOwlOnly?: boolean;
  minHours?: number;
}

export interface Booking {
  id: string;
  bookingRef: string; // e.g. "PKL-2026-9821"
  courtId: string;
  courtName: string;
  date: string; // YYYY-MM-DD
  slots: string[]; // array of time strings e.g. ["19:00", "20:00"]
  timeRangeFormatted: string; // "7:00 PM - 9:00 PM"
  hoursCount: number;
  addons: { addonId: string; name: string; quantity: number; cost: number }[];
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  specialNotes?: string;
  appliedPromo?: string;
  courtCost: number;
  addonsCost: number;
  discountAmount: number;
  totalAmount: number;
  paymentMethod: 'gcash';
  gcashRefNumber: string;
  gcashReceiptImage?: string;
  status: 'confirmed' | 'pending_verification' | 'completed' | 'cancelled';
  createdAt: string;
}
