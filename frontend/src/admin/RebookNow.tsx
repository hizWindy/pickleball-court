import React, { useState } from 'react';
import { CheckCircle2, ChevronRight, CloudRain, Megaphone } from 'lucide-react';
import { errorMessage, serverNowMs } from '../lib/api';
import { addDays, currentPlayDate } from '../lib/time';
import { adminApi } from './api';
import { useDesk } from './desk';
import { clock, hourSpan, manilaHour, PLAY_HOURS, when } from './format';
import { rainMessage } from './messages';
import { ContactBtns } from './QuickActions';
import { Btn, Card, CopyBtn, Dialog, ErrorNote } from './ui';
import type { AdminBooking } from './types';

/** A stretch of time to rebook: it starts in the play day, and can run into the next days (a typhoon). */
export interface RebookWindow {
  date: string;
  fromHour: number;
  hours: number;
  /** What the host reads: "The rest of today". */
  label: string;
  /** The small line under the button. */
  sub: string;
}

type PresetId = 'next3' | 'today' | 'tomorrow' | 'both';

const PRESETS: { id: PresetId; title: string }[] = [
  { id: 'next3', title: 'Next 3 hours' },
  { id: 'today', title: 'Rest of today' },
  { id: 'tomorrow', title: 'All of tomorrow' },
  { id: 'both', title: 'Today + tomorrow' },
];

/** How many hours are left in the play day from this hour (the day runs 5 AM to 5 AM). */
const hoursLeft = (fromHour: number) => 24 - PLAY_HOURS.indexOf(fromHour);

/** The window for each one-tap choice, worked out from the clock at the moment it is asked for. */
function presetWindow(id: PresetId): RebookWindow {
  const nowMs = serverNowMs();
  const fromHour = manilaHour(nowMs);
  const today = currentPlayDate(nowMs);
  const left = hoursLeft(fromHour);
  const three = Math.min(3, left);
  switch (id) {
    case 'next3':
      return { date: today, fromHour, hours: three, label: `the next ${three === 1 ? 'hour' : `${three} hours`}`, sub: hourSpan(fromHour, three) };
    case 'today':
      return { date: today, fromHour, hours: left, label: 'the rest of today', sub: `From ${clock(fromHour)} until 5 AM` };
    case 'tomorrow':
      return { date: addDays(today, 1), fromHour: PLAY_HOURS[0], hours: 24, label: 'all of tomorrow', sub: 'The whole play day' };
    case 'both':
      return { date: today, fromHour, hours: left + 24, label: 'the rest of today and all of tomorrow', sub: 'For a typhoon: two days' };
  }
}

const ANNOUNCEMENT = () =>
  `HousePickle Club: the courts are closed because of the weather. If you have a booking, open ${window.location.origin}, ` +
  `tap "Check my booking" and pick a new time. It's free and nothing is lost.`;

export interface Rebook {
  /** Which window is being looked up right now (its key), if any. */
  looking: string | null;
  start: (key: string, win: RebookWindow) => void;
  /** The confirm dialog, the result and any problem: render once, anywhere on the page. */
  ui: React.ReactNode;
}

/**
 * One tap to rebook: look up who plays in the window, ask once ("Rebook 5 guests?"), then give their hours back.
 * Every guest keeps their paid booking and picks a new time themselves, free. Nothing is cancelled or refunded.
 */
export function useRebook(): Rebook {
  const desk = useDesk();
  const [looking, setLooking] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ win: RebookWindow; bookings: AdminBooking[] } | null>(null);
  const [calling, setCalling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [nobody, setNobody] = useState<string | null>(null);
  const [result, setResult] = useState<{ moved: AdminBooking[]; label: string } | null>(null);

  const start = async (key: string, win: RebookWindow) => {
    setLooking(key);
    setProblem(null);
    setNobody(null);
    setResult(null);
    try {
      const preview = await adminApi.rainDelayPreview(win.date, win.fromHour, win.hours);
      if (preview.bookings.length === 0) setNobody(`Nobody is playing ${win.label}, so there is nobody to rebook.`);
      else setAsking({ win, bookings: preview.bookings });
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setLooking(null);
    }
  };

  const confirm = async () => {
    if (!asking) return;
    const { win, bookings } = asking;
    setCalling(true);
    setProblem(null);
    try {
      // Only the guests the host just saw are moved, even if someone books in the meantime.
      const res = await adminApi.rainDelay({
        date: win.date,
        fromHour: win.fromHour,
        hours: win.hours,
        codes: bookings.map((b) => b.code),
        note: `Rebook: ${win.label}`,
      });
      setResult({ moved: res.moved, label: win.label });
      setAsking(null);
      desk.refresh();
      desk.notify(res.moved.length === 1 ? '1 guest asked to rebook.' : `${res.moved.length} guests asked to rebook.`);
    } catch (e) {
      setAsking(null);
      setProblem(errorMessage(e));
    } finally {
      setCalling(false);
    }
  };

  const ui = (
    <>
      <ErrorNote>{problem}</ErrorNote>
      {nobody && <Card className="p-4 text-sm text-zinc-600">{nobody}</Card>}
      {result && <RebookResult moved={result.moved} label={result.label} onDone={() => setResult(null)} />}
      {asking && (
        <Dialog
          title={asking.bookings.length === 1 ? 'Rebook 1 guest?' : `Rebook ${asking.bookings.length} guests?`}
          onClose={() => !calling && setAsking(null)}
          actions={
            <>
              <Btn onClick={() => setAsking(null)} disabled={calling}>
                Not yet
              </Btn>
              <Btn variant="dark" loading={calling} onClick={confirm}>
                <CloudRain className="h-4 w-4" /> Rebook {asking.bookings.length === 1 ? '1 guest' : `${asking.bookings.length} guests`}
              </Btn>
            </>
          }
        >
          <p>
            Everyone playing <strong className="text-zinc-950">{asking.win.label}</strong> gives their hours back right now and picks a new time themselves.
          </p>
          <ul className="divide-y divide-zinc-100 rounded-xl bg-zinc-50 px-3">
            {asking.bookings.slice(0, 6).map((b) => (
              <li key={b.code} className="py-2">
                <span className="block truncate font-semibold text-zinc-900">{b.customerName}</span>
                <span className="block text-xs text-zinc-500">
                  {b.courtName} · {when(b)}
                </span>
              </li>
            ))}
            {asking.bookings.length > 6 && <li className="py-2 text-xs font-semibold text-zinc-500">+ {asking.bookings.length - 6} more</li>}
          </ul>
          <p>Nothing is cancelled or refunded, and it's free for them. You can undo a guest later.</p>
        </Dialog>
      )}
    </>
  );

  return { looking, start, ui };
}

