import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { AnnouncementStrip } from './components/AnnouncementStrip';
import { NextOpenSlots } from './components/NextOpenSlots';
import { FramerBentoFeatures } from './components/framer/FramerBentoFeatures';
import { CourtShowcase } from './components/CourtShowcase';
import { FramerRulesAccordion } from './components/framer/FramerRulesAccordion';
import { LocationDetails } from './components/LocationDetails';
import { FramerScrollProgress } from './components/framer/FramerScrollProgress';
import { Footer } from './components/Footer';
import { Toast } from './components/booking/Toast';
import { ConfigContext, useConfigLoader } from './hooks/useBookingData';
import { device } from './lib/device';
import type { RescheduleSeed } from './components/booking/RescheduleSheet'; // type only: the sheet itself stays lazy
import type { Booking, BookingDraftSeed, BookingWithToken, Court } from './types';

// Booking screens are code-split; they're prefetched while the browser is idle.
const loadSheet = () => import('./components/booking/BookingSheet');
const loadLock = () => import('./components/booking/PaymentLock');
const loadPass = () => import('./components/booking/PassView');
const loadReschedule = () => import('./components/booking/RescheduleSheet');
const BookingSheet = lazy(() => loadSheet().then((m) => ({ default: m.BookingSheet })));
const PaymentLock = lazy(() => loadLock().then((m) => ({ default: m.PaymentLock })));
const PassView = lazy(() => loadPass().then((m) => ({ default: m.PassView })));
const RescheduleSheet = lazy(() => loadReschedule().then((m) => ({ default: m.RescheduleSheet })));

type Access = { code: string; token: string; booking?: Booking };

export function App() {
  const configState = useConfigLoader();

  const [sheet, setSheet] = useState<BookingDraftSeed | null>(null);
  // A hold survives refreshes: the device remembers it and the lock reopens on load.
  const [lock, setLock] = useState<Access | null>(() => device.activeHold());
  const [pass, setPass] = useState<(Access & { autoDownload?: boolean }) | null>(null);
  const [reschedule, setReschedule] = useState<RescheduleSeed | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lockRef = useRef(lock);
  lockRef.current = lock;

  useEffect(() => {
    device.dropLegacyData();

    const prefetch = () => [loadSheet, loadLock, loadPass, loadReschedule].forEach((l) => l());
    if ('requestIdleCallback' in window) {
      (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback(prefetch, { timeout: 2500 });
    } else {
      setTimeout(prefetch, 1500);
    }

    // Deep links: /?book=1 (PWA shortcut), /?pass=CODE (QR on the pass; opens only on the device that booked)
    // and /?reschedule=CODE (texted by the host, e.g. after a rain delay)
    const params = new URLSearchParams(window.location.search);
    const passCode = params.get('pass');
    const rescheduleCode = params.get('reschedule');
    if (passCode) {
      const token = device.tokenFor(passCode);
      if (token) setPass({ code: passCode, token });
    } else if (rescheduleCode) {
      // On the phone that booked, the saved token means no typing; otherwise the code is pre-filled for the form.
      setReschedule({ code: rescheduleCode, token: device.tokenFor(rescheduleCode) });
    } else if (params.has('book') && !device.activeHold()) {
      setSheet({});
    }
    if (passCode || rescheduleCode || params.has('book')) {
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
      setToast(booking?.status === 'cancelled' ? 'Slot released.' : 'This booking is closed.');
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

  const startReschedule = useCallback((seed: RescheduleSeed = {}) => {
    if (lockRef.current) return; // finish the current payment first
    setPass(null);
    setReschedule(seed);
  }, []);

  const handleRescheduled = useCallback((booking: Booking, token: string) => {
    device.savePass(booking.code, token);
    setReschedule(null);
    setPass({ code: booking.code, token, booking });
  }, []);

  const handleBookSpecificCourt = (court: Court) => openBooking({ courtId: court.id });
  // Any open layer makes the page behind it inert (no taps, no focus, hidden from screen readers).
  // For the payment window this is the "focus lock" from the payment rules.
  const behindLayer = !!(lock || sheet || pass || reschedule);

  return (
    <ConfigContext.Provider value={configState}>
      <div
        inert={behindLayer ? true : undefined}
        aria-hidden={behindLayer ? true : undefined}
        className="min-h-screen w-full overflow-x-hidden bg-white text-zinc-900 flex flex-col antialiased selection:bg-[#15803D] selection:text-white"
      >
        <FramerScrollProgress />

        <Navbar onOpenDirectBooking={() => openBooking()} />

        <main className="flex-1 pt-18 sm:pt-20">
          <AnnouncementStrip onBook={openBooking} />
          <Hero onOpenDirectBooking={openBooking} />
          <NextOpenSlots onBook={openBooking} />
          <FramerBentoFeatures />
          <CourtShowcase onBookCourt={handleBookSpecificCourt} />
          <FramerRulesAccordion onReschedule={() => startReschedule()} />
          <LocationDetails />
        </main>

        <Footer onReschedule={() => startReschedule()} />
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
            onReschedule={(b) => startReschedule({ code: b.code, token: pass.token })}
          />
        )}
        {reschedule && !lock && (
          <RescheduleSheet seed={reschedule} onClose={() => setReschedule(null)} onDone={handleRescheduled} />
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
