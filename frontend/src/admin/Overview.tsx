import React, { useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, CloudRain, Clock, Phone } from 'lucide-react';
import { fmtDate, fmtTime, peso } from '../lib/time';
import { adminApi } from './api';
import { ColumnChart, HourGrid, LabelledColumns, RankBars, StackedBar } from './charts';
import { useDesk } from './desk';
import { compactPeso, delta, hourSpan, METHOD_LABEL, restoreLeft, startsIn, WEEKDAYS } from './format';
import { useNow, useRemote } from './hooks';
import { summarizeRain } from './forecast';
import { RowActions } from './QuickActions';
import { RainBars } from './rain';
import { Btn, Card, cx, Label, LabelBadge, Num, Segmented } from './ui';
import { useQuickActions } from './useQuickActions';
import type { Overview } from './types';

const RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

const Skeleton: React.FC<{ className: string }> = ({ className }) => <div className={cx('animate-pulse rounded-2xl bg-zinc-100', className)} />;

const Delta: React.FC<{ cur: number; prev: number; days: number; dark?: boolean }> = ({ cur, prev, days, dark }) => {
  const d = delta(cur, prev);
  if (!d) return <span className={cx('text-xs font-medium', dark ? 'text-zinc-500' : 'text-zinc-400')}>nothing to compare with yet</span>;
  const Icon = d.up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs font-semibold', d.up ? (dark ? 'text-[#D2EE5E]' : 'text-[#15803D]') : 'text-red-500')}>
      <Icon className="h-3.5 w-3.5" />
      {d.pct}% {d.up ? 'up' : 'down'} <span className={cx('font-medium', dark ? 'text-zinc-500' : 'text-zinc-400')}>on the previous {days} days</span>
    </span>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; sub: React.ReactNode }> = ({ label, value, sub }) => (
  <Card className="flex flex-col justify-between p-4">
    <Label>{label}</Label>
    <div className="mt-3">
      <Num className="text-[28px] leading-none text-zinc-950">{value}</Num>
      <div className="mt-1.5 text-xs leading-snug text-zinc-500">{sub}</div>
    </div>
  </Card>
);

const Section: React.FC<{ title: string; note?: string; children: React.ReactNode; className?: string }> = ({ title, note, children, className }) => (
  <Card className={cx('p-5', className)}>
    <div className="mb-4">
      <h2 className="font-heading text-base font-bold tracking-tight text-zinc-950">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-zinc-500">{note}</p>}
    </div>
    {children}
  </Card>
);

/**
 * What can't wait: a Late booking the host can still restore, guests waiting to pick a new time after rain,
 * and payments to look at. Loads on its own, so it shows even if the analytics below are slow.
 */
const NeedsYou: React.FC<{ o: Overview | null }> = ({ o }) => {
  const desk = useDesk();
  const { q, problemDialog } = useQuickActions();
  const counts = desk.counts;
  const lateCount = counts?.late ?? 0;
  const now = useNow(lateCount > 0 ? 1000 : 30000); // the restore countdown ticks every second
  const { data: late } = useRemote('late-now', () => adminApi.list({ label: 'late', sort: 'start_desc', pageSize: 12 }), {
    enabled: lateCount > 0,
    intervalMs: 20000,
    version: desk.refreshKey,
  });
  const lateNow = lateCount > 0 && late ? late.items.filter((b) => restoreLeft(b, now) !== null) : [];

  const rainWaiting = counts?.rainDelay ?? 0;
  const payments = o?.pending.count ?? counts?.toReview ?? 0;
  const flagged = o?.pending.flagged ?? counts?.flagged ?? 0;

  if (!counts && !o) return null;
  if (lateNow.length === 0 && rainWaiting === 0 && payments === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm font-medium text-emerald-900">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-[#15803D]" /> You're all caught up. Nothing needs you right now.
      </div>
    );
  }

  return (
    <section aria-label="Needs you now" className="space-y-2.5">
      <Label>Needs you now</Label>

      {lateNow.map((b) => (
        <div key={b.code} className="rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 p-4">
          <button
            type="button"
            onClick={() => desk.openBooking(b.code)}
            className="flex w-full items-center gap-3 rounded-lg text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
              <Clock className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-heading text-base font-bold text-amber-950">{b.customerName} is Late</span>
              <span className="block text-sm text-amber-900/80">
                {b.courtName} · {hourSpan(b.hour, b.hours)}
                {b.lateAt ? ` · went Late at ${fmtTime(b.lateAt)}` : ''}
              </span>
            </span>
          </button>
          <RowActions b={b} q={q} now={now} className="mt-3" />
        </div>
      ))}

      {rainWaiting > 0 && (
        <button
          type="button"
          onClick={() => desk.goto('weather')}
          className="group flex w-full items-center gap-4 rounded-2xl border border-sky-300 bg-sky-50 p-4 text-left transition hover:bg-sky-100/70 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-600 font-heading text-lg font-bold text-white">{rainWaiting}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-heading text-base font-bold text-sky-950">
              {rainWaiting === 1 ? '1 guest is waiting to rebook after rain' : `${rainWaiting} guests are waiting to rebook after rain`}
            </span>
            <span className="block text-sm text-sky-900/80">Send them their link.</span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-sky-800 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}

      {payments > 0 && (
        <button
          type="button"
          onClick={() => desk.goto('bookings', { status: 'needs_check' })}
          className="group flex w-full items-center gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left transition hover:bg-amber-100/70 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 font-heading text-lg font-bold text-white">{payments}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-heading text-base font-bold text-amber-950">{payments === 1 ? '1 payment to check' : `${payments} payments to check`}</span>
            <span className="block text-sm text-amber-900/80">
              {flagged
                ? `${flagged} ${flagged === 1 ? 'looks' : 'look'} off`
                : o
                  ? `${peso(o.pending.amount)} in total · all receipts matched the bookings`
                  : 'All receipts matched the bookings'}
            </span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-amber-800 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}
      {problemDialog}
    </section>
  );
};

/** Next 12 hours of rain chance in one glance, and how many paid bookings it touches. */
const WeatherCard: React.FC = () => {
  const desk = useDesk();
  const now = useNow(60000);
  const { report, loading } = desk.weather;
  if (loading) return <Skeleton className="h-24" />;
  const summary = summarizeRain(report, now);
  const rainy = summary.kind === 'rain';
  return (
    <button
      type="button"
      onClick={() => desk.goto('weather')}
      className={cx(
        'group block w-full rounded-2xl border bg-white p-4 text-left transition hover:bg-zinc-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]',
        rainy ? 'border-sky-300' : 'border-zinc-200'
      )}
    >
      <span className="flex items-start gap-3">
        <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', rainy ? 'bg-sky-100 text-sky-700' : 'bg-zinc-100 text-zinc-500')}>
          <CloudRain className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <Label>Weather</Label>
          <span className={cx('mt-0.5 block text-sm font-semibold', summary.kind === 'unavailable' ? 'text-zinc-500' : 'text-zinc-900')}>{summary.text}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-xs font-semibold text-[#15803D]">
          Open Weather <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
      {report?.available && <RainBars report={report} nowMs={now} className="mt-3" />}
    </button>
  );
};

export const OverviewPage: React.FC = () => {
  const desk = useDesk();
  const [days, setDays] = useState(30);
  const { data: o, error } = useRemote(`overview-${days}`, () => adminApi.overview(days), { intervalMs: 45000, version: desk.refreshKey });
  const now = useNow();

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">Overview</h1>
          <p className="mt-0.5 text-sm text-zinc-500">{o ? `${fmtDate(o.dateFrom, { month: 'short', day: 'numeric' })} – ${fmtDate(o.dateTo, { month: 'short', day: 'numeric' })}` : ' '}</p>
        </div>
        <Segmented className="w-full sm:w-64" label="Time range" value={days} onChange={setDays} options={RANGES} />
      </div>

      <NeedsYou o={o} />
      <WeatherCard />

      {error && !o && (
        <Card className="p-5 text-sm text-zinc-600">
          {error.message} <Btn size="sm" className="ml-2" onClick={() => desk.refresh()}>Try again</Btn>
        </Card>
      )}

      {!o && !error && (
        <div className="space-y-4">
          <Skeleton className="h-80" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </div>
      )}

      {o && <OverviewBody o={o} days={days} now={now} />}
    </div>
  );
};

const OverviewBody: React.FC<{ o: Overview; days: number; now: number }> = ({ o, days, now }) => {
  const desk = useDesk();
  const k = o.kpis;
  const peak = o.byHour.reduce((best, n, h) => (n > o.byHour[best] ? h : best), 0);
  const weekdayRows = WEEKDAYS.map((label, i) => {
    const row = o.byWeekday.find((w) => w.weekday === i);
    return { label, value: row?.revenue ?? 0, display: compactPeso(row?.revenue ?? 0) };
  });
  const bestWeekday = weekdayRows.reduce((a, b) => (b.value > a.value ? b : a), weekdayRows[0]);
  const f = o.funnel;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section className="flex flex-col rounded-3xl bg-zinc-950 p-5 text-white sm:p-6" aria-label="Revenue">
          <Label className="text-zinc-400">Revenue · last {days} days</Label>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Num className="text-[2.6rem] leading-none text-[#D2EE5E] sm:text-5xl">{peso(k.revenue)}</Num>
            <Delta cur={k.revenue} prev={k.revenuePrev} days={days} dark />
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">Paid bookings, counted on the day they're played.</p>
          <div className="mt-6 flex-1">
            <ColumnChart
              tone="dark"
              fill
              height={150}
              ariaLabel={`Revenue per day over the last ${days} days. Total ${peso(k.revenue)}.`}
              maxLabel={compactPeso(Math.max(...o.daily.map((d) => d.revenue)))}
              axis={[
                fmtDate(o.daily[0].date, { month: 'short', day: 'numeric' }),
                fmtDate(o.daily[Math.floor(o.daily.length / 2)].date, { month: 'short', day: 'numeric' }),
                'Today',
              ]}
              summary={{ title: `${days}-day total`, detail: `${peso(k.revenue)} · ${k.bookings} booking${k.bookings === 1 ? '' : 's'}` }}
              columns={o.daily.map((d) => ({
                key: d.date,
                value: d.revenue,
                emphasis: d.date === o.today,
                title: `${fmtDate(d.date)}${d.date === o.today ? ' · today' : ''}`,
                detail: d.bookings ? `${peso(d.revenue)} · ${d.bookings} booking${d.bookings === 1 ? '' : 's'}` : 'No bookings',
              }))}
            />
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Stat label="Bookings" value={k.bookings} sub={<Delta cur={k.bookings} prev={k.bookingsPrev} days={days} />} />
          <Stat
            label="Court hours"
            value={`${k.hours} h`}
            sub={k.courtHoursAvailable ? `${k.utilisationPct}% of the ${k.courtHoursAvailable.toLocaleString()} hours so far` : 'Nothing played yet'}
          />
          <Stat label="Average booking" value={peso(k.avgBooking)} sub={k.paddleRevenue ? `${peso(k.paddleRevenue)} from paddle rentals` : 'No paddle rentals'} />
          <Stat
            label="Players"
            value={k.customers}
            sub={k.customers ? `${k.repeatCustomers} booked more than once` : 'Nobody has booked yet'}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Section
          title="When people play"
          note={k.hours ? `Most hours start at ${peak === 0 ? '12 AM' : peak <= 12 ? `${peak} ${peak < 12 ? 'AM' : 'PM'}` : `${peak - 12} PM`}. Darker means busier.` : 'Booked hours by start time.'}
        >
          <HourGrid counts={o.byHour} />
        </Section>
        <Section
          title="Best days"
          note={bestWeekday.value > 0 ? `${bestWeekday.label} brings in the most revenue.` : 'Revenue by weekday.'}
        >
          <LabelledColumns items={weekdayRows} ariaLabel="Revenue by weekday" />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
        <Section title="By court">
          <RankBars
            rows={o.byCourt.map((c) => ({ label: c.name, sub: `${c.hours} h`, value: c.revenue, display: peso(c.revenue) }))}
            empty="No sales yet."
          />
        </Section>
        <Section title="By payment">
          <RankBars
            rows={o.byMethod.map((m) => ({ label: METHOD_LABEL[m.method], sub: `${m.bookings} booking${m.bookings === 1 ? '' : 's'}`, value: m.revenue, display: peso(m.revenue) }))}
            empty="No sales yet."
          />
        </Section>
        <Section title="By rate" note="Court fees, before paddles.">
          <RankBars
            rows={o.byRate.map((r) => ({
              label: r.rateType === 'night_owl' ? 'Night Owl' : 'Standard',
              sub: `${r.hours} h`,
              value: r.revenue,
              display: peso(r.revenue),
            }))}
            empty="No sales yet."
          />
        </Section>
      </div>

      <Section
        title="What happens to online bookings"
        note={k.conversionPct !== null ? `${k.conversionPct}% of the bookings that finished were paid for.` : 'Shows once a few bookings have finished.'}
      >
        <StackedBar
          parts={[
            { label: 'Paid', value: f.confirmed, className: 'bg-[#15803D]' },
            { label: 'Needs check', value: f.pendingVerification, className: 'bg-amber-400' },
            { label: 'Paying now', value: f.held, className: 'bg-sky-400' },
            { label: 'Expired', value: f.expired, className: 'bg-zinc-300' },
            { label: 'Released or voided', value: f.cancelled, className: 'bg-zinc-400' },
            { label: 'Rejected', value: f.rejected, className: 'bg-red-400' },
          ]}
        />
      </Section>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Section title="Up next" note="Sessions that haven't finished yet.">
          {o.upNext.length === 0 ? (
            <p className="text-sm text-zinc-400">Nothing scheduled right now.</p>
          ) : (
            <ul className="-mx-2 divide-y divide-zinc-100">
              {o.upNext.map((b) => (
                <li key={b.code}>
                  <button
                    type="button"
                    onClick={() => desk.openBooking(b.code)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition hover:bg-zinc-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
                  >
                    <span className="w-[4.5rem] shrink-0">
                      <span className="block font-heading text-sm font-bold text-zinc-950">{hourSpan(b.hour, b.hours)}</span>
                      <span className="block text-xs text-zinc-500">{startsIn(b.startAt, now)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zinc-900">{b.customerName}</span>
                      <span className="block truncate text-xs text-zinc-500">
                        {b.courtName} · {fmtDate(b.playDate, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                    </span>
                    {b.label !== 'paid' && <LabelBadge label={b.label} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Regulars" note="Who spent the most in this period.">
          {o.topCustomers.length === 0 ? (
            <p className="text-sm text-zinc-400">Players show up here after their first paid booking.</p>
          ) : (
            <ol className="space-y-3">
              {o.topCustomers.map((c, i) => (
                <li key={`${c.phone}-${c.name}`} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-heading text-sm font-bold text-zinc-600">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-900">{c.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {c.bookings} booking{c.bookings === 1 ? '' : 's'} · {c.hours} h
                    </span>
                  </span>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} aria-label={`Call ${c.name}`} className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-[#15803D]">
                      <Phone className="h-4 w-4" />
                    </a>
                  )}
                  <Num className="w-20 text-right text-sm text-zinc-950">{peso(c.spent)}</Num>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </>
  );
};
