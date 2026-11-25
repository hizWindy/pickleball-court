import { fmtDate, manilaYmd } from '../lib/time';
import { firstName, hourSpan } from './format';
import type { AdminBooking } from './types';

/** "Sat Oct 10, 3-5 PM": plain ASCII so the text stays one friendly message on any phone. */
export function plainWhen(b: Pick<AdminBooking, 'startAt' | 'hour' | 'hours'>): string {
  const day = fmtDate(manilaYmd(b.startAt)).replace(',', '');
  return `${day}, ${hourSpan(b.hour, b.hours).replace(/ – /g, '-')}`;
}

/** Where a rain-delayed guest picks a new time (it opens "Check my booking"). Free. */
export const rescheduleLink = (code: string) => `${window.location.origin}/?reschedule=${code}`;

/** The courts of the booking as the player knows it: "Court 2", or "Court 1 & Court 2" for both courts at once. */
export const courtsOf = (b: Pick<AdminBooking, 'courtName' | 'linked'>) => [b.courtName, ...b.linked.map((l) => l.courtName)].sort().join(' & ');

/** The code the player has: for both courts at once, the first court's (the one the payment is on). */
export const playerCode = (b: Pick<AdminBooking, 'code' | 'paymentCode'>) => b.paymentCode ?? b.code;

/** The message the host sends to someone whose booking was moved because of rain. */
export function rainMessage(b: AdminBooking): string {
  return (
    `Hi ${firstName(b.customerName)}! It's raining, so your ${courtsOf(b)} booking on ${plainWhen(b)} at HousePickle Club was moved. ` +
    `Nothing is lost: pick your new time here (it's free): ${rescheduleLink(playerCode(b))}`
  );
}

/** A friendly nudge for a guest whose booking went Late. */
export function lateMessage(b: AdminBooking): string {
  return `Hi ${firstName(b.customerName)}! HousePickle Club here. Your ${courtsOf(b)} booking on ${plainWhen(b)} has started. Are you still coming?`;
}

/** For a guest whose payment came in after their time ran out, when someone else had taken the slot. */
export function paidLateMessage(b: AdminBooking): string {
  return (
    `Hi ${firstName(b.customerName)}! HousePickle Club here. We got your payment for ${courtsOf(b)} on ${plainWhen(b)}, ` +
    `but your time had run out and someone else booked that slot first. Would you like another time, or a refund?`
  );
}
