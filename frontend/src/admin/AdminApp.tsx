import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import type { AppConfig } from '../types';
import { Toast } from '../components/booking/Toast';
import { adminApi, SIGNED_OUT_EVENT } from './api';
import { BookingDetail } from './BookingDetail';
import { BookingForm, type FormMode } from './BookingForm';
import { BookingsPage } from './Bookings';
import { DeskContext, type Desk, type FormSeed } from './desk';
import { useTab } from './hooks';
import { Login } from './Login';
import { OverviewPage } from './Overview';
import { SchedulePage } from './Schedule';
import { Shell } from './Shell';
import type { NavCounts } from './types';

/**
 * The desk is for one person: keep it out of search results, and give it its own app identity so
 * "Add to Home Screen" from here installs the Desk (opening on /admin), not the public site.
 */
function useQuietPage() {
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);

    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const appTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const before = { manifest: manifest?.href, title: appTitle?.content };
    if (manifest) manifest.href = '/admin.webmanifest';
    if (appTitle) appTitle.content = 'Desk';

    return () => {
      robots.remove();
      if (manifest && before.manifest) manifest.href = before.manifest;
      if (appTitle && before.title) appTitle.content = before.title;
    };
  }, []);
}

export default function AdminApp() {
  useQuietPage();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    adminApi.session().then(
      (s) => alive && setAuthed(s.authenticated),
      () => alive && setAuthed(false)
    );
    const out = () => setAuthed(false);
    window.addEventListener(SIGNED_OUT_EVENT, out);
    return () => {
      alive = false;
      window.removeEventListener(SIGNED_OUT_EVENT, out);
    };
  }, []);

  useEffect(() => {
    document.title = authed ? 'HousePickle Desk' : 'Sign in · HousePickle Desk';
  }, [authed]);

  if (authed === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-950" role="status" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-[#CCFF00]" />
      </div>
    );
  }
  if (!authed) return <Login onSignedIn={() => setAuthed(true)} />;
  return <DeskApp onSignedOut={() => setAuthed(false)} />;
}

function DeskApp({ onSignedOut }: { onSignedOut: () => void }) {
  const [tab, goTab] = useTab();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [counts, setCounts] = useState<NavCounts | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const [form, setForm] = useState<FormMode | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [preset, setPreset] = useState<{ status: string; nonce: number } | undefined>();
  const lastPending = useRef<number | null>(null);

  useEffect(() => {
    api.config().then(setConfig, () => {});
  }, []);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // The badge and tab title follow the queue, and a payment that arrives while the desk is open says so.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const c = await adminApi.counts();
        if (!alive) return;
        setCounts(c);
        if (lastPending.current !== null && c.toReview > lastPending.current) {
          setToast(c.toReview - lastPending.current === 1 ? 'New paid booking. Have a quick look at the receipt.' : 'New paid bookings. Have a quick look at the receipts.');
          setRefreshKey((k) => k + 1);
        }
        lastPending.current = c.toReview;
      } catch {
        // a dropped connection just skips this round
      }
    };
    poll();
    const id = window.setInterval(poll, 20000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [refreshKey]);

  const pending = counts?.toReview ?? 0;
  useEffect(() => {
    document.title = pending ? `(${pending}) HousePickle Desk` : 'HousePickle Desk';
  }, [pending]);

  const desk = useMemo<Desk>(
    () => ({
      config,
      counts,
      refreshKey,
      refresh,
      openBooking: (code) => {
        setForm(null);
        setDetail(code);
      },
      addBooking: (seed?: FormSeed) => {
        setDetail(null);
        setForm({ type: 'create', seed });
      },
      editBooking: (code) => {
        setDetail(null);
        setForm({ type: 'edit', code });
      },
      goto: (next, opts) => {
        if (opts?.status) setPreset({ status: opts.status, nonce: Date.now() });
        goTab(next);
      },
      notify: setToast,
    }),
    [config, counts, refreshKey, refresh, goTab]
  );

  const signOut = async () => {
    try {
      await adminApi.logout();
    } finally {
      window.history.replaceState(null, '', '/admin');
      onSignedOut();
    }
  };

  const closeForm = () => {
    // Backing out of an edit goes back to the booking you were looking at.
    if (form?.type === 'edit') setDetail(form.code);
    setForm(null);
  };

  return (
    <DeskContext.Provider value={desk}>
      <Shell tab={tab} onTab={goTab} pending={pending} onAdd={() => desk.addBooking()} onSignOut={signOut}>
        {tab === 'overview' && <OverviewPage />}
        {tab === 'bookings' && <BookingsPage presetStatus={preset} />}
        {tab === 'schedule' && <SchedulePage />}
      </Shell>

      {detail && <BookingDetail code={detail} onClose={() => setDetail(null)} />}
      {form && (
        <BookingForm
          mode={form}
          onClose={closeForm}
          onSaved={(code) => {
            setForm(null);
            setDetail(code);
          }}
        />
      )}
      <Toast message={toast} onDone={() => setToast(null)} bottomClass="bottom-24 lg:bottom-6" />
    </DeskContext.Provider>
  );
}
