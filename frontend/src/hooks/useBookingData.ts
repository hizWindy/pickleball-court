import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError, serverNowMs } from '../lib/api';
import type { AppConfig, Availability } from '../types';

// ── Config (fetched once, shared) ─────────────────────────────────────────────
export interface ConfigState {
  config: AppConfig | null;
  error: ApiError | null;
  reload: () => void;
}

export const ConfigContext = createContext<ConfigState>({ config: null, error: null, reload: () => {} });
export const useConfig = () => useContext(ConfigContext);

export function useConfigLoader(): ConfigState {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  const reload = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    let alive = true;
    api.config().then(
      (c) => {
        if (!alive) return;
        failures.current = 0;
        setConfig(c);
        setError(null);
      },
      (e) => {
        if (!alive) return;
        failures.current += 1;
        setError(e instanceof ApiError ? e : new ApiError('unknown', String(e), 0));
      }
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  // A phone that opens the app on a weak signal (or just switched back to it) must not stay stuck on an empty
  // page until someone refreshes: keep trying with growing pauses, and try at once when the network is back.
  useEffect(() => {
    if (config) return;
    const wait = Math.min(2000 * 2 ** Math.max(0, failures.current - 1), 15000);
    const timer = error ? window.setTimeout(reload, wait) : undefined;
    const again = () => document.visibilityState === 'visible' && reload();
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [config, error, reload]);

  return { config, error, reload };
}

// ── Live availability (polls while visible) ───────────────────────────────────
// The home page asks for the same day from several places (the hero, the "next open slots" strip, the announcement
// bar, the booking sheet). They share one request at a time, and a screen that opens later starts from the last
// answer instead of an empty grid, then refreshes it.
const lastAvailability = new Map<string, Availability>();
const inFlight = new Map<string, Promise<Availability>>();

function fetchAvailability(date: string): Promise<Availability> {
  const running = inFlight.get(date);
  if (running) return running;
  const request = api
    .availability(date)
    .then((res) => {
      lastAvailability.set(date, res);
      if (lastAvailability.size > 12) lastAvailability.delete(lastAvailability.keys().next().value as string);
      return res;
    })
    .finally(() => inFlight.delete(date));
  inFlight.set(date, request);
  return request;
}

export function useAvailability(date: string | null, { enabled = true, intervalMs = 8000 } = {}) {
  const [data, setData] = useState<Availability | null>(() => (date ? lastAvailability.get(date) ?? null : null));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const dateRef = useRef(date);
  dateRef.current = date;

  const refresh = useCallback(async () => {
    const d = dateRef.current;
    if (!d) return;
    setLoading(true);
    try {
      const res = await fetchAvailability(d);
      if (dateRef.current === d) {
        setData(res);
        setError(null);
      }
    } catch (e) {
      if (dateRef.current === d) setError(e instanceof ApiError ? e : null);
    } finally {
      if (dateRef.current === d) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!date || !enabled) return;
    setData((prev) => (prev?.date === date ? prev : lastAvailability.get(date) ?? null));
    refresh();
    const tick = () => document.visibilityState === 'visible' && refresh();
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [date, enabled, intervalMs, refresh]);

  return { data: data?.date === date ? data : null, error, loading, refresh };
}

// ── Countdown to a server deadline ────────────────────────────────────────────
/** Milliseconds left until `deadlineIso`, measured on the server's clock. */
export function useCountdown(deadlineIso: string | null) {
  const compute = () => (deadlineIso ? Date.parse(deadlineIso) - serverNowMs() : 0);
  const [left, setLeft] = useState(compute);

  useEffect(() => {
    if (!deadlineIso) return;
    const update = () => setLeft(Date.parse(deadlineIso) - serverNowMs());
    update();
    const id = window.setInterval(update, 500);
    document.addEventListener('visibilitychange', update); // back from the GCash app
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', update);
    };
  }, [deadlineIso]);

  return left;
}
