import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, serverNowMs } from '../lib/api';

/**
 * What each screen last showed, kept in memory while the desk is open. Switching tabs, reopening a booking or
 * changing a filter shows the previous result at once and refreshes it quietly, instead of starting from grey
 * placeholders every time. It is cleared on sign-out, and never written to disk.
 */
const memory = new Map<string, unknown>();
const MEMORY_LIMIT = 80;
export const clearRemoteCache = () => memory.clear();
function remember(key: string, value: unknown) {
  memory.delete(key);
  memory.set(key, value);
  if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value as string);
}

/**
 * Load data for a key and keep it fresh while the tab is visible.
 * Shows the last result for the key straight away (see above) and refreshes behind it: polling and "something
 * changed" reloads never blink the screen. `keepPrevious` holds on to the old result while a new key (a filter, a
 * range, "show more") loads, so lists don't empty out between two pages.
 */
export function useRemote<T>(key: string, load: () => Promise<T>, { intervalMs = 0, enabled = true, version = 0, keepPrevious = false } = {}) {
  const [data, setDataState] = useState<T | null>(() => (memory.get(key) as T | undefined) ?? null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(() => !memory.has(key));
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(key);
  keyRef.current = key;

  /** `background` reloads (polling, version bumps, a cached screen) don't raise the loading flag. */
  const run = useCallback(async (background: boolean) => {
    const forKey = keyRef.current;
    if (!background) setLoading(true);
    try {
      const result = await loadRef.current();
      remember(forKey, result);
      if (keyRef.current === forKey) {
        setDataState(result);
        setError(null);
      }
    } catch (e) {
      if (keyRef.current === forKey) setError(e instanceof ApiError ? e : new ApiError('unknown', String(e), 0));
    } finally {
      if (keyRef.current === forKey) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => run(false), [run]);
  const setData = useCallback((value: T | null) => {
    if (value !== null) remember(keyRef.current, value);
    setDataState(value);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const cached = memory.get(key) as T | undefined;
    setDataState((prev) => (cached !== undefined ? cached : keepPrevious ? prev : null));
    setError(null);
    run(cached !== undefined);
    if (!intervalMs) return;
    const tick = () => document.visibilityState === 'visible' && run(true);
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
    // keepPrevious is a constant per call site
  }, [key, enabled, intervalMs, run]);

  // A bumped `version` (something changed elsewhere) reloads in place, without clearing what's on screen.
  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    if (enabled) run(true);
  }, [version, enabled, run]);

  return { data, error, loading, refresh, setData };
}

export type Tab = 'overview' | 'bookings' | 'schedule' | 'weather';
const TAB_PATH: Record<Tab, string> = { overview: '/admin', bookings: '/admin/bookings', schedule: '/admin/schedule', weather: '/admin/weather' };

const tabFromPath = (path: string): Tab =>
  path.startsWith('/admin/bookings')
    ? 'bookings'
    : path.startsWith('/admin/schedule')
      ? 'schedule'
      : path.startsWith('/admin/weather')
        ? 'weather'
        : 'overview';

/** Four tabs on real URLs, so the back button and reloads behave. */
export function useTab(): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(() => tabFromPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setTab(tabFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: Tab) => {
    if (window.location.pathname !== TAB_PATH[next]) window.history.pushState(null, '', TAB_PATH[next]);
    setTab(next);
    window.scrollTo({ top: 0 });
  }, []);
  return [tab, go];
}

/** The server's clock (a phone's own clock can be minutes off), re-read every `ms` so "5 min ago" and countdowns stay honest. */
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => serverNowMs());
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverNowMs()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