/** The big card: four one-tap choices. */
export const RebookCard: React.FC<{ rebook: Rebook; onChoose: () => void }> = ({ rebook, onChoose }) => (
  <Card className="p-4">
    <div className="grid grid-cols-2 gap-2.5">
      {PRESETS.map((p) => {
        const win = presetWindow(p.id);
        const busy = rebook.looking === p.id;
        return (
          <button
            key={p.id}
            type="button"
            disabled={rebook.looking !== null}
            onClick={() => rebook.start(p.id, presetWindow(p.id))}
            className="flex min-h-[4.75rem] cursor-pointer flex-col items-start justify-center rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-left transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex items-center gap-1.5 font-heading text-[15px] font-bold leading-tight text-sky-950">
              <CloudRain className="h-4 w-4 shrink-0 text-sky-700" /> {busy ? 'Looking…' : p.title}
            </span>
            <span className="mt-1 text-xs text-sky-900/80">{win.sub}</span>
          </button>
        );
      })}
    </div>
    <button
      type="button"
      onClick={onChoose}
      className="mt-2 flex min-h-11 w-full cursor-pointer items-center justify-center gap-1 rounded-xl text-sm font-semibold text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
    >
      Choose the hours yourself <ChevronRight className="h-4 w-4" />
    </button>
  </Card>
);

/** After rebooking: one message for everyone, and each guest's own message. */
const RebookResult: React.FC<{ moved: AdminBooking[]; label: string; onDone: () => void }> = ({ moved, label, onDone }) => (
  <div className="space-y-3">
    <Card className="border-sky-200 bg-sky-50 p-4">
      <p className="flex items-center gap-2 font-heading text-base font-bold text-sky-950">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-sky-700" />
        {moved.length === 0 ? 'Nobody needed rebooking' : moved.length === 1 ? '1 guest asked to rebook' : `${moved.length} guests asked to rebook`}
      </p>
      <p className="mt-1 text-sm text-sky-900">
        {moved.length === 0
          ? 'Those bookings had already finished or changed.'
          : `Everyone playing ${label} gave their hours back. Nothing is cancelled or refunded. Tell them to open the website and tap “Check my booking”.`}
      </p>
      {moved.length > 0 && (
        <div className="mt-3 space-y-2.5 rounded-xl bg-white/80 p-3 text-xs text-sky-950">
          <p className="flex items-start gap-2">
            <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
            Copy one message and send it to everyone, instead of writing to each guest.
          </p>
          <CopyBtn text={ANNOUNCEMENT()} label="Copy message for everyone" className="w-full" />
        </div>
      )}
    </Card>
    {moved.map((b) => (
      <GuestRow key={b.code} b={b} />
    ))}
    <Btn className="w-full" onClick={onDone}>
      Done
    </Btn>
  </div>
);

// ── A guest to message ────────────────────────────────────────────────────────
/** One rain-delayed guest, with the message ready to send. */
export const GuestRow: React.FC<{ b: AdminBooking; onOpen?: () => void; onUndo?: () => void }> = ({ b, onOpen, onUndo }) => {
  const message = rainMessage(b);
  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="flex w-full items-center gap-2 rounded-lg text-left enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-heading text-base font-bold text-zinc-950">{b.customerName}</span>
          <span className="block text-sm text-zinc-600">
            {b.courtName} · {when(b)}
          </span>
        </span>
        {onOpen && <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300" />}
      </button>
      {!b.customerPhone && <p className="mt-2 text-xs text-zinc-500">No phone number saved. Copy the message and send it another way.</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ContactBtns b={b} message={message} />
        <CopyBtn text={message} label="Copy message" className={onUndo ? '!px-3' : 'col-span-2'} />
        {onUndo && <Btn onClick={onUndo}>Undo</Btn>}
      </div>
    </Card>
  );
};
