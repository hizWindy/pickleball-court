import { addDays } from '../lib/time';
import type { AdminBooking, AdminBookingList, ListQuery } from './types';

/** Rows the list grows by with each "Show more". */
export const PAGE = 25;
/** The most rows the server sends in one answer (PAGE_SIZE_MAX in backend/app/admin_service.py). */
export const SERVER_PAGE_MAX = 200;

/** A chip: "All", a label (the word on a booking) or one of the rare statuses tucked under More. */
export type FilterKey = 'all' | 'paid' | 'late' | 'done' | 'rain_delay' | 'blocked' | 'held' | 'rejected' | 'expired' | 'cancelled';
/** The date box. */
export type DateRange = 'upcoming' | 'past' | 'all';

export type LabelKey = 'paid' | 'late' | 'done' | 'rain_delay' | 'blocked';
const LABELS = new Set<FilterKey>(['paid', 'late', 'done', 'rain_delay', 'blocked']);
const STATUSES = new Set<FilterKey>(['held', 'rejected', 'expired', 'cancelled']);
export const isLabel = (key: FilterKey): key is LabelKey => LABELS.has(key);

export interface ListFilters {
  filter: FilterKey;
  range: DateRange;
  courtId: string;
  /** The search, as sent (trimmed). */
  q: string;
}

/** What the list opens on, and what tapping "All" goes back to: every booking, every date, both courts. */
export const ALL: ListFilters = { filter: 'all', range: 'all', courtId: '', q: '' };

/** Tapping a chip. "All" means everything, so it also clears the search, the court and the dates. */
export function pickFilter(current: ListFilters, next: FilterKey): ListFilters {
  return next === 'all' ? { ...ALL } : { ...current, filter: next };
}

/** A search looks at every date; the date box is set aside (and shown as "All dates") while there is one. */
export const effectiveRange = (f: ListFilters): DateRange => (f.q ? 'all' : f.range);

function sortFor(f: ListFilters): NonNullable<ListQuery['sort']> {
  if (f.filter === 'paid' || f.filter === 'rain_delay') return 'start_asc'; // what is coming up next
  if (f.filter === 'late' || f.filter === 'done') return 'start_desc'; // what just happened
  if (f.q) return 'created_desc'; // the latest bookings that match
  const range = effectiveRange(f);
  if (range === 'upcoming') return 'start_asc';
  if (range === 'past') return 'start_desc';
  return 'upcoming_first'; // still to play (soonest first), then what has ended (latest first)
}

/**
 * What the server is asked for. The chip numbers are counted for the same search, court and dates as the list, so the
 * number on a chip is exactly what tapping it lists.
 */
export function listQuery(f: ListFilters, today: string): ListQuery {
  const range = effectiveRange(f);
  return {
    q: f.q || undefined,
    status: STATUSES.has(f.filter) ? f.filter : undefined,
    label: isLabel(f.filter) ? f.filter : undefined,
    courtId: f.courtId || undefined,
    sort: sortFor(f),
    dateFrom: range === 'upcoming' ? today : undefined,
    dateTo: range === 'past' ? addDays(today, -1) : undefined,
  };
}

/** Anything narrower than "All"? (Then an empty list says "Nothing matches that".) */
export const isFiltered = (f: ListFilters) => f.filter !== 'all' || !!f.q || !!f.courtId || effectiveRange(f) !== 'all';

/**
 * The first `pages` pages of a list, in as few requests as the server's cap allows. Used for the first page, for "Show
 * more" and for the quiet refreshes, which reload just the pages on screen. A booking that moved between two requests
 * is never shown twice.
 */
export async function loadPages(
  query: ListQuery,
  pages: number,
  list: (q: ListQuery) => Promise<AdminBookingList>
): Promise<AdminBookingList> {
  const want = Math.max(1, pages) * PAGE;
  const size = Math.min(want, SERVER_PAGE_MAX);
  const parts = await Promise.all(Array.from({ length: Math.ceil(want / size) }, (_, i) => list({ ...query, page: i + 1, pageSize: size })));
  const seen = new Set<string>();
  const items: AdminBooking[] = [];
  for (const b of parts.flatMap((p) => p.items)) {
    if (seen.has(b.code)) continue;
    seen.add(b.code);
    items.push(b);
  }
  return { ...parts[0], items: items.slice(0, want), page: 1, pageSize: want };
}
