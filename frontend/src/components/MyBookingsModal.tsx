import React, { useState } from 'react';
import {
  X,
  BookmarkCheck,
  Calendar,
  MapPin,
  Download,
  Trash2
} from 'lucide-react';
import { motion } from 'motion/react';
import { Booking } from '../types';
import { cancelBooking } from '../services/storage';

interface MyBookingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookings: Booking[];
  onBookingsUpdated: (updated: Booking[]) => void;
}

export const MyBookingsModal: React.FC<MyBookingsModalProps> = ({
  isOpen,
  onClose,
  bookings,
  onBookingsUpdated
}) => {
  const [selectedPass, setSelectedPass] = useState<Booking | null>(null);

  if (!isOpen) return null;

  const handleCancel = (bookingId: string) => {
    if (window.confirm('Are you sure you want to cancel this booking?')) {
      const updated = cancelBooking(bookingId);
      onBookingsUpdated(updated);
      if (selectedPass?.id === bookingId) {
        setSelectedPass(null);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-900/60 backdrop-blur-xs overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="relative w-full max-w-xl my-auto rounded-2xl bg-white shadow-2xl border border-emerald-200 overflow-hidden text-zinc-800"
      >
        {/* Header */}
        <div className="bg-[#15803D] px-6 py-4 text-white flex items-center justify-between border-b border-[#166534]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center text-white">
              <BookmarkCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-heading font-extrabold uppercase tracking-wide">
                My Court Passes
              </h3>
              <p className="text-[11px] text-emerald-100 font-sport">
                Saved match confirmations on this device
              </p>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        {/* List */}
        <div className="p-5 max-h-[65vh] overflow-y-auto space-y-3">
          {bookings.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Calendar className="w-10 h-10 text-zinc-300 mx-auto" />
              <div className="text-sm font-heading font-bold text-zinc-800 uppercase">
                No Passes Found
              </div>
              <p className="text-xs text-zinc-500 max-w-xs mx-auto leading-relaxed">
                Book a court slot using the reservation console or modal to generate your official pass.
              </p>
            </div>
          ) : (
            bookings.map((b) => {
              const isCancelled = b.status === 'cancelled';
              return (
                <div
                  key={b.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isCancelled
                      ? 'bg-zinc-50 border-zinc-200 opacity-60'
                      : 'bg-white border-emerald-200 hover:border-[#15803D] shadow-xs'
                  }`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[#15803D] text-xs">
                        {b.bookingRef}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-sport font-bold uppercase tracking-wider ${
                          isCancelled
                            ? 'bg-zinc-200 text-zinc-600'
                            : 'bg-emerald-100 text-[#15803D] border border-emerald-300'
                        }`}
                      >
                        {isCancelled ? 'Cancelled' : 'Confirmed'}
                      </span>
                    </div>

                    <span className="text-xs font-heading font-bold text-zinc-900">
                      ₱{b.totalAmount.toLocaleString()} (GCash)
                    </span>
                  </div>

                  <div className="py-2.5 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-zinc-400 block text-[10px] font-sport uppercase">Court:</span>
                      <span className="font-heading font-bold text-zinc-800">{b.courtName}</span>
                    </div>
                    <div>
                      <span className="text-zinc-400 block text-[10px] font-sport uppercase">Date & Time:</span>
                      <span className="font-semibold text-zinc-800">
                        {b.date} • {b.timeRangeFormatted}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-xs">
                    <span className="text-[11px] text-zinc-500 font-mono">
                      Ref: {b.gcashRefNumber}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {!isCancelled && (
                        <>
                          <motion.button
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.96 }}
                            onClick={() => setSelectedPass(b)}
                            className="px-3 py-1 rounded-lg bg-[#F0FDF4] hover:bg-emerald-100 text-[#15803D] border border-emerald-300 text-xs font-sport font-bold uppercase tracking-wider cursor-pointer"
                          >
                            View Pass
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => handleCancel(b.id)}
                            className="p-1 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer"
                            title="Cancel Booking"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </motion.button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Pass View */}
        {selectedPass && (
          <div className="p-4 bg-[#F0FDF4] border-t border-emerald-200 space-y-3">
            <div className="p-4 bg-white rounded-xl border border-emerald-200 text-xs space-y-2 shadow-xs">
              <div className="flex justify-between items-center">
                <span className="font-mono font-bold text-[#15803D] text-sm">{selectedPass.bookingRef}</span>
                <span className="font-heading font-bold text-zinc-900">{selectedPass.customerName}</span>
              </div>
              <div className="text-zinc-700">
                {selectedPass.courtName} • {selectedPass.date} ({selectedPass.timeRangeFormatted})
              </div>
              <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                <MapPin className="w-3 h-3 text-[#15803D]" /> In front of Aloha Suites, Brgy. San Isidro, Koronadal City
              </div>
            </div>

            <div className="flex gap-2">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => window.print()}
                className="flex-1 py-2 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white text-xs font-sport font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Print Ticket Pass
              </motion.button>
              <button
                type="button"
                onClick={() => setSelectedPass(null)}
                className="px-4 py-2 rounded-xl border border-zinc-300 text-zinc-700 text-xs font-sport font-bold uppercase tracking-wider hover:bg-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
