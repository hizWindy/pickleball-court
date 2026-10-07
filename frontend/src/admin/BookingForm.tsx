import React, { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { normalizePhone } from '../lib/phone';
import { addDays, fmtDate, hourLabel, peso } from '../lib/time';
import type { AppConfig } from '../types';
import { adminApi } from './api';
import { useDesk, type FormSeed } from './desk';
import { clock, hourSpan, isNight, PLAY_HOURS } from './format';
import { useRemote } from './hooks';
import { Btn, Card, cx, ErrorNote, Field, Label, Segmented, SelectInput, Sheet, Switch, TextArea, TextInput } from './ui';
import type { AdminBookingDetail, AdminPayment, CreateBody, UpdateBody } from './types';

export type FormMode = { type: 'create'; seed?: FormSeed } | { type: 'edit'; code: string };

const BLOCK_REASONS = ['Maintenance', 'Tournament', 'Private event', 'Lessons'];

const pad = (n: number) => String(n).padStart(2, '0');
/** The absolute start of an hour on a play day (12-5 AM belong to the previous day's date). */
const slotMs = (date: string, hour: number) => Date.parse(`${hour < 6 ? addDays(date, 1) : date}T${pad(hour)}:00:00+08:00`);

function priceOf(config: AppConfig, courtId: string, hour: number, hours: number, paddles: boolean) {
  const court = config.courts.find((c) => c.id === courtId) ?? config.courts[0];
  let courtCost = 0;
  for (let i = 0; i < hours; i++) courtCost += isNight((hour + i) % 24) ? court.nightRate : court.dayRate;
  return { courtCost, addons: paddles ? config.paddleFee : 0, total: courtCost + (paddles ? config.paddleFee : 0) };
}

const nextHourInManila = () => (Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hourCycle: 'h23' }).format(Date.now())) + 1) % 24;

export const BookingForm: React.FC<{ mode: FormMode; onClose: () => void; onSaved: (code: string) => void }> = ({ mode, onClose, onSaved }) => {
  const desk = useDesk();
  const editing = mode.type === 'edit' ? mode.code : null;
  const { data: existing, error } = useRemote(`edit-${editing}`, () => adminApi.get(editing!), { enabled: !!editing });

  const title = editing ? 'Edit booking' : 'Add booking';
  if (!desk.config || (editing && !existing)) {
    return (
      <Sheet label={title} title={<h2 className="font-heading text-xl font-bold">{title}</h2>} onClose={onClose}>
        <div className="p-5">{error ? <ErrorNote>{error.message}</ErrorNote> : <div className="h-64 animate-pulse rounded-2xl bg-zinc-100" />}</div>
      </Sheet>
    );
  }
  return <FormBody config={desk.config} mode={mode} existing={existing ?? undefined} onClose={onClose} onSaved={onSaved} />;
};

