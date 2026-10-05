import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Clock, Flame, Moon, Sparkles, X, Zap, type LucideIcon } from 'lucide-react';
import { useAvailability, useConfig } from '../hooks/useBookingData';
import { serverNowMs } from '../lib/api';
import { dayLabel, minutesUntil, primeTime, toPicks, type OpenPick } from '../lib/openSlots';
import { addDays, currentPlayDate, hourLabel, peso } from '../lib/time';
import type { BookingDraftSeed } from '../types';

interface AnnouncementStripProps {
  onBook: (seed: BookingDraftSeed) => void;
}

interface Message {
  id: string;
  Icon: LucideIcon;
  tag: string;
  text: string;
  seed?: BookingDraftSeed;
}

const ROTATE_MS = 4500;
const DISMISS_KEY = 'hpc_strip_dismissed_v1';

const seedOf = (p: OpenPick): BookingDraftSeed => ({ date: p.date, hour: p.slot.hour, courtId: p.freeCourts[0].id });

/**
 * A slim rotating strip of live highlights. Every message is computed from real availability,
 * and urgency ("last court", "prime time filling up") only appears when it is actually true.
 * Tapping a message opens the booking pre-filled with that time and court.
 */
export const AnnouncementStrip: React.FC<AnnouncementStripProps> = ({ onBook }) => {
  const { config } = useConfig();
  const today = config?.today ?? currentPlayDate(serverNowMs());
  const tomorrow = addDays(today, 1);
  const { data: todayAvail } = useAvailability(today, { intervalMs: 15000 });
  const { data: tomorrowAvail } = useAvailability(tomorrow, { intervalMs: 30000 });
  const courts = config?.courts;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [reduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const messages = useMemo<Message[]>(() => {
    if (!courts || courts.length === 0 || !todayAvail) return [];
    const picks = [...toPicks(today, todayAvail.slots, courts), ...toPicks(tomorrow, tomorrowAvail?.slots, courts)];
    const out: Message[] = [];

    // 1. Last court: the soonest upcoming hour (within 8 hours) where only one court is left.
    if (courts.length > 1) {
      const last = picks.find((p) => p.freeCourts.length === 1 && minutesUntil(p.slot.startAt) <= 8 * 60);
      if (last) {
        out.push({
          id: 'last-court',
          Icon: Flame,
          tag: 'Almost full',
          text: `${dayLabel(last.date, today, last.slot.hour)} ${hourLabel(last.slot.hour)}: only ${last.freeCourts[0].name} left`,
          seed: seedOf(last),
        });
      }
    }

    // 2. Prime time scarcity (5-10 PM), only once it's genuinely getting tight.
    const prime = primeTime(todayAvail.slots, courts);
    if (prime.total > 0 && prime.free > 0 && prime.free <= 3) {
      const firstPrime = picks.find((p) => p.date === today && p.slot.period === 'evening');
      out.push({
        id: 'prime',
        Icon: Clock,
        tag: 'Prime time',
        text: `Tonight 5–10 PM: only ${prime.free} of ${prime.total} hours left`,
        seed: firstPrime ? seedOf(firstPrime) : undefined,
      });
    }

    // 3. Soonest free slot overall (skipped when it's the same hour the "almost full" message already named).
    const next = picks[0];
    const alreadyShown = out.some((m) => m.id === 'last-court' && m.seed?.date === next?.date && m.seed?.hour === next?.slot.hour);
    if (next && !alreadyShown) {
      const where = next.freeCourts.length === courts.length && courts.length > 1 ? 'both courts free' : `${next.freeCourts[0].name} free`;
      const rate = next.slot.rateType === 'night_owl' ? next.freeCourts[0].nightRate : next.freeCourts[0].dayRate;
      out.push({
        id: 'next-free',
        Icon: Zap,
        tag: 'Next free',
        text: `${dayLabel(next.date, today, next.slot.hour)} ${hourLabel(next.slot.hour)} · ${where} · ${peso(rate)}/hr`,
        seed: seedOf(next),
      });
    }

    // 4. Night Owl promo, when a night hour is actually bookable.
    const night = picks.find((p) => p.slot.rateType === 'night_owl');
    const save = courts[0].dayRate - courts[0].nightRate;
    if (night && save > 0) {
      out.push({
        id: 'night-owl',
        Icon: Moon,
        tag: 'Night Owl',
        text: `${peso(courts[0].nightRate)}/hr from 10 PM to 6 AM · save ${peso(save)} every hour`,
        seed: seedOf(night),
      });
    }

    // 5. Always-true fallback, so quiet days still get a friendly line.
    out.push({
      id: 'about',
      Icon: Sparkles,
      tag: 'HousePickle',
      text: `Only ${courts.length} court${courts.length > 1 ? 's' : ''} · open 24/7 · book in under a minute`,
    });
    return out;
  }, [courts, todayAvail, tomorrowAvail, today, tomorrow]);

  useEffect(() => {
    if (reduced || paused || messages.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [reduced, paused, messages.length]);

  if (dismissed || messages.length === 0) return null;
  const current = messages[index % messages.length];

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // storage blocked: the strip just comes back on the next visit
    }
  };

  return (
    <div
      role="region"
      aria-label="Court availability highlights"
      className="bg-zinc-950 text-white"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="mx-auto flex h-10 max-w-6xl items-center gap-2 px-3 sm:px-6">
        <button
          type="button"
          onClick={() => onBook(current.seed ?? {})}
          className="group flex min-w-0 flex-1 items-center text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CCFF00] rounded-md"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={current.id}
              initial={reduced ? false : { y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduced ? undefined : { y: -10, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="flex min-w-0 items-center gap-2"
            >
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#CCFF00] px-2 py-0.5 text-[10px] font-sport font-extrabold uppercase tracking-wider text-zinc-950">
                <current.Icon className="h-3 w-3" /> {current.tag}
              </span>
              <span className="truncate text-xs font-medium sm:text-sm">{current.text}</span>
              <span className="hidden shrink-0 items-center gap-0.5 text-xs font-bold text-[#CCFF00] sm:inline-flex">
                {current.seed ? 'Book it' : 'Book now'} <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </motion.span>
          </AnimatePresence>
        </button>

        {messages.length > 1 && (
          <div className="hidden shrink-0 items-center sm:flex" role="tablist" aria-label="Highlights">
            {messages.map((m, i) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={i === index % messages.length}
                aria-label={m.tag}
                onClick={() => setIndex(i)}
                className="flex h-8 w-4 items-center justify-center cursor-pointer"
              >
                <span className={`h-1.5 rounded-full transition-all ${i === index % messages.length ? 'w-4 bg-[#CCFF00]' : 'w-1.5 bg-white/30'}`} />
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss highlights"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
