import { useState, useEffect, lazy, Suspense } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { FramerBentoFeatures } from './components/framer/FramerBentoFeatures';
import { CourtShowcase } from './components/CourtShowcase';
import { FramerRulesAccordion } from './components/framer/FramerRulesAccordion';
import { LocationDetails } from './components/LocationDetails';
import { FramerFloatingDock } from './components/framer/FramerFloatingDock';
import { FramerScrollProgress } from './components/framer/FramerScrollProgress';
import { Footer } from './components/Footer';
import { getBookings } from './services/storage';
import { Booking, Court, TimeSlot } from './types';

// Lazy-load heavy modals to dramatically reduce initial JavaScript bundle size & execution time
const DirectBookingModal = lazy(() =>
  import('./components/booking/DirectBookingModal').then((m) => ({ default: m.DirectBookingModal }))
);
const MyBookingsModal = lazy(() =>
  import('./components/MyBookingsModal').then((m) => ({ default: m.MyBookingsModal }))
);

export function App() {
  const [bookings, setBookings] = useState<Booking[]>(() => getBookings());
  const [isDirectBookingOpen, setIsDirectBookingOpen] = useState(false);
  const [isMyBookingsOpen, setIsMyBookingsOpen] = useState(false);
  const [hasOpenedBooking, setHasOpenedBooking] = useState(false);
  const [hasOpenedMyBookings, setHasOpenedMyBookings] = useState(false);

  const [bookingInitialDate, setBookingInitialDate] = useState<Date>(new Date());
  const [bookingInitialSlot, setBookingInitialSlot] = useState<TimeSlot | undefined>(undefined);
  const [bookingInitialCourt, setBookingInitialCourt] = useState<Court | undefined>(undefined);

  useEffect(() => {
    // Prefetch modals during browser idle time so when clicked they render instantaneously with zero delay
    const prefetchModals = () => {
      import('./components/booking/DirectBookingModal');
      import('./components/MyBookingsModal');
    };
    if (typeof window !== 'undefined') {
      if ('requestIdleCallback' in window) {
        (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback(prefetchModals, { timeout: 2500 });
      } else {
        setTimeout(prefetchModals, 1500);
      }
    }
  }, []);

  const handleOpenDirectBooking = (date?: Date, slot?: TimeSlot, court?: Court) => {
    if (date) setBookingInitialDate(date);
    setBookingInitialSlot(slot);
    setBookingInitialCourt(court);
    setHasOpenedBooking(true);
    setIsDirectBookingOpen(true);
  };

  const handleBookSpecificCourt = (court: Court) => {
    setBookingInitialCourt(court);
    setBookingInitialSlot(undefined);
    setHasOpenedBooking(true);
    setIsDirectBookingOpen(true);
  };

  const handleOpenMyBookings = () => {
    setHasOpenedMyBookings(true);
    setIsMyBookingsOpen(true);
  };

  const handleBookingSuccess = (_newBooking: Booking) => {
    setBookings(getBookings());
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-white text-zinc-900 flex flex-col antialiased selection:bg-[#15803D] selection:text-white pb-14">
      {/* Scroll Progress & Motion Controller */}
      <FramerScrollProgress />

      {/* Top Clean Navbar */}
      <Navbar
        onOpenDirectBooking={() => handleOpenDirectBooking()}
        onOpenMyBookings={handleOpenMyBookings}
        bookingCount={bookings.filter((b) => b.status !== 'cancelled').length}
      />

      {/* Main Content */}
      <main className="flex-1 pt-18 sm:pt-20">
        {/* Hero with Immediate Above-the-fold Direct Booking Console */}
        <Hero onOpenDirectBooking={handleOpenDirectBooking} />

        {/* Framer Bento Features Grid */}
        <FramerBentoFeatures />

        {/* Court Blueprint & Hourly Rates Showcase */}
        <CourtShowcase onBookCourt={handleBookSpecificCourt} />

        {/* Interactive Rules & FAQ Accordion */}
        <FramerRulesAccordion />

        {/* Location & Contact Details */}
        <LocationDetails />
      </main>

      {/* Framer Floating Quick-Reserve Dock */}
      <FramerFloatingDock onOpenBooking={() => handleOpenDirectBooking()} />

      {/* Footer */}
      <Footer />

      {/* Direct Booking Modal (Code-split with idle prefetch) */}
      {hasOpenedBooking && (
        <Suspense fallback={null}>
          <DirectBookingModal
            isOpen={isDirectBookingOpen}
            onClose={() => setIsDirectBookingOpen(false)}
            onBookingSuccess={handleBookingSuccess}
            initialDate={bookingInitialDate}
            initialSlot={bookingInitialSlot}
            initialCourt={bookingInitialCourt}
          />
        </Suspense>
      )}

      {/* My Passes Modal (Code-split with idle prefetch) */}
      {hasOpenedMyBookings && (
        <Suspense fallback={null}>
          <MyBookingsModal
            isOpen={isMyBookingsOpen}
            onClose={() => setIsMyBookingsOpen(false)}
            bookings={bookings}
            onBookingsUpdated={(updated) => setBookings(updated)}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
