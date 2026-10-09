import { Moon, Sun, Sunrise, Sunset } from 'lucide-react';
import { COURT_DETAILS } from '../../data/mockData';
import type { TimePeriod } from '../../types';
import { cx } from './ui';

export const PERIODS: { id: TimePeriod; label: string; range: string; Icon: typeof Sun }[] = [
  { id: 'morning', label: 'Morning', range: '6 AM – 12 PM', Icon: Sunrise },
  { id: 'afternoon', label: 'Afternoon', range: '12 – 5 PM', Icon: Sun },
  { id: 'evening', label: 'Evening', range: '5 – 10 PM', Icon: Sunset },
  { id: 'night_owl', label: 'Night Owl', range: '10 PM – 6 AM', Icon: Moon },
];

export const inputClass = (err: boolean) =>
  cx(
    'w-full rounded-2xl border bg-white px-4 py-3 text-base text-zinc-950 placeholder:text-zinc-400 transition',
    'focus:outline-none focus:ring-4',
    err ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-zinc-200 focus:border-[#15803D] focus:ring-emerald-100'
  );

/** A text-message link to the host with the message already typed. */
export const smsHref = (body: string) => `sms:${COURT_DETAILS.contactNumber}?body=${encodeURIComponent(body)}`;

