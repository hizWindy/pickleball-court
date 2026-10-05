import { serverNowMs } from './api';
import type { CourtConfig, SlotAvailability } from '../types';

/** An hour that still has at least one free court. */
export interface OpenPick {
  date: string;
  slot: SlotAvailability;
  freeCourts: CourtConfig[];
}

export const isNightHour = (hour: number) => hour >= 22 || hour < 6;

export function toPicks(date: string, slots: SlotAvailability[] | undefined, courts: CourtConfig[]): OpenPick[] {
  return (slots ?? [])
    .map((slot) => ({ date, slot, freeCourts: courts.filter((c) => slot.courts[c.id] === 'available') }))
    .filter((p) => p.freeCourts.length > 0);
}

export function dayLabel(date: string, today: string, hour: number): string {
  const night = isNightHour(hour);
  if (date === today) return night ? 'Tonight' : 'Today';
  return night ? 'Tomorrow night' : 'Tomorrow';
}

/** Whole minutes until the slot starts, on the server's clock. */
export const minutesUntil = (startAt: string) => Math.round((Date.parse(startAt) - serverNowMs()) / 60000);

/** Free hours left in today's prime time (5-10 PM), out of the hours that haven't passed yet. */
export function primeTime(slots: SlotAvailability[] | undefined, courts: CourtConfig[]) {
  const states = (slots ?? []).filter((s) => s.period === 'evening').flatMap((s) => courts.map((c) => s.courts[c.id]));
  return { free: states.filter((s) => s === 'available').length, total: states.filter((s) => s !== 'past').length };
}
