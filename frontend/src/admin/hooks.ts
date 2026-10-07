import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';

/**
 * Load data for a key and keep it fresh while the tab is visible.
 * Changing the key starts over; refreshing keeps the old result on screen so lists don't flash.
 */
export function useRemote<T>(key: string, load: () => Promise<T>, { intervalMs = 0, enabled = true, version = 0 } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(key);
  keyRef.current = key;

  const refresh = useCallback(async () => {
    const forKey = keyRef.current;
    setLoading(true);
    try {
      const result = await loadRef.current();
      if (keyRef.current === forKey) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (keyRef.current === forKey) setError(e instanceof ApiError ? e : new ApiError('unknown', String(e), 0));
    } finally {
      if (keyRef.current === forKey) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setData(null);
    setError(null);
    refresh();
    if (!intervalMs) return;
    const tick = () => document.visibilityState === 'visible' && refresh();
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [key, enabled, intervalMs, refresh]);

  // A bumped `version` (something changed elsewhere) reloads in place, without clearing what's on screen.
  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    if (enabled) refresh();
  }, [version, enabled, refresh]);

  return { data, error, loading, refresh, setData };
}

export type Tab = 'overview' | 'bookings' | 'schedule';
const TAB_PATH: Record<Tab, string> = { overview: '/admin', bookings: '/admin/bookings', schedule: '/admin/schedule' };

const tabFromPath = (path: string): Tab =>
  path.startsWith('/admin/bookings') ? 'bookings' : path.startsWith('/admin/schedule') ? 'schedule' : 'overview';

/** Three tabs on real URLs, so the back button and reloads behave. */
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

/** Re-render every `ms` so "5 min ago" labels stay honest. */
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
