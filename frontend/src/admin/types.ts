// Mirrors backend/app/admin_schemas.py
import type { BookingStatus, LineItem } from '../types';

export type AdminPayment = 'gcash' | 'gotyme' | 'cash' | 'none';
export type Source = 'online' | 'walk_in' | 'blocked';

export interface AdminBooking {
  code: string;
  status: BookingStatus;
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
