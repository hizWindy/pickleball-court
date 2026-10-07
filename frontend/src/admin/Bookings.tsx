import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, ChevronRight, Plus, Search, X } from 'lucide-react';
import { addDays, peso } from '../lib/time';
import { adminApi } from './api';
import { useDesk } from './desk';
import { ago, METHOD_LABEL, when } from './format';
import { useNow, useRemote } from './hooks';
import { Btn, Card, cx, Num, SelectInput, StatusPill, Tag } from './ui';
import type { AdminBooking, StatusCounts } from './types';

const PAGE = 25;
const MAX_PAGES = 8;

type StatusKey = 'all' | 'to_review' | 'flagged' | 'pending_verification' | 'confirmed' | 'held' | 'rejected' | 'expired' | 'cancelled';
type Time = 'upcoming' | 'past' | 'all';

// "To review" and "Looks off" are paid bookings that were confirmed automatically and not looked at yet.
const CHIPS: { key: StatusKey; label: string; count: (c: StatusCounts) => number; hideWhenEmpty?: boolean }[] = [
  { key: 'all', label: 'All', count: (c) => c.all },
  { key: 'to_review', label: 'To review', count: (c) => c.toReview },
  { key: 'flagged', label: 'Looks off', count: (c) => c.flagged },
  { key: 'pending_verification', label: 'Needs check', count: (c) => c.pendingVerification, hideWhenEmpty: true },
  { key: 'confirmed', label: 'Confirmed', count: (c) => c.confirmed },
  { key: 'held', label: 'Paying now', count: (c) => c.held },
  { key: 'rejected', label: 'Rejected', count: (c) => c.rejected },
  { key: 'expired', label: 'Expired', count: (c) => c.expired },
  { key: 'cancelled', label: 'Cancelled', count: (c) => c.cancelled },
];

export const BookingsPage: React.FC<{ presetStatus?: { status: string; nonce: number } }> = ({ presetStatus }) => {
  const desk = useDesk();
  const now = useNow();
  const [status, setStatus] = useState<StatusKey>('all');
  const [time, setTime] = useState<Time>('upcoming');
  const [courtId, setCourtId] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [pages, setPages] = useState(1);

  useEffect(() => {
    if (presetStatus) setStatus(presetStatus.status as StatusKey);
  }, [presetStatus]);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => setPages(1), [status, time, courtId, q]);

  // Things that still need the host's attention are shown whatever their date.
  const reviewing = status === 'to_review' || status === 'flagged' || status === 'pending_verification';
  const ignoreTime = reviewing || status === 'held' || !!q;
  const today = desk.config?.today;
  const query = useMemo(
    () => ({
      q,
      status: status === 'to_review' || status === 'flagged' ? 'all' : status,
      review: status === 'to_review' ? ('unchecked' as const) : status === 'flagged' ? ('flagged' as const) : undefined,
      courtId,
      pageSize: PAGE * pages,
      sort: ignoreTime ? (reviewing ? ('start_asc' as const) : ('created_desc' as const)) : time === 'upcoming' ? ('start_asc' as const) : ('start_desc' as const),
      dateFrom: !ignoreTime && time === 'upcoming' ? today : undefined,
      dateTo: !ignoreTime && time === 'past' && today ? addDays(today, -1) : undefined,
    }),
    [q, status, courtId, pages, ignoreTime, time, today]
  );
  const key = JSON.stringify(query);
  const { data, error, loading } = useRemote(`bookings-${key}`, () => adminApi.list(query), { intervalMs: 30000, version: desk.refreshKey, enabled: !!today });

  const filtered = status !== 'all' || !!q || !!courtId || (!ignoreTime && time !== 'all');
  const clear = () => {
    setStatus('all');
    setText('');
    setCourtId('');
    setTime('all');
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

      <div className="sticky top-14 z-20 -mx-4 space-y-3 border-b border-zinc-200/80 bg-[#FAFCF9]/95 px-4 pb-3 pt-2 backdrop-blur sm:mx-0 sm:rounded-b-2xl sm:px-0">
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

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Filter by status">
          {CHIPS.map((c) => {
            const n = data ? c.count(data.counts) : null;
            const on = status === c.key;
            if (c.hideWhenEmpty && !n && !on) return null;
            const urgent = (c.key === 'flagged' || c.key === 'pending_verification') && !!n;
            const waiting = c.key === 'to_review' && !!n;
            return (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setStatus(c.key)}
                className={cx(
                  'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold ring-1 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]',
                  on
                    ? 'bg-zinc-950 text-white ring-zinc-950'
                    : urgent
                      ? 'bg-amber-50 text-amber-900 ring-amber-300 hover:bg-amber-100'
                      : waiting
                        ? 'bg-emerald-50 text-emerald-900 ring-emerald-200 hover:bg-emerald-100'
                        : 'bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50'
                )}
              >
                {c.key === 'flagged' && <AlertTriangle className="h-3.5 w-3.5" />}
                {c.label}
                {n !== null && <span className={cx('tabular-nums', on ? 'text-zinc-400' : urgent ? 'text-amber-700' : waiting ? 'text-emerald-700' : 'text-zinc-400')}>{n}</span>}
              </button>
            );
          })}
        </div>
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

      {data && data.items.length === 0 && (
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

      {data && data.items.length > 0 && (
        <>
          <ul className={cx('space-y-2.5 transition-opacity', loading && 'opacity-80')}>
            {data.items.map((b) => (
              <li key={b.code}>
                <Row b={b} now={now} onOpen={() => desk.openBooking(b.code)} />
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
    </div>
  );
};

const Row: React.FC<{ b: AdminBooking; now: number; onOpen: () => void }> = ({ b, now, onOpen }) => {
  const blocked = b.source === 'blocked';
  const flagged = (b.needsReview && b.reviewFlags.length > 0) || b.status === 'pending_verification';
  const review = b.needsReview;
  const detail = blocked
    ? 'Court blocked'
    : review && b.submittedAt
      ? `Paid ${ago(b.submittedAt, now)} · ${b.proofType === 'receipt' ? 'receipt' : 'typed reference'}`
      : [METHOD_LABEL[b.paymentMethod], b.customerPhone].filter((p) => p && p !== '—').join(' · ');

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        'group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border bg-white p-4 text-left transition cursor-pointer',
        'hover:border-zinc-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]',
        flagged ? 'border-amber-300' : 'border-zinc-200',
        blocked && 'bg-[repeating-linear-gradient(135deg,#fff,#fff_8px,#f4f4f5_8px,#f4f4f5_16px)]'
      )}
    >
      {review && <span className={cx('absolute inset-y-0 left-0 w-1', flagged ? 'bg-amber-400' : 'bg-emerald-400')} aria-hidden />}
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
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {!blocked && <StatusPill status={b.status} />}
          {b.source === 'walk_in' && <Tag>Walk-in</Tag>}
          {b.customPrice && !blocked && <Tag tone="blue">Custom price</Tag>}
          {review && !flagged && <Tag tone="green">Receipt matches</Tag>}
          <span className="text-xs text-zinc-500">{detail}</span>
        </span>
        {review && b.reviewFlags.length > 0 && (
          <span className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-800">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {b.reviewFlags[0].message}
              {b.reviewFlags.length > 1 && <span className="text-amber-700/80"> +{b.reviewFlags.length - 1} more</span>}
            </span>
          </span>
        )}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-500" />
    </button>
  );
};
