import { playDayStartMs } from '../lib/time';

const HOUR_MS = 3_600_000;
/** A play day is always 24 hours: the Philippines has no daylight saving time. */
export const DAY_ROWS = 24;

/** Where something sits on a day's grid, in hour rows from the top (row 0 is 5 AM). */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * The rows a booking covers on the Schedule for `playDate`, clipped to that play day (5 AM to 5 AM).
 * `null` when none of it falls on that day.
 */
export function schedulePosition(startAt: string, endAt: string, playDate: string): Span | null {
  const dayStart = playDayStartMs(playDate);
  const top = Math.max(0, (Date.parse(startAt) - dayStart) / HOUR_MS);
  const bottom = Math.min(DAY_ROWS, (Date.parse(endAt) - dayStart) / HOUR_MS);
  return bottom > top ? { top, bottom } : null;
}

/** How far down the day the "Now" line sits, in rows, or `null` when the moment isn't on that play day. */
export function nowOffset(nowMs: number, playDate: string): number | null {
  const rows = (nowMs - playDayStartMs(playDate)) / HOUR_MS;
  return rows >= 0 && rows < DAY_ROWS ? rows : null;
}

/** Court-hours booked on a play day, counting only the bookings `takesCourt` says are using a court. */
export function courtHoursBooked<B extends { startAt: string; endAt: string }>(bookings: B[], playDate: string, takesCourt: (b: B) => boolean): number {
  return bookings.reduce((sum, b) => {
    if (!takesCourt(b)) return sum;
    const span = schedulePosition(b.startAt, b.endAt, playDate);
    return span ? sum + span.bottom - span.top : sum;
  }, 0);
}
