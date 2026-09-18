import { Booking } from '../types';

const STORAGE_KEY = 'housepickle_court_bookings_v2';

// Initial sample bookings to show real schedule occupancy
const INITIAL_BOOKINGS: Booking[] = [
  {
    id: 'b-init-1',
    bookingRef: 'HPC-2026-1042',
    courtId: 'court-1',
    courtName: 'Court 1',
    date: new Date().toISOString().split('T')[0], // Today
    slots: ['slot-18', 'slot-19'], // 6:00 PM - 8:00 PM
    timeRangeFormatted: '06:00 PM - 08:00 PM',
    hoursCount: 2,
    addons: [],
    customerName: 'Coach Dave',
    customerPhone: '09171234567',
    courtCost: 500,
    addonsCost: 0,
    discountAmount: 0,
    totalAmount: 500,
    paymentMethod: 'gcash',
    gcashRefNumber: '109283746192',
    status: 'confirmed',
    createdAt: new Date(Date.now() - 3600000 * 4).toISOString()
  },
  {
    id: 'b-init-2',
    bookingRef: 'HPC-2026-1088',
    courtId: 'court-2',
    courtName: 'Court 2',
    date: new Date().toISOString().split('T')[0], // Today
    slots: ['slot-20'], // 8:00 PM - 9:00 PM
    timeRangeFormatted: '08:00 PM - 09:00 PM',
    hoursCount: 1,
    addons: [],
    customerName: 'Sarah Lim',
    customerPhone: '09189876543',
    courtCost: 200,
    addonsCost: 0,
    discountAmount: 0,
    totalAmount: 200,
    paymentMethod: 'gcash',
    gcashRefNumber: '928374610293',
    status: 'confirmed',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString()
  }
];

export const getBookings = (): Booking[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_BOOKINGS));
      return INITIAL_BOOKINGS;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load bookings from storage', err);
    return INITIAL_BOOKINGS;
  }
};

export const saveBooking = (newBooking: Booking): Booking[] => {
  const existing = getBookings();
  const updated = [newBooking, ...existing];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to persist booking', err);
  }
  return updated;
};

export const cancelBooking = (bookingId: string): Booking[] => {
  const existing = getBookings();
  const updated = existing.map((b) => (b.id === bookingId ? { ...b, status: 'cancelled' as const } : b));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to cancel booking', err);
  }
  return updated;
};

export const getBookedSlotIdsForDateAndCourt = (dateStr: string, courtId: string): string[] => {
  const bookings = getBookings();
  const filtered = bookings.filter(
    (b) => b.date === dateStr && b.courtId === courtId && b.status !== 'cancelled'
  );
  const slotSet = new Set<string>();
  filtered.forEach((b) => {
    b.slots.forEach((s) => slotSet.add(s));
  });
  return Array.from(slotSet);
};

export const generateBookingCode = (): string => {
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `PKL-2026-${randomNum}`;
};
