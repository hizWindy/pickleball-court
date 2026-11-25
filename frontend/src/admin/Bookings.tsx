import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Check, ChevronDown, ChevronRight, Plus, Search, X } from 'lucide-react';
import { useToday } from '../hooks/useToday';
import { fmtReference, fmtTime, peso } from '../lib/time';
import { adminApi } from './api';
import { ALL, effectiveRange, isFiltered, listQuery, loadPages, pickFilter, type DateRange, type FilterKey, type ListFilters } from './bookingsQuery';
import { useDesk } from './desk';
import { METHOD_LABEL, when } from './format';
import { useNow, useRemote } from './hooks';
import { RowActions } from './QuickActions';
import { Btn, Card, CourtsTag, cx, LabelBadge, Num, SelectInput } from './ui';
import { useQuickActions, type QuickApi } from './useQuickActions';
import type { AdminBooking, StatusCounts } from './types';

interface Chip {
  key: FilterKey;
  label: string;
  count: (c: StatusCounts) => number;
}

// What the host talks about every day: Paid, Late, Done (and Rain delay once one has been called).
const MAIN: Chip[] = [
  { key: 'all', label: 'All', count: (c) => c.all },
  { key: 'paid', label: 'Paid', count: (c) => c.paid },
  { key: 'late', label: 'Late', count: (c) => c.late },
  { key: 'done', label: 'Done', count: (c) => c.done },
  { key: 'rain_delay', label: 'Rain delay', count: (c) => c.rainDelay },
  { key: 'paid_late', label: 'Paid late', count: (c) => c.paidLate },
];
/** Chips that only show up once there is something under them. */
const WHEN_ANY = new Set<FilterKey>(['rain_delay', 'paid_late']);
// Rare states, tucked away. With "All" they cover every booking (expired holds only show here, not under "All").
const MORE: Chip[] = [
  { key: 'held', label: 'Paying now', count: (c) => c.held },
  { key: 'blocked', label: 'Blocked', count: (c) => c.blocked },
  { key: 'rejected', label: 'Rejected', count: (c) => c.rejected },
  { key: 'expired', label: 'Expired', count: (c) => c.expired },
  { key: 'cancelled', label: 'Cancelled', count: (c) => c.cancelled },
];
const MORE_KEYS = new Set<FilterKey>(MORE.map((c) => c.key));
const ALL_KEYS = new Set<FilterKey>([...MAIN, ...MORE].map((c) => c.key));

/** Shortcuts from other screens land on the matching filter. */
function filterFrom(raw: string): FilterKey {
  return ALL_KEYS.has(raw as FilterKey) ? (raw as FilterKey) : 'all';
}

