import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, CalendarSearch, Zap } from 'lucide-react';
import { useAvailability, useConfig } from '../hooks/useBookingData';
import { serverNowMs } from '../lib/api';
import { dayLabel, minutesUntil, primeTime, toPicks, type OpenPick } from '../lib/openSlots';
import { addDays, currentPlayDate, hourLabel, peso } from '../lib/time';
import type { BookingDraftSeed, CourtConfig } from '../types';

interface NextOpenSlotsProps {
  onBook: (seed: BookingDraftSeed) => void;
}

const MAX_CARDS = 4;
function startsIn(startAt: string): string | null {
  const mins = minutesUntil(startAt);
  if (mins <= 0 || mins > 180) return null;
  if (mins < 60) return `Starts in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `Starts in ${h} hr${m ? ` ${m} min` : ''}`;
}

/**
 * Answers the one question most visitors have: "When's the soonest I can play?"
 * Shows the next free hours (today, then tomorrow) plus the next Night Owl promo hour.
 * Tapping a card opens the booking with date, time and court already chosen.
 */
export const NextOpenSlots: React.FC<NextOpenSlotsProps> = ({ onBook }) => {
  const { config } = useConfig();
  const today = config?.today ?? currentPlayDate(serverNowMs());
  const tomorrow = addDays(today, 1);
  const { data: todayAvail, error } = useAvailability(today, { intervalMs: 15000 });
  const { data: tomorrowAvail } = useAvailability(tomorrow, { intervalMs: 30000 });
  const courts = config?.courts ?? [];

  const all = [...toPicks(today, todayAvail?.slots, courts), ...toPicks(tomorrow, tomorrowAvail?.slots, courts)];
  // One card per part of the day (the soonest free hour in each), so the options are genuinely
  // different (e.g. Tonight 12 AM · Tomorrow 6 AM · Tomorrow 12 PM · Tomorrow 5 PM) instead of
  // four back-to-back hours. Falls back to consecutive hours if there are fewer parts left.
  const seen = new Set<string>();
  let picks = all.filter((p) => {
    const key = `${p.date}-${p.slot.period}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (picks.length < MAX_CARDS) picks = [...picks, ...all.filter((p) => !picks.includes(p))];
  picks = picks.slice(0, MAX_CARDS).sort((a, b) => (a.slot.startAt < b.slot.startAt ? -1 : 1));
  // Make sure the cheaper Night Owl rate is on show if it isn't already.
  const nightPick = all.find((p) => p.slot.rateType === 'night_owl');
  if (nightPick && !picks.some((p) => p.slot.rateType === 'night_owl')) {
    picks = [...picks.slice(0, MAX_CARDS - 1), nightPick];
  }

  // Prime-time scarcity: real numbers for today's 5-10 PM, or tomorrow's once tonight's have passed.
  const primeToday = primeTime(todayAvail?.slots, courts);
  const prime = primeToday.total > 0 ? { ...primeToday, when: 'tonight' } : { ...primeTime(tomorrowAvail?.slots, courts), when: 'tomorrow' };

  const loading = !todayAvail || !config;
  const nothingFree = !loading && tomorrowAvail && picks.length === 0;

  return (
    <section id="open-slots" className="py-12 sm:py-14 bg-[#FAFCF9] border-b border-zinc-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-3"
        >
          <div>
            <h2 className="flex items-center gap-2 text-2xl sm:text-3xl font-heading font-black text-zinc-950 uppercase tracking-tight">
              <Zap className="h-6 w-6 text-[#84CC16] fill-[#CCFF00]" />
              Next open slots
            </h2>
            <p className="text-sm text-zinc-500 font-medium mt-1">The soonest times you can play. Tap one to book it.</p>
          </div>
          {!loading && prime.total > 0 && (
            <span
              className={`self-start sm:self-auto px-3 py-1.5 rounded-full border text-xs font-sport font-bold uppercase tracking-wider ${
                prime.free <= 3 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-white border-emerald-200 text-[#15803D]'
              }`}
            >
              Prime time {prime.when} (5–10 PM): {prime.free === 0 ? 'fully booked' : `${prime.free} of ${prime.total} hours left`}
            </span>
          )}
        </motion.div>

        {error && !todayAvail ? (
          <EmptyCard text="Can't load open times right now." onBook={onBook} />
        ) : nothingFree ? (
          <EmptyCard text="Today and tomorrow are fully booked." onBook={onBook} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {loading
              ? Array.from({ length: MAX_CARDS }, (_, i) => <div key={i} className="h-[150px] rounded-3xl bg-zinc-100 animate-pulse" />)
              : picks.map((p) => <SlotCard key={`${p.date}-${p.slot.hour}`} pick={p} today={today} courts={courts} onBook={onBook} />)}
          </div>
        )}
      </div>
    </section>
  );
};