const FormBody: React.FC<{
  config: AppConfig;
  mode: FormMode;
  existing?: AdminBookingDetail;
  onClose: () => void;
  onSaved: (code: string) => void;
}> = ({ config, mode, existing, onClose, onSaved }) => {
  const desk = useDesk();
  const seed = mode.type === 'create' ? mode.seed : undefined;
  const editing = !!existing;

  const [kind, setKind] = useState<'walk_in' | 'block'>(existing ? (existing.source === 'blocked' ? 'block' : 'walk_in') : (seed?.kind ?? 'walk_in'));
  const [courtId, setCourtId] = useState(existing?.courtId ?? seed?.courtId ?? config.courts[0].id);
  const [date, setDate] = useState(existing?.playDate ?? seed?.date ?? config.today);
  const [hour, setHour] = useState(existing?.hour ?? seed?.hour ?? nextHourInManila());
  const [hours, setHours] = useState(existing?.hours ?? 1);
  const [paddles, setPaddles] = useState(existing?.paddles ?? false);
  const [name, setName] = useState(existing?.customerName ?? '');
  const [phone, setPhone] = useState(existing?.customerPhone ?? '');
  const [method, setMethod] = useState<AdminPayment>(existing && existing.paymentMethod !== 'none' ? existing.paymentMethod : 'cash');
  const [custom, setCustom] = useState(existing?.customPrice ?? false);
  const [customTotal, setCustomTotal] = useState(existing?.customPrice ? String(existing.total) : '');
  const [note, setNote] = useState(existing?.adminNote ?? '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const block = kind === 'block';
  const price = priceOf(config, courtId, hour, hours, paddles && !block);

  // Who is already on the courts that day, so a clash shows before saving.
  const { data: day } = useRemote(`form-day-${date}`, () => adminApi.schedule(date));
  const clash = useMemo(() => {
    if (!day) return null;
    const taken = new Map<string, string>();
    for (const b of day.bookings) {
      if (b.code === existing?.code) continue;
      for (let i = 0; i < b.hours; i++) taken.set(`${b.courtId}|${Date.parse(b.startAt) + i * 3_600_000}`, b.source === 'blocked' ? `blocked (${b.customerName})` : b.customerName);
    }
    for (let i = 0; i < hours; i++) {
      const who = taken.get(`${courtId}|${slotMs(date, hour) + i * 3_600_000}`);
      if (who) return `${config.courts.find((c) => c.id === courtId)?.name} at ${hourLabel((hour + i) % 24)} is already taken by ${who}.`;
    }
    return null;
  }, [day, courtId, date, hour, hours, existing?.code, config.courts]);

  const nameError = tried && name.trim().length < 2 ? (block ? 'Say what the block is for.' : 'Enter the player’s name.') : null;
  const phoneError = tried && !block && phone.trim() && !normalizePhone(phone) ? 'Enter a PH mobile number like 0912 345 6789, or leave it empty.' : null;
  const customValue = custom && customTotal.trim() !== '' ? Number(customTotal) : null;
  const customError = tried && custom && (customValue === null || !Number.isInteger(customValue) || customValue < 0) ? 'Enter the price in whole pesos.' : null;
  const shownTotal = block ? 0 : custom && customValue !== null && Number.isFinite(customValue) ? customValue : price.total;

  const save = async () => {
    setTried(true);
    if (name.trim().length < 2 || phoneError || customError || clash) return;
    setBusy(true);
    setProblem(null);
    const common = {
      courtId,
      date,
      hour,
      hours,
      paddles: paddles && !block,
      customerName: name.trim(),
      customerPhone: block ? '' : phone.trim(),
      paymentMethod: (block ? 'none' : method) as AdminPayment,
      note: note.trim() || null,
    };
    try {
      let saved: AdminBookingDetail;
      if (existing) {
        const body: UpdateBody = { ...common };
        if (!block) {
          if (custom && customValue !== null) body.total = customValue;
          else if (existing.customPrice) body.total = null; // back to the rate card
        }
        saved = await adminApi.update(existing.code, body);
      } else {
        const body: CreateBody = { ...common, kind, total: !block && custom ? customValue : null };
        saved = await adminApi.create(body);
      }
      desk.refresh();
      desk.notify(existing ? 'Changes saved.' : block ? 'Court blocked.' : 'Booking added.');
      onSaved(saved.code);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const heading = editing ? (block ? 'Edit block' : 'Edit booking') : block ? 'Block a court' : 'Add booking';

  return (
    <Sheet
      label={heading}
      onClose={onClose}
      title={
        <div>
          <div className="font-mono text-[11px] font-semibold tracking-wider text-zinc-500">{existing ? existing.code : 'New'}</div>
          <h2 className="font-heading text-xl font-bold tracking-tight text-zinc-950">{heading}</h2>
        </div>
      }
      footer={
        <div className="space-y-2">
          <Btn variant="primary" size="lg" className="w-full" loading={busy} disabled={!!clash} onClick={save}>
            {editing ? 'Save changes' : block ? 'Block these hours' : 'Add booking'}
            {!block && <span className="font-medium opacity-80">· {peso(shownTotal)}</span>}
          </Btn>
        </div>
      }
    >
      <form
        className="space-y-5 p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        noValidate
      >
        {!editing && (
          <Segmented
            label="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'walk_in', label: 'Walk-in or call' },
              { value: 'block', label: 'Block a court' },
            ]}
          />
        )}
        {editing && existing.source === 'online' && (
          <Card className="bg-zinc-50 p-3 text-xs text-zinc-600">This was booked online. Changes you make here don't notify the player, so tell them if you move it.</Card>
        )}

        <section className="space-y-4" aria-label="When and where">
          <Field label="Court">
            {() => (
              <Segmented
                label="Court"
                value={courtId}
                onChange={setCourtId}
                options={config.courts.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" hint={hour < 6 ? `Runs into early ${fmtDate(addDays(date, 1), { weekday: 'short', month: 'short', day: 'numeric' })}` : undefined}>
              {(id) => <TextInput id={id} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="appearance-none" />}
            </Field>
            <Field label="Starts at">
              {(id) => (
                <SelectInput id={id} value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                  {PLAY_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {clock(h)}
                      {h < 6 ? ' (after midnight)' : ''}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          </div>

          <div>
            <Label>How long</Label>
            <div className="mt-1.5 flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-1.5">
              <button
                type="button"
                aria-label="One hour less"
                disabled={hours <= 1}
                onClick={() => setHours((h) => Math.max(1, h - 1))}
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                <Minus className="h-5 w-5" />
              </button>
              <div className="text-center" aria-live="polite">
                <div className="font-heading text-lg font-bold leading-tight text-zinc-950">
                  {hours} hour{hours > 1 ? 's' : ''}
                </div>
                <div className="text-xs text-zinc-500">{hourSpan(hour, hours)}</div>
              </div>
              <button
                type="button"
                aria-label="One hour more"
                disabled={hours >= 12}
                onClick={() => setHours((h) => Math.min(12, h + 1))}
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>

          {clash && <ErrorNote>{clash} Pick another time or court.</ErrorNote>}
        </section>

        {block ? (
          <section className="space-y-3" aria-label="Reason">
            <Field label="What's it for?" error={nameError}>
              {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Net repair" maxLength={80} />}
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {BLOCK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setName(r)}
                  className={cx('rounded-full px-3 py-1.5 text-xs font-semibold ring-1 cursor-pointer', name === r ? 'bg-zinc-950 text-white ring-zinc-950' : 'bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50')}
                >
                  {r}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="space-y-4" aria-label="Player and payment">
            <Field label="Player's name" error={nameError}>
              {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="off" maxLength={80} />}
            </Field>
            <Field label="Mobile number" hint="Optional for walk-ins. Lets you call them and spot returning players." error={phoneError}>
              {(id) => <TextInput id={id} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0912 345 6789" autoComplete="off" />}
            </Field>
            <Field label="Paid with">
              {() => (
                <Segmented
                  label="Payment method"
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: 'cash', label: 'Cash' },
                    { value: 'gcash', label: 'GCash' },
                    { value: 'gotyme', label: 'GoTyme' },
                  ]}
                />
              )}
            </Field>
            <Switch checked={paddles} onChange={setPaddles} label="Paddle rental" hint={`${peso(config.paddleFee)} added to the price`} />
          </section>
        )}

        {!block && (
          <section className="space-y-3" aria-label="Price">
            <Card className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div>
                <Label>{custom ? 'Your price' : 'Price'}</Label>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {custom ? `Rate card says ${peso(price.total)}` : paddles ? `Court ${peso(price.courtCost)} + paddles ${peso(price.addons)}` : 'From the rate card'}
                </div>
              </div>
              <span className="font-heading text-2xl font-bold tabular-nums text-zinc-950">{peso(shownTotal)}</span>
            </Card>
            <Switch checked={custom} onChange={setCustom} label="Set my own price" hint="For a discount, a friend or a package deal." />
            {custom && (
              <Field label="Price in pesos" error={customError}>
                {(id) => <TextInput id={id} type="number" inputMode="numeric" min={0} step={1} value={customTotal} onChange={(e) => setCustomTotal(e.target.value)} placeholder={String(price.total)} autoFocus />}
              </Field>
            )}
          </section>
        )}

        <Field label="Note" hint="Only you see this.">
          {(id) => <TextArea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={block ? 'Anything to remember' : 'e.g. Pays at the desk, bringing 3 friends'} />}
        </Field>

        <ErrorNote>{problem}</ErrorNote>
        {/* Lets the keyboard's Go/Enter key submit */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          Save
        </button>
      </form>
    </Sheet>
  );
};
