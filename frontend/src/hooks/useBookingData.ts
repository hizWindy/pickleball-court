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

  useEffect(() => {
    let alive = true;
    api.config().then(
      (c) => alive && (setConfig(c), setError(null)),
      (e) => alive && setError(e instanceof ApiError ? e : new ApiError('unknown', String(e), 0))
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  return { config, error, reload: useCallback(() => setAttempt((a) => a + 1), []) };
}

// ── Live availability (polls while visible) ───────────────────────────────────
export function useAvailability(date: string | null, { enabled = true, intervalMs = 8000 } = {}) {
  const [data, setData] = useState<Availability | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const dateRef = useRef(date);
  dateRef.current = date;

  const refresh = useCallback(async () => {
    const d = dateRef.current;
    if (!d) return;
    setLoading(true);
    try {
      const res = await api.availability(d);
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
    setData((prev) => (prev?.date === date ? prev : null));
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
