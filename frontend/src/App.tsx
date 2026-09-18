import { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { FramerBentoFeatures } from './components/framer/FramerBentoFeatures';
import { CourtShowcase } from './components/CourtShowcase';
import { FramerRulesAccordion } from './components/framer/FramerRulesAccordion';
import { LocationDetails } from './components/LocationDetails';
import { FramerFloatingDock } from './components/framer/FramerFloatingDock';
import { FramerScrollProgress } from './components/framer/FramerScrollProgress';
import { Footer } from './components/Footer';
import { DirectBookingModal } from './components/booking/DirectBookingModal';
import { MyBookingsModal } from './components/MyBookingsModal';
import { getBookings } from './services/storage';
import { Booking, Court, TimeSlot } from './types';

export function App() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isDirectBookingOpen, setIsDirectBookingOpen] = useState(false);
  const [isMyBookingsOpen, setIsMyBookingsOpen] = useState(false);

  const [bookingInitialDate, setBookingInitialDate] = useState<Date>(new Date());
  const [bookingInitialSlot, setBookingInitialSlot] = useState<TimeSlot | undefined>(undefined);
  const [bookingInitialCourt, setBookingInitialCourt] = useState<Court | undefined>(undefined);

  useEffect(() => {
    setBookings(getBookings());
  }, []);

  const handleOpenDirectBooking = (date?: Date, slot?: TimeSlot, court?: Court) => {
    if (date) setBookingInitialDate(date);
    setBookingInitialSlot(slot);
    setBookingInitialCourt(court);
    setIsDirectBookingOpen(true);
  };

  const handleBookSpecificCourt = (court: Court) => {
    setBookingInitialCourt(court);
    setBookingInitialSlot(undefined);
    setIsDirectBookingOpen(true);
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
        onOpenMyBookings={() => setIsMyBookingsOpen(true)}
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

      {/* Direct Booking Modal */}
      <DirectBookingModal
        isOpen={isDirectBookingOpen}
        onClose={() => setIsDirectBookingOpen(false)}
        onBookingSuccess={handleBookingSuccess}
        initialDate={bookingInitialDate}
        initialSlot={bookingInitialSlot}
        initialCourt={bookingInitialCourt}
      />

      {/* My Passes Modal */}
      <MyBookingsModal
        isOpen={isMyBookingsOpen}
        onClose={() => setIsMyBookingsOpen(false)}
        bookings={bookings}
        onBookingsUpdated={(updated) => setBookings(updated)}
      />
    </div>
  );
}

export default App;