function SlotCard({ pick, today, courts, onBook }: { pick: OpenPick; today: string; courts: CourtConfig[]; onBook: NextOpenSlotsProps['onBook'] }) {
  const { date, slot, freeCourts } = pick;
  const night = slot.rateType === 'night_owl';
  const court = freeCourts[0];
  const rate = night ? court.nightRate : court.dayRate;
  const where = freeCourts.length === courts.length && courts.length > 1 ? 'Both courts free' : `${court.name} free`;
  const soon = startsIn(slot.startAt);

  return (
    <motion.button
      type="button"
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onClick={() => onBook({ date, hour: slot.hour, courtId: court.id })}
      aria-label={`Book ${dayLabel(date, today, slot.hour)} ${hourLabel(slot.hour)}, ${where}, ${peso(rate)} per hour`}
      className={`group relative flex flex-col justify-between rounded-3xl border p-4 text-left shadow-xs transition-colors cursor-pointer min-h-[150px] ${
        night ? 'border-zinc-800 bg-zinc-950 text-white hover:border-[#CCFF00]' : 'border-emerald-200 bg-white hover:border-[#15803D]'
      }`}
    >
      {night && (
        <span className="absolute right-3 top-3 rounded-full bg-[#CCFF00] px-2 py-0.5 text-[10px] font-sport font-extrabold uppercase tracking-wider text-zinc-950">
          Promo
        </span>
      )}
      <div>
        <span className={`block text-[11px] font-sport font-bold uppercase tracking-widest ${night ? 'text-[#CCFF00]' : 'text-[#15803D]'}`}>
          {dayLabel(date, today, slot.hour)}
        </span>
        <span className="block font-heading font-black text-3xl leading-none mt-1">{hourLabel(slot.hour)}</span>
        <span className={`mt-1.5 block text-xs font-semibold ${night ? 'text-zinc-300' : 'text-zinc-600'}`}>{where}</span>
        {soon && <span className={`mt-0.5 block text-[11px] font-medium ${night ? 'text-zinc-400' : 'text-amber-700'}`}>{soon}</span>}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-bold">
          {peso(rate)}
          <span className={`text-xs font-medium ${night ? 'text-zinc-400' : 'text-zinc-500'}`}>/hr</span>
        </span>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            night ? 'bg-[#CCFF00] text-zinc-950' : 'bg-[#15803D] text-white group-hover:bg-[#166534]'
          }`}
        >
          <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </motion.button>
  );
}

function EmptyCard({ text, onBook }: { text: string; onBook: NextOpenSlotsProps['onBook'] }) {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-3xl border border-zinc-200 bg-white p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-zinc-700">
        <CalendarSearch className="h-5 w-5 text-[#15803D]" /> {text}
      </p>
      <button
        type="button"
        onClick={() => onBook({})}
        className="rounded-full bg-[#15803D] px-4 py-2 text-xs font-sport font-extrabold uppercase tracking-wider text-white hover:bg-[#166534] cursor-pointer"
      >
        Pick another date
      </button>
    </div>
  );
}
