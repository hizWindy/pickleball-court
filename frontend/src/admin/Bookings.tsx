import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Ban, Check, ChevronDown, ChevronRight, Plus, Search, X } from 'lucide-react';
import { addDays, fmtTime, peso } from '../lib/time';
import { adminApi } from './api';
import { useDesk } from './desk';
import { ago, METHOD_LABEL, when } from './format';
import { useNow, useRemote } from './hooks';
import { RowActions } from './QuickActions';
import { Btn, Card, cx, LabelBadge, Num, SelectInput } from './ui';
import { useQuickActions, type QuickApi } from './useQuickActions';
import type { AdminBooking, StatusCounts } from './types';

const PAGE = 25;
const MAX_PAGES = 8;

type FilterKey = 'all' | 'paid' | 'late' | 'done' | 'rain_delay' | 'needs_check' | 'held' | 'rejected' | 'expired' | 'cancelled';
type Time = 'upcoming' | 'past' | 'all';

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
];
// Payments waiting for the host's eyes (a receipt that fell short, or one that confirmed on its own and hasn't been looked at).
const CHECK: Chip = { key: 'needs_check', label: 'Needs check', count: (c) => c.toReview };
// Rare states, tucked away.
const MORE: Chip[] = [
  { key: 'held', label: 'Paying now', count: (c) => c.held },
  { key: 'rejected', label: 'Rejected', count: (c) => c.rejected },
  { key: 'expired', label: 'Expired', count: (c) => c.expired },
  { key: 'cancelled', label: 'Cancelled', count: (c) => c.cancelled },
];
const MORE_KEYS = new Set<FilterKey>(MORE.map((c) => c.key));
const LABEL_KEYS = new Set<FilterKey>(['paid', 'late', 'done', 'rain_delay']);
const ALL_KEYS = new Set<FilterKey>([...MAIN, CHECK, ...MORE].map((c) => c.key));

/** Shortcuts from other screens ("flagged", "to_review", …) land on the closest filter. */
function filterFrom(raw: string): FilterKey {
  if (raw === 'to_review' || raw === 'flagged' || raw === 'pending_verification') return 'needs_check';
  return ALL_KEYS.has(raw as FilterKey) ? (raw as FilterKey) : 'all';
}

