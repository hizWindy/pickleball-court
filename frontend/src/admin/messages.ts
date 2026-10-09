import { fmtDate, manilaYmd } from '../lib/time';
import { firstName, hourSpan } from './format';
import type { AdminBooking } from './types';

/** "Sat Oct 10, 3-5 PM": plain ASCII so the text stays one friendly message on any phone. */
export function plainWhen(b: Pick<AdminBooking, 'startAt' | 'hour' | 'hours'>): string {
  const day = fmtDate(manilaYmd(b.startAt)).replace(',', '');
  return `${day}, ${hourSpan(b.hour, b.hours).replace(/ – /g, '-')}`;
}

/** Where a rain-delayed guest picks a new time. Free, and it doesn't use their one reschedule. */
export const rescheduleLink = (code: string) => `${window.location.origin}/?reschedule=${code}`;

/** The message the host sends to someone whose booking was moved because of rain. */
export function rainMessage(b: AdminBooking): string {
  return (
    `Hi ${firstName(b.customerName)}! It's raining, so your ${b.courtName} booking on ${plainWhen(b)} at HousePickle Club was moved. ` +
    `Nothing is lost: pick your new time here (free, doesn't use your one reschedule): ${rescheduleLink(b.code)}`
  );
}

/** A friendly nudge for a guest whose booking went Late. */
export function lateMessage(b: AdminBooking): string {
  return `Hi ${firstName(b.customerName)}! HousePickle Club here. Your ${b.courtName} booking on ${plainWhen(b)} has started. Are you still coming?`;
}
