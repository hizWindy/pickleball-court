import { hourSpan, manilaHour } from './format';
import type { HourForecast, WeatherReport } from './types';

export const HOUR_MS = 3_600_000;

/** Hours that haven't finished yet, soonest first (the server's list can be a few minutes old). */
export const upcomingHours = (report: WeatherReport, nowMs: number): HourForecast[] => report.hours.filter((h) => Date.parse(h.at) + HOUR_MS > nowMs);

/** A stretch of consecutive hours at or above the warning chance. `to` is exclusive. */
export interface RainRun {
  from: number;
  to: number;
  peak: number;
}

export function rainRuns(hours: HourForecast[], warn: number): RainRun[] {
  const runs: RainRun[] = [];
  for (const h of hours) {
    if (h.probability < warn) continue;
    const from = Date.parse(h.at);
    const last = runs[runs.length - 1];
    if (last && last.to === from) {
      last.to = from + HOUR_MS;
      last.peak = Math.max(last.peak, h.probability);
    } else {
      runs.push({ from, to: from + HOUR_MS, peak: h.probability });
    }
  }
  return runs;
}

/** "3 – 6 PM" */
export const runSpan = (run: Pick<RainRun, 'from' | 'to'>) => hourSpan(manilaHour(run.from), Math.round((run.to - run.from) / HOUR_MS));

/** Shade of rain: the more likely, the deeper the blue. */
export const rainFill = (probability: number) => `rgba(2, 132, 199, ${(0.07 + 0.88 * (probability / 100)).toFixed(2)})`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface RainSummary {
  kind: 'rain' | 'dry' | 'unavailable';
  text: string;
}

/** One line for the overview card: when the next rain is likely, and how many paid bookings it touches. */
export function summarizeRain(report: WeatherReport | null, nowMs: number): RainSummary {
  if (!report || !report.available) return { kind: 'unavailable', text: 'Forecast unavailable right now.' };
  const soon = upcomingHours(report, nowMs).slice(0, 12);
  const run = rainRuns(soon, report.warnPercent)[0];
  const horizon = (soon.length ? Date.parse(soon[soon.length - 1].at) + HOUR_MS : nowMs);
  const affectedSoon = report.atRisk.filter((r) => Date.parse(r.booking.startAt) < horizon && Date.parse(r.booking.endAt) > nowMs).length;
  if (run) {
    return {
      kind: 'rain',
      text: `Rain likely ${runSpan(run)} (${run.peak}%) · ${affectedSoon ? `${plural(affectedSoon, 'paid booking', 'paid bookings')} affected` : 'no paid bookings affected'}`,
    };
  }
  if (report.atRisk.length) {
    return { kind: 'rain', text: `Dry for the next 12 hours. Rain later affects ${plural(report.atRisk.length, 'paid booking', 'paid bookings')}.` };
  }
  return { kind: 'dry', text: 'No rain expected in the next 12 hours.' };
}
