import React, { useState, useEffect } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Download,
  MapPin
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  isSameMonth,
  isSameDay,
  isBefore,
  startOfToday
} from 'date-fns';
import confetti from 'canvas-confetti';
import { COURTS, COURT_DETAILS, SLOTS_BY_PERIOD } from '../../data/mockData';
import { Court, TimeSlot, Booking } from '../../types';
import { saveBooking, generateBookingCode, getBookedSlotIdsForDateAndCourt } from '../../services/storage';

interface DirectBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookingSuccess: (booking: Booking) => void;
  initialDate?: Date;
  initialSlot?: TimeSlot;
  initialCourt?: Court;
}

export const DirectBookingModal: React.FC<DirectBookingModalProps> = ({
  isOpen,
  onClose,
  onBookingSuccess,
  initialDate = new Date(),
  initialSlot,
  initialCourt
}) => {
  // Step navigation: 1 = Date, 2 = Time, 3 = Rate/Court, 4 = Direct Pay, 5 = Confirmed Pass
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Calendar state
  const [currentMonth, setCurrentMonth] = useState<Date>(initialDate);
  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);

  // Step 2: Time Slot state
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(initialSlot || null);
  const [activePeriod, setActivePeriod] = useState<'morning' | 'afternoon' | 'evening' | 'night_owl'>('morning');

  // Step 3: Rate / Court state
  const [selectedCourt, setSelectedCourt] = useState<Court>(initialCourt || COURTS[0]);
  const [durationHours, setDurationHours] = useState<number>(1);
  const [includePaddles, setIncludePaddles] = useState<boolean>(false);

  // Step 4: GCash Payment fields
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [gcashRefNumber, setGcashRefNumber] = useState<string>('');
  const [copiedNumber, setCopiedNumber] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Step 5: Confirmed Booking object
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialDate) {
        setSelectedDate(initialDate);
        setCurrentMonth(initialDate);
      }
      if (initialCourt) {
        setSelectedCourt(initialCourt);
      }
      if (initialSlot) {
        setSelectedSlot(initialSlot);
        setActivePeriod(initialSlot.period);
        setStep(4);
      } else {
        setStep(1);
      }
    }
  }, [isOpen, initialDate, initialSlot, initialCourt]);

  const today = startOfToday();
  const formattedDateStr = format(selectedDate, 'yyyy-MM-dd');

  const bookedSlotIds = getBookedSlotIdsForDateAndCourt(formattedDateStr, selectedCourt.id);
  const slotsForPeriod = SLOTS_BY_PERIOD[activePeriod];

  // Price calculations
  const isNightSlot = selectedSlot?.period === 'night_owl';
  const hourlyRate = isNightSlot ? selectedCourt.nightRate : selectedCourt.dayRate;
  const courtTotal = hourlyRate * durationHours;
  const paddleFee = includePaddles ? 80 : 0;
  const totalDue = courtTotal + paddleFee;

  const renderCalendarDays = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const rows = [];
    let days = [];
    let day = startDate;

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        const cloneDay = day;
        const isPast = isBefore(cloneDay, today);
        const isSelected = isSameDay(cloneDay, selectedDate);
        const isCurrentMonth = isSameMonth(cloneDay, monthStart);
        const isTodayDate = isSameDay(cloneDay, today);

        days.push(
          <motion.button
            whileTap={isPast ? undefined : { scale: 0.92 }}
            type="button"
            key={cloneDay.toISOString()}
            disabled={isPast}
            onClick={() => setSelectedDate(cloneDay)}
            className={`h-8 w-8 sm:h-9 sm:w-9 mx-auto rounded-md flex flex-col items-center justify-center text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer ${
              !isCurrentMonth
                ? 'text-zinc-300 opacity-40'
                : isPast
                ? 'text-zinc-300 line-through cursor-not-allowed'
                : isSelected
                ? 'bg-[#15803D] text-white font-bold shadow-xs'
                : isTodayDate
                ? 'border border-[#15803D] text-[#15803D] font-bold bg-emerald-50'
                : 'text-zinc-700 hover:bg-emerald-50 hover:text-[#15803D]'
            }`}
          >
            <span>{format(cloneDay, 'd')}</span>
          </motion.button>
        );
        day = addDays(day, 1);
      }
      rows.push(
        <div key={day.toISOString()} className="grid grid-cols-7 gap-1 text-center py-0.5">
          {days}
        </div>
      );
      days = [];
    }
    return rows;
  };

  const handleCopyGcash = () => {
    navigator.clipboard.writeText(COURT_DETAILS.gcashNumber);
    setCopiedNumber(true);
    setTimeout(() => setCopiedNumber(false), 2000);
  };

  const handleCompleteBooking = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!customerName.trim()) {
      setFormError('Please enter your full name.');
      return;
    }
    if (!customerPhone.trim() || customerPhone.length < 10) {
      setFormError('Please enter a valid mobile number.');
      return;
    }
    if (!gcashRefNumber.trim()) {
      setFormError('Please enter your GCash Reference Number.');
      return;
    }

    setIsSubmitting(true);

    setTimeout(() => {
      const newBooking: Booking = {
        id: `booking-${Date.now()}`,
        bookingRef: generateBookingCode(),
        courtId: selectedCourt.id,
        courtName: selectedCourt.name,
        date: formattedDateStr,
        slots: [selectedSlot?.id || 'slot-08'],
        timeRangeFormatted: `${selectedSlot?.time || '08:00 AM'} (${durationHours} hr${durationHours > 1 ? 's' : ''})`,
        hoursCount: durationHours,
        addons: includePaddles
          ? [{ addonId: 'addon-paddles', name: 'PickleFlex Pro Paddles (Pair)', quantity: 1, cost: 80 }]
          : [],
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        courtCost: courtTotal,
        addonsCost: paddleFee,
        discountAmount: 0,
        totalAmount: totalDue,
        paymentMethod: 'gcash',
        gcashRefNumber: gcashRefNumber.trim(),
        status: 'confirmed',
        createdAt: new Date().toISOString()
      };

      saveBooking(newBooking);

      try {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.6 }
        });
      } catch {
        // ignore
      }

      setIsSubmitting(false);
      setConfirmedBooking(newBooking);
      setStep(5);
      onBookingSuccess(newBooking);
    }, 500);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-900/60 backdrop-blur-xs overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', damping: 26, stiffness: 350 }}
            className="relative w-full max-w-xl my-auto rounded-3xl bg-white border border-emerald-300 shadow-2xl overflow-hidden text-zinc-900 max-h-[92vh] flex flex-col"
          >
            {/* Header Bar */}
            <div className="bg-gradient-to-r from-[#15803D] via-[#166534] to-[#093b1b] px-4 sm:px-6 py-3.5 sm:py-4 text-white flex items-center justify-between border-b border-[#0d4722] shrink-0">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center p-1.5 border border-white/20 shrink-0">
                  <img src="/housepickle-emblem.svg" alt="HousePickle" className="w-full h-full object-contain" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-sm sm:text-base font-heading font-black tracking-wide uppercase leading-tight">
                      Direct Match Booking
                    </h2>
                    <span className="w-2 h-2 rounded-full bg-[#CCFF00] animate-pulse" />
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-emerald-200 font-sport tracking-wider uppercase">
                    HousePickle Club • Play • Connect • Repeat
                  </p>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                className="p-1.5 sm:p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            {/* Step Progress Tracker */}
            {step !== 5 && (
              <div className="bg-[#F0FDF4] px-3 sm:px-5 py-2 sm:py-3 border-b border-emerald-200 shrink-0">
                <div className="grid grid-cols-4 gap-1 sm:gap-2 text-center text-[10px] sm:text-xs font-sport tracking-wider uppercase">
                  {(
                    [
                      { stepNum: 1, label: '1. Date' },
                      { stepNum: 2, label: '2. Time' },
                      { stepNum: 3, label: '3. Rate' },
                      { stepNum: 4, label: '4. Pay' }
                    ] as const
                  ).map((st) => (
                    <button
                      key={st.stepNum}
                      type="button"
                      onClick={() => setStep(st.stepNum)}
                      className={`py-1 sm:py-1.5 rounded-lg sm:rounded-xl text-center transition-all cursor-pointer font-bold ${
                        step === st.stepNum
                          ? 'text-white bg-[#15803D] shadow-xs'
                          : 'text-zinc-600 hover:text-zinc-950 hover:bg-white/60'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Content with AnimatePresence step transition */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1">
              <AnimatePresence mode="wait">
                {/* STEP 1: CALENDAR DATE */}
                {step === 1 && (
                  <motion.div
                    key="step-1"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-sport font-bold uppercase text-zinc-900 tracking-wide">
                        Step 1: Choose Date
                      </span>
                      <span className="text-[#15803D] font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {format(selectedDate, 'EEE, MMMM d, yyyy')}
                      </span>
                    </div>

                    {/* Month Navigation */}
                    <div className="border border-emerald-100 rounded-lg p-3 bg-emerald-50/30">
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-xs font-bold text-zinc-800 font-sport tracking-wide uppercase">
                          {format(currentMonth, 'MMMM yyyy')}
                        </span>
                        <div className="flex items-center gap-1">
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            type="button"
                            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                            disabled={isSameMonth(currentMonth, today)}
                            className="p-1 rounded hover:bg-white text-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            type="button"
                            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                            className="p-1 rounded hover:bg-white text-zinc-600 cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </motion.button>
                        </div>
                      </div>

                      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-zinc-400 mb-1 font-sport uppercase">
                        <div>Su</div>
                        <div>Mo</div>
                        <div>Tu</div>
                        <div>We</div>
                        <div>Th</div>
                        <div>Fr</div>
                        <div>Sa</div>
                      </div>

                      {renderCalendarDays()}
                    </div>

                    <div className="pt-2 flex items-center justify-between border-t border-zinc-100 text-xs">
                      <div className="flex gap-1.5 text-xs text-zinc-600">
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          type="button"
                          onClick={() => setSelectedDate(today)}
                          className="px-2.5 py-1 rounded bg-zinc-100 hover:bg-emerald-50 hover:text-[#15803D] cursor-pointer"
                        >
                          Today
                        </motion.button>
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          type="button"
                          onClick={() => setSelectedDate(addDays(today, 1))}
                          className="px-2.5 py-1 rounded bg-zinc-100 hover:bg-emerald-50 hover:text-[#15803D] cursor-pointer"
                        >
                          Tomorrow
                        </motion.button>
                      </div>

                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={() => setStep(2)}
                        className="px-3 sm:px-4 py-2 rounded-md bg-[#15803D] hover:bg-[#166534] text-white font-sport font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer shadow-xs text-xs"
                      >
                        <span><span className="hidden xs:inline">Continue to </span>Time</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </motion.button>
                    </div>
                  </motion.div>
                )}

                {/* STEP 2: TIME */}
                {step === 2 && (
                  <motion.div
                    key="step-2"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-sport font-bold uppercase text-zinc-900 tracking-wide">
                        Step 2: Choose Time Slot
                      </span>
                      <span className="text-[#15803D] font-medium">
                        {format(selectedDate, 'MMM d, yyyy')}
                      </span>
                    </div>

                    {/* Framer Gliding Tabs */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-emerald-50/70 rounded-lg text-xs text-center border border-emerald-200 relative">
                      {(
                        [
                          { key: 'morning', label: 'Morning' },
                          { key: 'afternoon', label: 'Afternoon' },
                          { key: 'evening', label: 'Evening' },
                          { key: 'night_owl', label: 'Night Owl' }
                        ] as const
                      ).map((tab) => {
                        const isActive = activePeriod === tab.key;
                        return (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActivePeriod(tab.key)}
                            className={`relative py-1.5 px-2 rounded-md transition-colors cursor-pointer font-sport font-semibold tracking-wide uppercase text-[11px] ${
                              isActive ? 'text-white font-bold' : 'text-zinc-600 hover:text-zinc-900'
                            }`}
                          >
                            {isActive && (
                              <motion.div
                                layoutId="modal-period-pill"
                                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                                className="absolute inset-0 bg-[#15803D] rounded-md shadow-xs z-0"
                              />
                            )}
                            <span className="relative z-10">{tab.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Grid */}
                    <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5 sm:gap-2 max-h-52 overflow-y-auto p-0.5">
                      {slotsForPeriod.map((slot) => {
                        const isBooked = bookedSlotIds.includes(slot.id);
                        const isSelected = selectedSlot?.id === slot.id;

                        return (
                          <motion.button
                            whileTap={isBooked ? undefined : { scale: 0.95 }}
                            key={slot.id}
                            type="button"
                            disabled={isBooked}
                            onClick={() => setSelectedSlot(slot)}
                            className={`p-2 rounded-md border text-center transition-colors cursor-pointer ${
                              isBooked
                                ? 'bg-zinc-100 border-zinc-200 text-zinc-400 cursor-not-allowed'
                                : isSelected
                                ? 'bg-[#15803D] border-[#15803D] text-white font-bold shadow-xs'
                                : 'bg-white border-zinc-200 hover:border-[#15803D] text-zinc-800'
                            }`}
                          >
                            <div className="text-xs font-mono font-bold leading-tight">{slot.time}</div>
                            <div className="text-[10px] mt-0.5 opacity-80">
                              {isBooked ? 'Booked' : slot.period === 'night_owl' ? 'Night' : 'Open'}
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>

                    <div className="pt-2 flex items-center justify-between border-t border-zinc-100 text-xs">
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="px-2.5 sm:px-3 py-1.5 rounded text-zinc-600 hover:bg-zinc-100 flex items-center gap-1 cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" /> Back
                      </button>

                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        disabled={!selectedSlot}
                        onClick={() => setStep(3)}
                        className="px-3 sm:px-4 py-2 rounded-md bg-[#15803D] hover:bg-[#166534] disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed text-white font-sport font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer shadow-xs text-xs"
                      >
                        <span><span className="hidden xs:inline">Continue to </span>Rate</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </motion.button>
                    </div>
                  </motion.div>
                )}

                {/* STEP 3: SELECT RATE / COURT */}
                {step === 3 && (
                  <motion.div
                    key="step-3"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-sport font-bold uppercase text-zinc-900 tracking-wide">
                        Step 3: Select Court & Duration
                      </span>
                      <span className="text-[#15803D] font-medium">
                        {selectedSlot?.time} • {format(selectedDate, 'MMM d')}
                      </span>
                    </div>

                    {/* Court List */}
                    <div className="space-y-2">
                      {COURTS.map((court) => {
                        const isSelected = selectedCourt.id === court.id;
                        const rate = isNightSlot ? court.nightRate : court.dayRate;

                        return (
                          <motion.div
                            whileTap={{ scale: 0.99 }}
                            key={court.id}
                            onClick={() => setSelectedCourt(court)}
                            className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-colors ${
                              isSelected
                                ? 'border-[#15803D] bg-emerald-50 text-emerald-950 font-medium shadow-xs'
                                : 'border-zinc-200 bg-white hover:border-zinc-300 text-zinc-800'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                  isSelected ? 'border-[#15803D] bg-[#15803D] text-white' : 'border-zinc-300'
                                }`}
                              >
                                {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                              </div>
                              <div>
                                <div className="text-xs font-bold text-zinc-900">{court.name}</div>
                                <div className="text-[11px] text-zinc-500">{court.surface}</div>
                              </div>
                            </div>

                            <div className="text-right">
                              <span className="text-xs font-bold text-[#15803D]">₱{rate}/hr</span>
                              {isNightSlot && (
                                <span className="block text-[10px] text-emerald-700">Night Rate</span>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>

                    {/* Duration & Paddles */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 pt-1 text-xs">
                      <div className="p-2.5 bg-emerald-50/40 rounded-lg border border-emerald-100">
                        <span className="font-sport font-bold uppercase text-zinc-700 block mb-1">
                          Duration:
                        </span>
                        <div className="flex gap-1">
                          {[1, 2, 3].map((hr) => (
                            <button
                              key={hr}
                              type="button"
                              onClick={() => setDurationHours(hr)}
                              className={`flex-1 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                                durationHours === hr
                                  ? 'bg-[#15803D] text-white font-bold shadow-xs'
                                  : 'bg-white border border-zinc-200 text-zinc-700'
                              }`}
                            >
                              {hr}h
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="p-2.5 bg-emerald-50/40 rounded-lg border border-emerald-100 flex items-center justify-between">
                        <div>
                          <span className="font-sport font-bold uppercase text-zinc-700 block">
                            Paddle Rental
                          </span>
                          <span className="text-[10px] text-zinc-500">PickleFlex Pair (+₱80)</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={includePaddles}
                          onChange={(e) => setIncludePaddles(e.target.checked)}
                          className="w-4 h-4 text-[#15803D] rounded border-zinc-300 focus:ring-[#15803D] cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Total Row */}
                    <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-zinc-600 block text-[11px]">Total Due:</span>
                        <div className="font-bold text-base text-[#15803D]">₱{totalDue}</div>
                      </div>
                      <div className="text-right text-zinc-600 text-[11px]">
                        {selectedCourt.name} ({durationHours} hr)
                      </div>
                    </div>

                    <div className="pt-2 flex items-center justify-between border-t border-zinc-100 text-xs">
                      <button
                        type="button"
                        onClick={() => setStep(2)}
                        className="px-2.5 sm:px-3 py-1.5 rounded text-zinc-600 hover:bg-zinc-100 flex items-center gap-1 cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" /> Back
                      </button>

                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={() => setStep(4)}
                        className="px-3 sm:px-4 py-2 rounded-md bg-[#15803D] hover:bg-[#166534] text-white font-sport font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer shadow-xs text-xs"
                      >
                        <span><span className="hidden xs:inline">Continue to </span>Direct Pay</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </motion.button>
                    </div>
                  </motion.div>
                )}

                {/* STEP 4: DIRECT PAY (GCASH) */}
                {step === 4 && (
                  <motion.form
                    key="step-4"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.15 }}
                    onSubmit={handleCompleteBooking}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-sport font-bold uppercase text-zinc-900 tracking-wide">
                        Step 4: Settle with GCash
                      </span>
                      <span className="text-[#15803D] font-bold">
                        {selectedSlot?.time} • ₱{totalDue}
                      </span>
                    </div>

                    {/* GCash Box */}
                    <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/60 flex flex-col sm:flex-row items-center gap-3 text-xs">
                      <div className="w-16 h-16 bg-white p-1 rounded-md border border-blue-200 flex items-center justify-center shrink-0">
                        <svg viewBox="0 0 100 100" className="w-full h-full">
                          <rect width="100" height="100" fill="white" />
                          <rect x="5" y="5" width="26" height="26" fill="#007DFE" rx="3" />
                          <rect x="9" y="9" width="18" height="18" fill="white" rx="2" />
                          <rect x="13" y="13" width="10" height="10" fill="#007DFE" />
                          <rect x="69" y="5" width="26" height="26" fill="#007DFE" rx="3" />
                          <rect x="5" y="69" width="26" height="26" fill="#007DFE" rx="3" />
                          <circle cx="50" cy="50" r="12" fill="#007DFE" />
                        </svg>
                      </div>

                      <div className="space-y-1 w-full text-zinc-700">
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500 text-[11px]">GCash Account:</span>
                          <span className="font-bold text-zinc-900">{COURT_DETAILS.gcashAccountName}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500 text-[11px]">Number:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-blue-900">{COURT_DETAILS.gcashNumber}</span>
                            <motion.button
                              whileTap={{ scale: 0.9 }}
                              type="button"
                              onClick={handleCopyGcash}
                              className="px-1.5 py-0.5 rounded bg-white text-zinc-600 text-[10px] border border-blue-200 hover:bg-blue-50 cursor-pointer"
                            >
                              {copiedNumber ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                            </motion.button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-0.5 border-t border-blue-100">
                          <span className="text-zinc-500 text-[11px]">Amount to Send:</span>
                          <span className="font-bold text-[#15803D]">₱{totalDue}</span>
                        </div>
                      </div>
                    </div>

                    {/* Inputs */}
                    <div className="space-y-2.5 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="font-semibold text-zinc-700 block mb-1">Your Full Name *</label>
                          <input
                            type="text"
                            required
                            autoComplete="name"
                            placeholder="Juan dela Cruz"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            className="w-full px-2.5 py-2 sm:py-1.5 rounded-md border border-zinc-300 text-xs focus:outline-none focus:border-[#15803D]"
                          />
                        </div>
                        <div>
                          <label className="font-semibold text-zinc-700 block mb-1">Mobile Number *</label>
                          <input
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            required
                            placeholder="0912..."
                            value={customerPhone}
                            onChange={(e) => setCustomerPhone(e.target.value)}
                            className="w-full px-2.5 py-2 sm:py-1.5 rounded-md border border-zinc-300 text-xs focus:outline-none focus:border-[#15803D]"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="font-semibold text-zinc-700 block mb-1">
                          GCash Reference Number (13 digits) *
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          required
                          placeholder="e.g. 1092837461928"
                          value={gcashRefNumber}
                          onChange={(e) => setGcashRefNumber(e.target.value)}
                          className="w-full px-2.5 py-2 sm:py-1.5 rounded-md border border-zinc-300 font-mono text-xs focus:outline-none focus:border-[#15803D]"
                        />
                      </div>
                    </div>

                    {formError && (
                      <div className="p-2 rounded-md bg-red-50 text-red-700 text-xs">
                        {formError}
                      </div>
                    )}

                    <div className="pt-2 flex items-center justify-between border-t border-zinc-100 text-xs">
                      <button
                        type="button"
                        onClick={() => setStep(3)}
                        className="px-2.5 sm:px-3 py-1.5 rounded text-zinc-600 hover:bg-zinc-100 flex items-center gap-1 cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" /> Back
                      </button>

                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="submit"
                        disabled={isSubmitting}
                        className="px-3 sm:px-4 py-2 rounded-md bg-[#15803D] hover:bg-[#166534] text-white font-sport font-bold uppercase tracking-wider cursor-pointer shadow-xs text-xs"
                      >
                        {isSubmitting ? 'Confirming...' : <span><span className="hidden xs:inline">Complete & </span>Generate Pass</span>}
                      </motion.button>
                    </div>
                  </motion.form>
                )}

                {/* STEP 5: CONFIRMED PASS */}
                {step === 5 && confirmedBooking && (
                  <motion.div
                    key="step-5"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-4 text-center"
                  >
                    <div className="w-10 h-10 rounded-full bg-emerald-100 text-[#15803D] mx-auto flex items-center justify-center">
                      <Check className="w-5 h-5 stroke-[3]" />
                    </div>

                    <div>
                      <h3 className="text-base font-sport font-bold tracking-wide uppercase text-zinc-900">
                        Court Reserved Successfully
                      </h3>
                      <p className="text-xs text-zinc-500">
                        Show this pass upon arrival at HousePickle Club.
                      </p>
                    </div>

                    <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50/40 text-left text-xs space-y-2">
                      <div className="flex justify-between items-center pb-2 border-b border-emerald-100">
                        <span className="font-mono font-bold text-[#15803D] text-sm">
                          {confirmedBooking.bookingRef}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-[#15803D]">
                          Paid via GCash
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Court:</span>
                          <span className="font-semibold text-zinc-800">{confirmedBooking.courtName}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Player:</span>
                          <span className="font-semibold text-zinc-800">{confirmedBooking.customerName}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Date:</span>
                          <span className="font-semibold text-zinc-800">{confirmedBooking.date}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Time Slot:</span>
                          <span className="font-bold text-[#15803D]">{confirmedBooking.timeRangeFormatted}</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-emerald-100 text-[11px] text-zinc-600 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                        <span>In front of Aloha Suites, Brgy. San Isidro, Koronadal City</span>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-1 text-xs">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={() => window.print()}
                        className="flex-1 py-2 rounded-md border border-zinc-300 text-zinc-700 font-medium hover:bg-zinc-50 flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" /> Print Pass
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-2 rounded-md bg-[#15803D] hover:bg-[#166534] text-white font-sport font-bold uppercase tracking-wider cursor-pointer shadow-xs"
                      >
                        Done
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