export const BookingsPage: React.FC<{ presetStatus?: { status: string; nonce: number } }> = ({ presetStatus }) => {
  const desk = useDesk();
  const now = useNow();
  const { q: quick, problemDialog } = useQuickActions();
  const [status, setStatus] = useState<FilterKey>('all');
  const [time, setTime] = useState<Time>('upcoming');
  const [courtId, setCourtId] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [pages, setPages] = useState(1);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (presetStatus) setStatus(filterFrom(presetStatus.status));
  }, [presetStatus]);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => setPages(1), [status, time, courtId, q]);

  // Things that still need the host's attention are shown whatever their date.
  const ignoreTime = !!q || status === 'needs_check' || status === 'held' || LABEL_KEYS.has(status);
  const today = desk.config?.today;
  const query = useMemo(() => {
    const soonestFirst = status === 'needs_check' || status === 'paid' || status === 'rain_delay';
    const latestFirst = status === 'late' || status === 'done';
    return {
      q,
      status: MORE_KEYS.has(status) ? status : 'all',
      label: LABEL_KEYS.has(status) ? (status as 'paid' | 'late' | 'done' | 'rain_delay') : undefined,
      review: status === 'needs_check' ? ('unchecked' as const) : undefined,
      courtId,
      pageSize: PAGE * pages,
      sort: soonestFirst
        ? ('start_asc' as const)
        : latestFirst
          ? ('start_desc' as const)
          : ignoreTime
            ? ('created_desc' as const)
            : time === 'upcoming'
              ? ('start_asc' as const)
              : ('start_desc' as const),
      dateFrom: !ignoreTime && time === 'upcoming' ? today : undefined,
      dateTo: !ignoreTime && time === 'past' && today ? addDays(today, -1) : undefined,
    };
  }, [q, status, courtId, pages, ignoreTime, time, today]);
  const key = JSON.stringify(query);
  const { data, error, loading } = useRemote(`bookings-${key}`, () => adminApi.list(query), { intervalMs: 30000, version: desk.refreshKey, enabled: !!today });

  // Payments that fell short come first: they aren't confirmed until the host decides.
  const items = useMemo(() => {
    if (!data) return null;
    if (status !== 'needs_check') return data.items;
    return [...data.items].sort((a, b) => Number(b.status === 'pending_verification') - Number(a.status === 'pending_verification'));
  }, [data, status]);

  const filtered = status !== 'all' || !!q || !!courtId || (!ignoreTime && time !== 'all');
  const clear = () => {
    setStatus('all');
    setText('');
    setCourtId('');
    setTime('all');
  };
  const pick = (next: FilterKey) => {
    setStatus(next);
    if (MORE_KEYS.has(next)) setMoreOpen(true);
  };

  const counts = data?.counts;
  const moreSelected = MORE.find((c) => c.key === status);
  const showMore = moreOpen || !!moreSelected;
  const moreTotal = counts ? MORE.reduce((n, c) => n + c.count(counts), 0) : 0;
  const decisions = counts?.pendingVerification ?? 0;

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

      <div className="sticky top-14 z-20 -mx-4 space-y-3 border-b border-zinc-200/80 bg-[#F7F6F1]/95 px-4 pb-3 pt-2 backdrop-blur sm:mx-0 sm:rounded-b-2xl sm:px-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search name, phone or code"
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
          {chip(MAIN[0])}
          {/* Quiet, and only there when something needs a look. Right after "All" so it isn't off-screen on a phone. */}
          {counts && (CHECK.count(counts) > 0 || status === CHECK.key) && chip(CHECK, 'amber')}
          {MAIN.slice(1).map((c) => {
            // Rain delay only shows up once there is one to look at.
            if (c.key === 'rain_delay' && counts && !c.count(counts) && status !== c.key) return null;
            return chip(c);
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
        <SelectInput aria-label="Show bookings from" value={ignoreTime ? 'all' : time} disabled={ignoreTime} onChange={(e) => setTime(e.target.value as Time)}>
          <option value="upcoming">Today &amp; later</option>
          <option value="past">Earlier dates</option>
          <option value="all">All dates</option>
        </SelectInput>
        <SelectInput aria-label="Court" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
          <option value="">Both courts</option>
          {desk.config?.courts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectInput>
      </div>

      {decisions > 0 && status !== 'needs_check' && (
        <button
          type="button"
          onClick={() => pick('needs_check')}
          className="group flex w-full items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-left transition hover:bg-amber-100/70 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
          <span className="min-w-0 flex-1 text-sm font-semibold text-amber-950">
            {decisions === 1 ? '1 payment is waiting for your decision' : `${decisions} payments are waiting for your decision`}
            <span className="block text-xs font-medium text-amber-900/80">Not confirmed yet, usually because the receipt is less than the total.</span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-amber-800 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}

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
          <div className="mt-4 flex justify-center gap-2">
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
            {data.items.length < data.total && pages < MAX_PAGES && (
              <Btn onClick={() => setPages((p) => p + 1)} loading={loading}>
                Show more
              </Btn>
            )}
            {data.items.length < data.total && pages >= MAX_PAGES && <span className="text-xs text-zinc-400">Narrow the search to see the rest.</span>}
          </div>
        </>
      )}
      {problemDialog}
    </div>
  );
};

/** The small grey line under the badge: how they paid, who they are, or what is happening. */
function detailLine(b: AdminBooking, now: number): string {
  if (b.source === 'blocked') return 'Court blocked';
  if (b.label === 'late' && b.lateAt) return `Went Late at ${fmtTime(b.lateAt)}`;
  if (b.label === 'rain_delay') return 'Waiting to pick a new time';
  if (b.needsReview && b.submittedAt) return `Paid ${ago(b.submittedAt, now)} · ${b.proofType === 'receipt' ? 'receipt' : 'typed reference'}`;
  return [b.source === 'walk_in' && 'Walk-in', b.customPrice && 'Custom price', METHOD_LABEL[b.paymentMethod], b.customerPhone].filter((p) => p && p !== '—').join(' · ');
}

const Row: React.FC<{ b: AdminBooking; now: number; q: QuickApi; onOpen: () => void }> = ({ b, now, q, onOpen }) => {
  const blocked = b.source === 'blocked';
  const checking = b.status === 'pending_verification';
  const flagged = (b.needsReview && b.reviewFlags.length > 0) || checking;
  const review = b.needsReview;
  const late = b.label === 'late';
  const lead = b.reviewFlags[0];

  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-2xl border bg-white transition',
        'hover:border-zinc-300 hover:shadow-sm',
        late ? 'border-dashed border-amber-400 bg-amber-50/40' : flagged ? 'border-amber-300' : 'border-zinc-200',
        blocked && 'bg-[repeating-linear-gradient(135deg,var(--color-white),var(--color-white)_8px,#f4f4f5_8px,#f4f4f5_16px)]'
      )}
    >
      {review && <span className={cx('absolute inset-y-0 left-0 w-1', flagged ? 'bg-amber-400' : 'bg-emerald-400')} aria-hidden />}
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
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <LabelBadge label={b.label} />
            <span className="text-xs text-zinc-500">{detailLine(b, now)}</span>
            {b.arrivedAt && !blocked && (
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-700">
                <Check className="h-3 w-3" strokeWidth={3} /> arrived
              </span>
            )}
          </span>
          {review && lead && (
            <span className={cx('mt-2 flex items-start gap-1.5 text-xs font-medium', lead.code === 'amount_short' ? 'text-red-700' : 'text-amber-800')}>
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                {checking && <strong className="font-bold">Not confirmed. </strong>}
                {lead.message}
                {b.reviewFlags.length > 1 && <span className="text-amber-700/80"> +{b.reviewFlags.length - 1} more</span>}
              </span>
            </span>
          )}
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-500" />
      </button>
      <RowActions b={b} q={q} now={now} className="px-4 pb-4" />
    </div>
  );
};
