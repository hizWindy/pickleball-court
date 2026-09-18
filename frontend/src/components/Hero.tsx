import React, { useState } from 'react';
import {
  MapPin,
  Phone,
  ArrowRight,
  Sparkles,
  Check,
  Zap,
  Clock,
  ShieldCheck,
  ChevronRight
} from 'lucide-react';
import { motion } from 'motion/react';
import { format, addDays, isSameDay } from 'date-fns';
import { COURT_DETAILS, COURTS, GENERATE_TIME_SLOTS } from '../data/mockData';
import { Court, TimeSlot } from '../types';
import { getBookedSlotIdsForDateAndCourt } from '../services/storage';

interface HeroProps {
  onOpenDirectBooking: (date?: Date, slot?: TimeSlot, court?: Court) => void;
}

export const Hero: React.FC<HeroProps> = ({ onOpenDirectBooking }) => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedCourt, setSelectedCourt] = useState<Court>(COURTS[0]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [timeFilter, setTimeFilter] = useState<'morning' | 'afternoon' | 'evening' | 'night_owl'>('morning');

  // Quick 7-day strip
  const dateOptions = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i));
  const dateStr = format(selectedDate, 'yyyy-MM-dd');

  // Slots
  const bookedSlotIds = getBookedSlotIdsForDateAndCourt(dateStr, selectedCourt.id);
  const allSlots = GENERATE_TIME_SLOTS();
  const currentSlots = allSlots.filter((s) => s.period === timeFilter);

  const isNight = selectedSlot?.period === 'night_owl';
  const hourlyRate = isNight ? selectedCourt.nightRate : selectedCourt.dayRate;

  return (
    <section id="console" className="relative pt-6 pb-12 sm:pb-16 bg-court-mesh overflow-hidden border-b border-emerald-100">
      {/* Decorative ambient blurred stadium glow orbs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#22C55E]/10 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-20 right-10 w-80 h-80 bg-[#84CC16]/10 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Dynamic Player Action Cutouts (Hero Section Background Only - Borderless Transparent Silhouette) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {/* Left Player Cutout: Bouchard Action Strike */}
        <motion.div
          initial={{ opacity: 0, x: -30, scale: 0.95 }}
          animate={{
            opacity: 1,
            x: 0,
            scale: 1,
            y: [0, -8, 0]
          }}
          transition={{
            opacity: { duration: 0.8, delay: 0.1 },
            x: { duration: 0.8, delay: 0.1 },
            y: { duration: 6, repeat: Infinity, ease: 'easeInOut' }
          }}
          className="absolute -left-1 sm:left-0 md:left-2 lg:left-4 xl:left-8 2xl:left-14 top-16 sm:top-12 lg:top-10 w-40 sm:w-52 md:w-64 lg:w-80 xl:w-96 opacity-100 select-none pointer-events-none z-0"
        >
          {/* Luminous Emerald Stadium Back-Glow */}
          <div className="absolute -inset-4 bg-[#22C55E]/20 rounded-full blur-2xl -z-10" />

          {/* Borderless Cutout Image with Athletic Silhouette Drop Shadow & Bottom Mesh Fade */}
          <img
            src="/images/player-cutout-1.png"
            alt="HousePickle Athlete Action"
            className="w-full h-auto object-contain drop-shadow-[0_15px_30px_rgba(21,128,61,0.25)]"
            style={{
              maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)'
            }}
          />
        </motion.div>

        {/* Right Player Cutout: Male Player Striking Ball */}
        <motion.div
          initial={{ opacity: 0, x: 30, scale: 0.95 }}
          animate={{
            opacity: 1,
            x: 0,
            scale: 1,
            y: [0, 8, 0]
          }}
          transition={{
            opacity: { duration: 0.8, delay: 0.2 },
            x: { duration: 0.8, delay: 0.2 },
            y: { duration: 7, repeat: Infinity, ease: 'easeInOut' }
          }}
          className="absolute -right-1 sm:right-0 md:right-2 lg:right-4 xl:right-8 2xl:right-14 top-20 sm:top-16 lg:top-14 w-36 sm:w-48 md:w-60 lg:w-76 xl:w-90 opacity-100 select-none pointer-events-none z-0"
        >
          {/* Luminous Lime Stadium Back-Glow */}
          <div className="absolute -inset-4 bg-[#84CC16]/25 rounded-full blur-2xl -z-10" />

          {/* Borderless Cutout Image with Athletic Silhouette Drop Shadow & Bottom Mesh Fade */}
          <img
            src="/images/player-cutout-2.png"
            alt="HousePickle Player Dink Rally"
            className="w-full h-auto object-contain drop-shadow-[0_15px_30px_rgba(132,204,22,0.28)]"
            style={{
              maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)'
            }}
          />
        </motion.div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
        {/* Dynamic Stadium Headline Block */}
        <div className="text-center max-w-3xl mx-auto mb-8 pt-2">
          {/* Compact Eyebrow Pill - Leaves sides open so athlete faces are never blocked */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-full bg-white/95 border border-emerald-200/90 shadow-xs mb-3 text-center max-w-fit mx-auto"
          >
            <span className="w-2 h-2 rounded-full bg-[#84CC16] animate-ping shrink-0" />
            <span className="text-[10px] sm:text-[11px] font-sport font-extrabold uppercase tracking-widest text-[#15803D] whitespace-nowrap">
              HousePickle Club • Koronadal City
            </span>
            <span className="text-zinc-300 hidden sm:inline">|</span>
            <span className="text-[10px] sm:text-[11px] font-sport font-bold uppercase tracking-wider text-emerald-800 hidden sm:inline whitespace-nowrap">
              Play • Connect • Repeat
            </span>
          </motion.div>

          {/* Main Display Headline with Centered Mobile Bounds */}
          <motion.h1
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-heading font-black tracking-tight uppercase text-zinc-950 leading-[1.15] break-words max-w-[280px] sm:max-w-xl md:max-w-2xl mx-auto drop-shadow-[0_2px_8px_rgba(255,255,255,0.95)]"
          >
            HOUSEPICKLE CLUB.{' '}
            <span className="bg-gradient-to-r from-[#15803D] via-[#16a34a] to-[#84CC16] bg-clip-text text-transparent block sm:inline">
              BOOK IN SECONDS.
            </span>
          </motion.h1>

          {/* Concise & Short Facility Description without Card Background */}
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mt-3 text-xs sm:text-sm md:text-base text-zinc-800 font-semibold max-w-lg mx-auto leading-relaxed drop-shadow-[0_1px_4px_rgba(255,255,255,0.95)]"
          >
            Two dedicated courts in front of Aloha Suites, Koronadal City. 24/7 knee-friendly play.
          </motion.p>

          {/* Quick Stat Highlights */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 mt-4 text-[11px] font-sport font-bold uppercase tracking-wider text-zinc-700"
          >
            <span className="px-3 py-1 rounded-full bg-white border border-emerald-200 shadow-xs flex items-center gap-1.5 text-[#15803D]">
              <Clock className="w-3.5 h-3.5" /> Court 1 & Court 2 (24/7 Open)
            </span>
            <span className="px-3 py-1 rounded-full bg-white border border-emerald-200 shadow-xs flex items-center gap-1.5 text-zinc-800">
              <Zap className="w-3.5 h-3.5 text-[#84CC16]" /> Standard ₱250 • Promo ₱200/hr
            </span>
            <span className="px-3 py-1 rounded-full bg-white border border-emerald-200 shadow-xs flex items-center gap-1.5 text-[#15803D]">
              <ShieldCheck className="w-3.5 h-3.5" /> Quick Pay With GCash
            </span>
          </motion.div>
        </div>

        {/* Double-Bezel Hardware Reservation Console */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2 }}
          className="double-bezel max-w-4xl mx-auto shadow-2xl shadow-emerald-950/10"
        >
          <div className="double-bezel-inner overflow-hidden">
            {/* Top Interactive Banner */}
            <div className="bg-gradient-to-r from-[#15803D] via-[#166534] to-[#093b1b] px-5 py-3 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#CCFF00] animate-pulse shadow-xs" />
                <span className="font-heading font-extrabold text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#CCFF00]" />
                  Quick Court Booking Console
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-sport uppercase tracking-wider text-emerald-100">
                <span>1. Date → 2. Time → 3. Court → 4. Pay</span>
                <button
                  type="button"
                  onClick={() => onOpenDirectBooking(selectedDate, selectedSlot || undefined, selectedCourt)}
                  className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white font-bold cursor-pointer transition-colors text-[10px]"
                >
                  Modal View
                </button>
              </div>
            </div>

            {/* Console Content */}
            <div className="p-4 sm:p-6 space-y-6">
              {/* Step 1: 7-Day Interactive Date Strip */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-heading font-black uppercase tracking-wider text-zinc-900 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-[#15803D] text-white flex items-center justify-center text-[10px]">1</span>
                    Select Playing Date
                  </label>
                  <span className="text-xs font-sport font-bold uppercase text-[#15803D]">
                    {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                  </span>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1.5 pt-0.5">
                  {dateOptions.map((date, i) => {
                    const isSelected = isSameDay(date, selectedDate);
                    const isToday = isSameDay(date, new Date());
                    return (
                      <motion.button
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        key={i}
                        type="button"
                        onClick={() => {
                          setSelectedDate(date);
                          setSelectedSlot(null);
                        }}
                        className={`relative shrink-0 px-4 py-2.5 rounded-2xl text-xs border transition-all cursor-pointer text-left min-w-[76px] ${
                          isSelected
                            ? 'bg-[#15803D] text-white border-[#15803D] shadow-md shadow-emerald-900/20'
                            : 'bg-white border-zinc-200 text-zinc-700 hover:border-emerald-300 hover:bg-emerald-50/40'
                        }`}
                      >
                        <div className="text-[10px] font-sport uppercase tracking-widest opacity-80">
                          {isToday ? 'Today' : format(date, 'EEE')}
                        </div>
                        <div className="font-heading font-extrabold text-base leading-tight mt-0.5">
                          {format(date, 'd')}
                        </div>
                        <div className="text-[9px] font-sport uppercase opacity-70">
                          {format(date, 'MMM')}
                        </div>
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[#CCFF00]" />
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Time Slots Matrix with Framer Gliding Pill Indicator */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                  <label className="text-xs font-heading font-black uppercase tracking-wider text-zinc-900 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-[#15803D] text-white flex items-center justify-center text-[10px]">2</span>
                    Select 24/7 Time Slot
                  </label>

                  {/* Framer animated period selector tabs - 2 cols on mobile, 4 on tablet/desktop */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs bg-zinc-100/90 p-1 rounded-xl border border-zinc-200/80 relative w-full sm:w-auto">
                    {(
                      [
                        { key: 'morning', label: 'Morning (6A-12P)' },
                        { key: 'afternoon', label: 'Afternoon (12P-5P)' },
                        { key: 'evening', label: 'Evening (5P-10P)' },
                        { key: 'night_owl', label: 'Night ₱200 (10P-6A)' }
                      ] as const
                    ).map((tab) => {
                      const isActive = timeFilter === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setTimeFilter(tab.key)}
                          className={`relative z-10 px-2 sm:px-3 py-2 sm:py-1 rounded-lg text-xs transition-colors cursor-pointer font-sport font-bold tracking-wide uppercase text-[10px] sm:text-[11px] text-center ${
                            isActive ? 'text-white' : 'text-zinc-600 hover:text-zinc-950'
                          }`}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="hero-period-active-tab"
                              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                              className="absolute inset-0 bg-[#15803D] rounded-lg -z-10 shadow-xs"
                            />
                          )}
                          <span className="truncate block">{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Slot grid with spring micro-motion - responsive from mobile to tablet to desktop */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {currentSlots.map((slot) => {
                    const isBooked = bookedSlotIds.includes(slot.id);
                    const isSelected = selectedSlot?.id === slot.id;

                    return (
                      <motion.button
                        whileHover={isBooked ? undefined : { scale: 1.02, y: -2 }}
                        whileTap={isBooked ? undefined : { scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        key={slot.id}
                        type="button"
                        disabled={isBooked}
                        onClick={() => setSelectedSlot(slot)}
                        className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer relative ${
                          isBooked
                            ? 'bg-zinc-100 border-zinc-200 text-zinc-400 cursor-not-allowed opacity-60'
                            : isSelected
                            ? 'bg-[#15803D] border-[#15803D] text-white font-bold shadow-md shadow-emerald-950/20'
                            : 'bg-white border-zinc-200 hover:border-[#15803D] text-zinc-800 hover:bg-emerald-50/30'
                        }`}
                      >
                        <div className="text-xs font-mono font-bold">{slot.time}</div>
                        <div className="text-[10px] mt-0.5 font-sport uppercase tracking-wider">
                          {isBooked ? (
                            'Reserved'
                          ) : slot.period === 'night_owl' ? (
                            <span className={isSelected ? 'text-[#CCFF00]' : 'text-[#15803D] font-bold'}>
                              ₱200 Promo
                            </span>
                          ) : (
                            <span className={isSelected ? 'text-white' : 'text-zinc-500'}>
                              ₱250 Standard
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#CCFF00]" />
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Step 3: Court Arena Select & Rate Summary Row */}
              <div className="pt-4 border-t border-zinc-200">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  {/* Court Selector Chips */}
                  <div className="md:col-span-6 space-y-1.5">
                    <label className="text-xs font-heading font-black uppercase tracking-wider text-zinc-900 flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-[#15803D] text-white flex items-center justify-center text-[10px]">3</span>
                      Choose Court Arena
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {COURTS.map((court) => {
                        const isSelected = selectedCourt.id === court.id;
                        return (
                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                            key={court.id}
                            type="button"
                            onClick={() => setSelectedCourt(court)}
                            className={`relative p-3 rounded-2xl border text-left text-xs transition-all cursor-pointer ${
                              isSelected
                                ? 'border-[#15803D] bg-[#F0FDF4] text-emerald-950 font-bold shadow-xs'
                                : 'border-zinc-200 bg-white hover:border-emerald-300 text-zinc-700'
                            }`}
                          >
                            <div className="font-heading uppercase font-black text-xs flex items-center justify-between">
                              <span>{court.name}</span>
                              {isSelected && <Check className="w-3.5 h-3.5 text-[#15803D]" />}
                            </div>
                            <div className="text-[11px] text-[#15803D] font-sport font-semibold mt-0.5">
                              Knee-friendly court • ₱{court.dayRate}/hr
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Summary & Button-in-Button CTA */}
                  <div className="md:col-span-6 flex flex-col sm:flex-row sm:items-center justify-end gap-3 sm:gap-4 pt-3 md:pt-0">
                    <div className="text-left sm:text-right text-xs">
                      <span className="text-zinc-500 block text-[11px] font-sport uppercase tracking-wider">
                        Rate:
                      </span>
                      <div className="font-heading font-black text-zinc-950 text-base flex items-baseline sm:justify-end gap-1">
                        <span>₱{hourlyRate}</span>
                        <span className="text-xs text-zinc-500 font-normal">/hour</span>
                        {isNight && (
                          <span className="text-[10px] px-2 py-0.2 rounded-full bg-emerald-100 text-[#15803D] font-sport font-bold uppercase">
                            ₱200 Promo Rate
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Button-in-Button CTA - full width on small mobile, auto on sm+ */}
                    <motion.button
                      whileHover={{ scale: 1.03, y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      type="button"
                      onClick={() => onOpenDirectBooking(selectedDate, selectedSlot || undefined, selectedCourt)}
                      className="group w-full sm:w-auto flex items-center justify-between sm:justify-start gap-3 pl-5 pr-2 py-2.5 rounded-full bg-[#15803D] hover:bg-[#166534] text-white text-xs font-sport font-extrabold uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-emerald-950/20"
                    >
                      <span>Book with GCash</span>
                      <div className="w-7 h-7 rounded-full bg-white/20 group-hover:bg-[#CCFF00] group-hover:text-zinc-950 flex items-center justify-center transition-colors">
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </motion.button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Location & Host Factual Strip */}
        <div className="mt-8 max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-zinc-600 font-sport bg-white/80 backdrop-blur-md p-3.5 rounded-2xl border border-emerald-200/70 shadow-xs">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[#15803D] shrink-0" />
            <span>In front of Aloha Suites, Purok Masinadyahon, Brgy. San Isidro, Koronadal City</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Phone className="w-3.5 h-3.5 text-[#15803D]" />
              Host: <strong className="text-zinc-800">{COURT_DETAILS.contactPerson}</strong> ({COURT_DETAILS.contactNumber})
            </span>
            <button
              type="button"
              onClick={() => onOpenDirectBooking()}
              className="hidden sm:inline-flex items-center gap-1 text-[#15803D] font-bold hover:underline cursor-pointer"
            >
              <span>Full Calendar</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
