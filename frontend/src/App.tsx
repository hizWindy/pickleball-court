import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { FramerBentoFeatures } from './components/framer/FramerBentoFeatures';
import { CourtShowcase } from './components/CourtShowcase';
import { FramerRulesAccordion } from './components/framer/FramerRulesAccordion';
import { LocationDetails } from './components/LocationDetails';
import { FramerFloatingDock } from './components/framer/FramerFloatingDock';
import { FramerScrollProgress } from './components/framer/FramerScrollProgress';
import { Footer } from './components/Footer';
import { Toast } from './components/booking/Toast';
import { ConfigContext, useConfigLoader } from './hooks/useBookingData';
import { device } from './lib/device';
import type { Booking, BookingDraftSeed, BookingWithToken, Court } from './types';

// Booking screens are code-split; they're prefetched while the browser is idle.
const loadSheet = () => import('./components/booking/BookingSheet');
const loadLock = () => import('./components/booking/PaymentLock');
const loadPass = () => import('./components/booking/PassView');
const BookingSheet = lazy(() => loadSheet().then((m) => ({ default: m.BookingSheet })));
const PaymentLock = lazy(() => loadLock().then((m) => ({ default: m.PaymentLock })));
const PassView = lazy(() => loadPass().then((m) => ({ default: m.PassView })));

type Access = { code: string; token: string; booking?: Booking };

export function App() {
  const configState = useConfigLoader();

  const [sheet, setSheet] = useState<BookingDraftSeed | null>(null);
  // A hold survives refreshes: the device remembers it and the lock reopens on load.
  const [lock, setLock] = useState<Access | null>(() => device.activeHold());
  const [pass, setPass] = useState<(Access & { autoDownload?: boolean }) | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lockRef = useRef(lock);
  lockRef.current = lock;

  useEffect(() => {
    device.dropLegacyData();

    const prefetch = () => [loadSheet, loadLock, loadPass].forEach((l) => l());
    if ('requestIdleCallback' in window) {
      (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback(prefetch, { timeout: 2500 });
    } else {
      setTimeout(prefetch, 1500);
    }

    // Deep links: /?book=1 (PWA shortcut) and /?pass=CODE (QR on the pass; opens only on the device that booked)
    const params = new URLSearchParams(window.location.search);
    const passCode = params.get('pass');
    if (passCode) {
      const token = device.tokenFor(passCode);
      if (token) setPass({ code: passCode, token });
    } else if (params.has('book') && !device.activeHold()) {
      setSheet({});
    }
    if (passCode || params.has('book')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
  }, []);

  const openBooking = useCallback((seed: BookingDraftSeed = {}) => {
    if (lockRef.current) return; // finish the current payment first
    setSheet(seed);
  }, []);

  const handleHeld = useCallback(({ booking, accessToken }: BookingWithToken) => {
    device.savePass(booking.code, accessToken);
    device.setActiveHold(booking.code, accessToken);
    setSheet(null);
    setLock({ code: booking.code, token: accessToken, booking });
  }, []);

  const handleSubmitted = useCallback((booking: Booking) => {
    const current = lockRef.current;
    device.clearActiveHold();
    setLock(null);
    if (current) setPass({ code: booking.code, token: current.token, booking, autoDownload: true });
  }, []);

  const handleLockClosed = useCallback((booking: Booking | null, reason: 'expired' | 'cancelled' | 'gone') => {
    const current = lockRef.current;
    device.clearActiveHold();
    setLock(null);
    if (reason === 'gone' && current) {
      device.forgetPass(current.code);
    } else if (reason === 'expired') {
      setToast('Your hold expired, so the slot was released. Pick a time to book again.');
      setSheet({ date: booking?.playDate });
    } else if (reason === 'cancelled') {
      setToast(booking?.status === 'cancelled' ? 'Booking cancelled. The slot is free again.' : 'This booking is closed.');
    }
  }, []);

  const passRef = useRef(pass);
  passRef.current = pass;

  const resumePayment = useCallback((booking: Booking) => {
    const p = passRef.current;
    setPass(null);
    if (p) {
      device.setActiveHold(p.code, p.token);
      setLock({ code: p.code, token: p.token, booking });
    }
  }, []);

  const handleBookSpecificCourt = (court: Court) => openBooking({ courtId: court.id });
  // Any open layer makes the page behind it inert (no taps, no focus, hidden from screen readers).
  // For the payment window this is the "focus lock" from the payment rules.
  const behindLayer = !!(lock || sheet || pass);

  return (
    <ConfigContext.Provider value={configState}>
      <div
        inert={behindLayer ? true : undefined}
        aria-hidden={behindLayer ? true : undefined}
        className="min-h-screen w-full overflow-x-hidden bg-white text-zinc-900 flex flex-col antialiased selection:bg-[#15803D] selection:text-white pb-14"
      >
        <FramerScrollProgress />

        <Navbar onOpenDirectBooking={() => openBooking()} />

        <main className="flex-1 pt-18 sm:pt-20">
          <Hero onOpenDirectBooking={openBooking} />
          <FramerBentoFeatures />
          <CourtShowcase onBookCourt={handleBookSpecificCourt} />
          <FramerRulesAccordion />
          <LocationDetails />
        </main>

        <FramerFloatingDock onOpenBooking={() => openBooking()} />
        <Footer />
      </div>

      <Suspense fallback={null}>
        {sheet && !lock && <BookingSheet seed={sheet} onClose={() => setSheet(null)} onHeld={handleHeld} />}
        {pass && !lock && (
          <PassView
            key={pass.code}
            code={pass.code}
            token={pass.token}
            initial={pass.booking}
            autoDownload={pass.autoDownload}
            onClose={() => setPass(null)}
            onResumePayment={resumePayment}
          />
        )}
        {lock && (
          <PaymentLock key={lock.code} code={lock.code} token={lock.token} initial={lock.booking} onSubmitted={handleSubmitted} onClosed={handleLockClosed} />
        )}
      </Suspense>

      <Toast message={toast} onDone={() => setToast(null)} />
    </ConfigContext.Provider>
  );
}

export default App;
