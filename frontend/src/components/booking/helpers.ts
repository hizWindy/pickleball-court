import { Moon, Sun } from 'lucide-react';
import { COURT_DETAILS } from '../../data/mockData';
import { isNightHour } from '../../lib/time';
import type { CourtConfig, TimePeriod } from '../../types';
import { cx } from './ui';

export interface PricedHour {
  hour: number;
  rate: number;
  night: boolean;
}

export interface CourtPrice {
  court: CourtConfig;
  hours: PricedHour[];
  courtCost: number;
  /** The paddle rental, one pair per court (plan D5). */
  addons: number;
  total: number;
}

export interface BookingPrice {
  courts: CourtPrice[];
  courtCost: number;
  addons: number;
  /** What the player pays, once, for every court. */
  total: number;
}

/**
 * The price of a booking of one court or several at once, worked out like the server does (booking_service.create_booking):
 * each hour at its own court's rate (Morning 5 AM - 6 PM, Evening 6 PM - 5 AM), each court on its own, and the paddle
 * rental once per court. Both courts 7-9 PM: 2 x 2 x ₱250 = ₱1,000.
 */
export function priceBooking(courts: CourtConfig[], hour: number, hours: number, paddles: boolean, paddleFee: number): BookingPrice {
  const priced = courts.map((court) => {
    const items = Array.from({ length: hours }, (_, i) => {
      const h = (hour + i) % 24;
      const night = isNightHour(h);
      return { hour: h, rate: night ? court.nightRate : court.dayRate, night };
    });
    const courtCost = items.reduce((s, i) => s + i.rate, 0);
    const addons = paddles ? paddleFee : 0;
    return { court, hours: items, courtCost, addons, total: courtCost + addons };
  });
  const sum = (pick: (p: CourtPrice) => number) => priced.reduce((s, p) => s + pick(p), 0);
  return { courts: priced, courtCost: sum((p) => p.courtCost), addons: sum((p) => p.addons), total: sum((p) => p.total) };
}

/** "Court 1", "Court 1 & Court 2" */
export const courtNames = (courts: { name: string }[]) => courts.map((c) => c.name).join(' & ');

export const PERIODS: { id: TimePeriod; label: string; range: string; Icon: typeof Sun }[] = [
  { id: 'morning', label: 'Morning', range: '5 AM – 6 PM', Icon: Sun },
  { id: 'evening', label: 'Evening', range: '6 PM – 5 AM', Icon: Moon },
];

export const inputClass = (err: boolean) =>
  cx(
    'w-full rounded-2xl border bg-white px-4 py-3 text-base text-zinc-950 placeholder:text-zinc-400 transition',
    'focus:outline-none focus:ring-4',
    err ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-zinc-200 focus:border-[#15803D] focus:ring-emerald-100'
  );

/** A text-message link to the host with the message already typed. */
export const smsHref = (body: string) => `sms:${COURT_DETAILS.contactNumber}?body=${encodeURIComponent(body)}`;