export const BookingsPage: React.FC<{ presetStatus?: { status: string; nonce: number } }> = ({ presetStatus }) => {
  const desk = useDesk();
  const now = useNow();
  const today = useToday();
  const { q: quick, problemDialog } = useQuickActions();
  const [filters, setFilters] = useState<ListFilters>(ALL);
  const [text, setText] = useState('');
  const [paging, setPaging] = useState({ list: '', pages: 1 });
  const [moreOpen, setMoreOpen] = useState(false);

  // A shortcut from another screen (e.g. the Late count on the overview) picks that filter.
  const [seenPreset, setSeenPreset] = useState<number | null>(null);
  if (presetStatus && presetStatus.nonce !== seenPreset) {
    setSeenPreset(presetStatus.nonce);
    setFilters((f) => pickFilter(f, filterFrom(presetStatus.status)));
  }

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === text.trim() ? f : { ...f, q: text.trim() })), 300);
    return () => clearTimeout(t);
  }, [text]);

  // Enter searches at once; a pasted ref no. or booking code that matches one booking opens it straight away.
  const searchNow = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    const term = text.trim();
    if (e.key !== 'Enter' || !term) return;
    setFilters((f) => ({ ...f, q: term }));
    try {
      const found = await adminApi.list({ q: term, sort: 'created_desc', pageSize: 1 });
      if (found.total === 1) {
        (e.target as HTMLInputElement).blur(); // put the phone keyboard away
        desk.openBooking(found.items[0].code);
      }
    } catch {
      // the list below still shows what matched
    }
  };

  const query = useMemo(() => listQuery(filters, today), [filters, today]);
  // The chip numbers depend on the search, dates and court; the rows also on the chip and sort. "Show more" keeps the
  // list and adds pages; any other change starts again from the first page.
  const countsPart = JSON.stringify([query.q, query.dateFrom, query.dateTo, query.courtId]);
  const listPart = JSON.stringify(query);
  const pages = paging.list === listPart ? paging.pages : 1;
  const { data: onHand, dataKey, error, loading } = useRemote(
    JSON.stringify(['bookings', countsPart, listPart, pages]),
    () => loadPages(query, pages, adminApi.list), // a quiet refresh reloads just the pages on screen
    { intervalMs: 90000, version: desk.refreshKey, keepPrevious: true }
  );
  // The last result stays on hand while a new one loads (or fails), but it must never pass for this filter, like a Late
  // list under the All chip. Rows are only kept for "Show more" (same list, fewer pages); numbers only for the same dates.
  const [, onHandCounts, onHandList] = dataKey ? (JSON.parse(dataKey) as string[]) : [];
  const data = onHand && onHandList === listPart ? onHand : null;
  const counts = onHand && onHandCounts === countsPart ? onHand.counts : undefined;

  const items = data?.items ?? null;
  const range = effectiveRange(filters);
  const filtered = isFiltered(filters);
  const setRange = (next: DateRange) => setFilters((f) => ({ ...f, range: next }));
  const setCourtId = (next: string) => setFilters((f) => ({ ...f, courtId: next }));
  const clear = () => {
    setFilters(ALL);
    setText('');
  };
  const pick = (next: FilterKey) => {
    setFilters((f) => pickFilter(f, next));
    if (next === 'all') setText(''); // "All" is everything: the search goes too
    if (MORE_KEYS.has(next)) setMoreOpen(true);
  };
  const status = filters.filter;

  const moreSelected = MORE.find((c) => c.key === status);
  const showMore = moreOpen || !!moreSelected;
  const moreTotal = counts ? MORE.reduce((n, c) => n + c.count(counts), 0) : 0;

  const chipClass = (on: boolean, tone: 'plain' | 'amber' = 'plain') =>
    cx(
      'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold ring-1 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]',
      on ? 'bg-zinc-950 text-white ring-zinc-950' : tone === 'amber' ? 'bg-amber-50 text-amber-900 ring-amber-300 hover:bg-amber-100' : 'bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50'
    );
  const chip = (c: Chip, tone: 'plain' | 'amber' = 'plain') => {
    const n = counts ? c.count(counts) : null;
    const on = status === c.key;
    return (
      <button key={c.key} type="button" role="tab" aria-selected={on} onClick={() => pick(c.key)} className={chipClass(on, tone)}>
        {c.label}
        {n !== null && <span className={cx('tabular-nums', on ? 'text-zinc-400' : tone === 'amber' ? 'text-amber-700' : 'text-zinc-400')}>{n}</span>}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">Bookings</h1>
          <p className="mt-0.5 text-sm text-zinc-500">{data ? `${data.total} ${data.total === 1 ? 'booking' : 'bookings'}${filtered ? ' match' : ''}` : ' '}</p>
        </div>
        <div className="hidden sm:block">
          <Btn variant="primary" onClick={() => desk.addBooking()}>
            <Plus className="h-4 w-4" /> Add booking
          </Btn>
        </div>
      </div>

      <div className="sticky top-14 z-20 -mx-4 space-y-3 border-b border-zinc-200/80 bg-[#F6F8FA]/95 px-4 pb-3 pt-2 backdrop-blur sm:mx-0 sm:rounded-b-2xl sm:px-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={searchNow}
            placeholder="Search name, phone, booking code or ref no."
            aria-label="Search bookings"
            enterKeyHint="search"
            className="h-12 w-full rounded-xl border border-zinc-300 bg-white pl-10 pr-10 text-base placeholder:text-zinc-400 focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-emerald-200 sm:text-sm"
          />
          {text && (
            <button type="button" onClick={() => setText('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Filter bookings">
          {MAIN.map((c) => {
            // Rain delay and Paid late only show up once there is one to look at.
            if (WHEN_ANY.has(c.key) && counts && !c.count(counts) && status !== c.key) return null;
            return chip(c, c.key === 'paid_late' ? 'amber' : 'plain');
          })}
          <button type="button" aria-expanded={showMore} aria-controls="more-filters" onClick={() => setMoreOpen((o) => !o)} className={chipClass(!!moreSelected)}>
            {moreSelected ? moreSelected.label : 'More'}
            {!moreSelected && moreTotal > 0 && <span className="tabular-nums text-zinc-400">{moreTotal}</span>}
            <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', showMore && 'rotate-180')} />
          </button>
        </div>
        {showMore && (
          <div id="more-filters" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Other states">
            {MORE.map((c) => chip(c))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <SelectInput aria-label="Show bookings from" value={range} disabled={!!filters.q} onChange={(e) => setRange(e.target.value as DateRange)}>
          <option value="all">All dates</option>
          <option value="upcoming">Today &amp; later</option>
          <option value="past">Earlier dates</option>
        </SelectInput>
        <SelectInput aria-label="Court" value={filters.courtId} onChange={(e) => setCourtId(e.target.value)}>
          <option value="">All courts</option>
          {desk.config?.courts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectInput>
      </div>

      {error && !data && (
        <Card className="p-5 text-sm text-zinc-600">
          {error.message} <Btn size="sm" className="ml-2" onClick={desk.refresh}>Try again</Btn>
        </Card>
      )}

      {!data && !error && (
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[5.5rem] animate-pulse rounded-2xl bg-zinc-100" />
          ))}
        </div>
      )}

      {items && items.length === 0 && (
        <Card className="px-5 py-12 text-center">
          <p className="font-heading text-lg font-bold text-zinc-900">{filtered ? 'Nothing matches that' : 'No bookings yet'}</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-zinc-500">
            {filtered ? 'Try another search, or look at all dates and statuses.' : 'Online bookings and walk-ins you add will show up here.'}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {range !== 'all' && <Btn onClick={() => setRange('all')}>Show all dates</Btn>}
            {filtered && <Btn onClick={clear}>Clear filters</Btn>}
            <Btn variant="primary" onClick={() => desk.addBooking()}>
              <Plus className="h-4 w-4" /> Add booking
            </Btn>
          </div>
        </Card>
      )}

      {data && items && items.length > 0 && (
        <>
          <ul className={cx('space-y-2.5 transition-opacity', loading && 'opacity-80')}>
            {items.map((b) => (
              <li key={b.code}>
                <Row b={b} now={now} q={quick} onOpen={() => desk.openBooking(b.code)} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col items-center gap-2 pb-2 pt-1">
            <span className="text-xs text-zinc-500">
              Showing {data.items.length} of {data.total}
            </span>
            {data.items.length < data.total && (
              <Btn onClick={() => setPaging({ list: listPart, pages: pages + 1 })} loading={loading}>
                Show more
              </Btn>
            )}
          </div>
        </>
      )}
      {problemDialog}
    </div>
  );
};

/** The small grey line under the badge: how they paid, who they are, or what is happening. */
function detailLine(b: AdminBooking): string {
  if (b.source === 'blocked') return 'Court blocked';
  if (b.label === 'late' && b.releasedAt) return `Court released at ${fmtTime(b.releasedAt)}`;
  if (b.label === 'late' && b.lateAt) return `Late since ${fmtTime(b.lateAt)} · court still theirs`;
  if (b.label === 'rain_delay') return b.holdsCourt ? 'Waiting to pick a new time · hours closed' : 'Waiting to pick a new time · hours open';
  if (b.label === 'paid_late') return 'Paid after the time ran out · move or refund';
  return [b.source === 'walk_in' && 'Walk-in', b.customPrice && 'Custom price', METHOD_LABEL[b.paymentMethod], b.customerPhone].filter((p) => p && p !== '—').join(' · ');
}

const Row: React.FC<{ b: AdminBooking; now: number; q: QuickApi; onOpen: () => void }> = ({ b, now, q, onOpen }) => {
  const blocked = b.source === 'blocked';
  const late = b.label === 'late';

  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-2xl border bg-white transition',
        'hover:border-zinc-300 hover:shadow-sm',
        // A Late booking that still holds its court needs a decision (solid); one that was released is just an outline.
        late ? (b.holdsCourt ? 'border-amber-400 bg-amber-50/60' : 'border-dashed border-amber-400 bg-amber-50/40') : b.paidLate ? 'border-red-300 bg-red-50/40' : 'border-zinc-200',
        blocked && 'bg-[repeating-linear-gradient(135deg,var(--color-white),var(--color-white)_8px,#f4f4f5_8px,#f4f4f5_16px)]'
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 p-4 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#15803D]"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              {blocked && <Ban className="h-4 w-4 shrink-0 text-zinc-500" />}
              <span className="truncate font-heading text-base font-bold text-zinc-950">{b.customerName}</span>
            </span>
            {!blocked && <Num className="shrink-0 text-base text-zinc-950">{peso(b.total)}</Num>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-600">
            <span className="font-medium text-zinc-800">{when(b)}</span>
            <span className="text-zinc-300">•</span>
            <span>{b.courtName}</span>
            <CourtsTag linked={b.linked} />
          </span>
          {!blocked && (
            <span className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] tracking-wide text-zinc-500">
              <span>{b.code}</span>
              {b.referenceNumber && (
                <>
                  <span className="text-zinc-300">•</span>
                  <span>Ref {fmtReference(b.referenceNumber)}</span>
                </>
              )}
            </span>
          )}
          <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <LabelBadge label={b.label} />
            <span className="text-xs text-zinc-500">{detailLine(b)}</span>
            {b.arrivedAt && !blocked && (
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-700">
                <Check className="h-3 w-3" strokeWidth={3} /> arrived
              </span>
            )}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-500" />
      </button>
      <RowActions b={b} q={q} now={now} className="px-4 pb-4" />
    </div>
  );
};
