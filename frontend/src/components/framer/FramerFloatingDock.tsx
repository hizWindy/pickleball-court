import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, ArrowRight } from 'lucide-react';

interface FramerFloatingDockProps {
  onOpenBooking: () => void;
}

export const FramerFloatingDock: React.FC<FramerFloatingDockProps> = ({ onOpenBooking }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let currentVisible = false;
    const handleScroll = () => {
      // Only trigger state update when crossing the visibility threshold
      const nextVisible = window.scrollY > 480;
      if (nextVisible !== currentVisible) {
        currentVisible = nextVisible;
        setIsVisible(nextVisible);
      }
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <div
          className="fixed bottom-3 sm:bottom-5 inset-x-0 z-30 pointer-events-none flex justify-center px-3 sm:px-4 pb-[env(safe-area-inset-bottom)]"
        >
          <motion.div
            initial={{ y: 50, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 50, opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            className="pointer-events-auto max-w-md w-full bg-white/95 backdrop-blur-xl border border-emerald-300 shadow-2xl shadow-emerald-950/20 rounded-full p-1.5 pl-3 sm:pl-4 flex items-center justify-between gap-2 sm:gap-3 text-xs ring-2 ring-emerald-100"
          >
            <div className="flex items-center gap-2 sm:gap-2.5 overflow-hidden">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#84CC16] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#15803D]" />
              </span>
              <div className="truncate">
                <div className="font-heading font-black text-zinc-950 text-xs flex items-center gap-1.5">
                  <span>Court 1 & 2<span className="hidden xs:inline"> Available</span></span>
                  <span className="text-[9px] text-[#15803D] font-sport uppercase px-1.5 sm:px-2 py-0.2 rounded-full bg-emerald-100 font-extrabold">
                    24/7
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500 font-sport font-semibold truncate">
                  Standard ₱250 • Promo ₱200/hr
                </div>
              </div>
            </div>

            {/* Button-in-Button CTA */}
            <motion.button
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              type="button"
              onClick={onOpenBooking}
              className="group shrink-0 pl-3 sm:pl-3.5 pr-1.5 py-1.5 rounded-full bg-[#15803D] hover:bg-[#166534] text-white font-sport font-extrabold text-[11px] sm:text-xs uppercase tracking-wider transition-all shadow-md shadow-emerald-950/20 flex items-center gap-1.5 sm:gap-2 cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Book Now</span>
              <div className="w-5 h-5 rounded-full bg-white/20 group-hover:bg-[#CCFF00] group-hover:text-zinc-950 flex items-center justify-center transition-colors">
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </motion.button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
