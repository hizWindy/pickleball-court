import { fmtDate, hourLabel } from '../lib/time';
import type { AdminBooking, AdminLabel, AdminPayment } from './types';

export type { AdminLabel };
export type Tone = 'green' | 'amber' | 'red' | 'zinc' | 'blue' | 'dark';

/**
 * The host's words for a booking (players see different wording on their pass). Day to day there are
 * only three: Paid, Late and Done, plus Rain delay when one has been called. The rest are rare.
 */
export const LABEL: Record<AdminLabel, { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'green' },
  late: { label: 'Late', tone: 'amber' },
  done: { label: 'Done', tone: 'zinc' },
  rain_delay: { label: 'Rain delay', tone: 'blue' },
  needs_check: { label: 'Needs check', tone: 'amber' },
  awaiting: { label: 'Paying now', tone: 'zinc' },
  blocked: { label: 'Blocked', tone: 'zinc' },
  rejected: { label: 'Rejected', tone: 'zinc' },
  expired: { label: 'Expired', tone: 'zinc' },
  cancelled: { label: 'Cancelled', tone: 'zinc' },
};

export const PROVIDER_LABEL: Record<string, string> = { gcash: 'GCash', gotyme: 'GoTyme', maya: 'Maya', other: 'Another bank' };

export const METHOD_LABEL: Record<AdminPayment, string> = { gcash: 'GCash', gotyme: 'GoTyme', cash: 'Cash', none: '—' };

/** Play-day order: the club's day runs 6 AM to 5:59 AM. */
export const PLAY_HOURS = [...Array.from({ length: 18 }, (_, i) => i + 6), ...Array.from({ length: 6 }, (_, i) => i)];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const isNight = (hour: number) => hour >= 22 || hour < 6;

const manilaHourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hourCycle: 'h23' });
/** Clock hour (0-23, Manila) of an instant. */
export const manilaHour = (ms: number) => Number(manilaHourFmt.format(ms));

/** "7:00 AM" */
export const clock = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;

/** "7 – 9 PM" or "11 PM – 2 AM" */
export function hourSpan(hour: number, hours: number): string {
  const start = hourLabel(hour);
  const end = hourLabel((hour + hours) % 24);
  const [startNum, startPeriod] = start.split(' ');
  const endPeriod = end.split(' ')[1];
  return startPeriod === endPeriod ? `${startNum} – ${end}` : `${start} – ${end}`;
}

/** "Sat, Oct 10 · 7 – 9 PM" */
export function when(b: Pick<AdminBooking, 'playDate' | 'hour' | 'hours'>): string {
  return `${fmtDate(b.playDate)} · ${hourSpan(b.hour, b.hours)}`;
}

const stampFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** "Oct 10, 7:02 PM" */
export const stamp = (iso: string) => stampFmt.format(new Date(iso));

export function ago(iso: string, nowMs: number): string {
  const mins = Math.round((nowMs - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

/** "in 2 h", "in 35 min" for a session start. */
export function startsIn(iso: string, nowMs: number): string {
  const mins = Math.round((Date.parse(iso) - nowMs) / 60000);
  if (mins <= 0) return 'under way';
  if (mins < 60) return `in ${mins} min`;
  if (mins < 24 * 60) return `in ${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
  return `in ${Math.round(mins / 1440)} d`;
}

export function delta(cur: number, prev: number): { pct: number; up: boolean } | null {
  if (prev <= 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { pct: Math.abs(pct), up: pct >= 0 };
}

export const compactPeso = (n: number) =>
  n >= 10000 ? `₱${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '')}k` : `₱${n.toLocaleString('en-PH')}`;

// ── Reaching a guest ──────────────────────────────────────────────────────────
/** `tel:` link; spaces in the number would break it. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

const isApple = () => typeof navigator !== 'undefined' && (/iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** `sms:` link with the message filled in. iPhone and iPad want `&body=`, everything else `?body=`. */
export function smsHref(phone: string, body: string): string {
  const number = phone.replace(/[^\d+]/g, '');
  return `sms:${number}${isApple() ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

// ── Late, arrived, restore ────────────────────────────────────────────────────
/**
 * How long the host can still put this booking back, in ms. `null` means they can't (Restore is simply
 * not shown), `Infinity` means no deadline (a rain delay can always be undone).
 */
export function restoreLeft(b: Pick<AdminBooking, 'restorable' | 'restoreUntil'>, nowMs: number): number | null {
  if (!b.restorable) return null;
  if (!b.restoreUntil) return Infinity;
  const left = Date.parse(b.restoreUntil) - nowMs;
  return left > 0 ? left : null;
}

/** The server allows marking arrival any time before the end; the desk offers it when the session is close or under way. */
export const ARRIVAL_LEAD_MS = 30 * 60_000;
export const arrivable = (b: Pick<AdminBooking, 'canMarkArrived' | 'startAt'>, nowMs: number) =>
  b.canMarkArrived && Date.parse(b.startAt) - nowMs <= ARRIVAL_LEAD_MS;
