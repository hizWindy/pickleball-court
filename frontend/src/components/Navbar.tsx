import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { motion } from 'motion/react';

interface NavbarProps {
  onOpenDirectBooking: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenDirectBooking }) => {
  return (
    <header className="fixed top-2 sm:top-3 inset-x-0 z-50 px-2 sm:px-6 pointer-events-none">
      <div className="max-w-6xl mx-auto pointer-events-auto">
        <div className="bg-white/95 backdrop-blur-xl border border-emerald-200/90 shadow-lg shadow-emerald-950/5 rounded-full px-2.5 sm:px-6 py-1.5 sm:py-2 flex items-center justify-between gap-1.5 sm:gap-6 transition-all">
          {/* Brand & Tagline with Official HousePickle Logo */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <a href="#" className="flex items-center gap-1.5 sm:gap-2 group shrink-0">
              <img
                src="/icon.svg"
                alt="HousePickle Club"
                width={32}
                height={32}
                className="w-6 h-6 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl shadow-xs group-hover:scale-105 transition-transform shrink-0"
              />
              <div className="flex flex-col">
                <div className="flex items-center gap-0.5 sm:gap-1 leading-none">
                  <span className="font-heading font-black text-xs xs:text-sm sm:text-base md:text-lg tracking-tight text-zinc-950 whitespace-nowrap">
                    HOUSE<span className="text-[#15803D]">PICKLE</span>
                  </span>
                  <span className="font-heading font-extrabold text-[8px] sm:text-[10px] tracking-widest text-[#15803D] uppercase bg-emerald-50 px-1 py-0.2 sm:px-1.5 sm:py-0.5 rounded border border-emerald-200 ml-0.5">
                    CLUB
                  </span>
                </div>
                <span className="text-[9px] font-sport font-extrabold tracking-widest text-zinc-400 uppercase hidden md:block mt-0.5 whitespace-nowrap">
                  Play • Connect • Repeat
                </span>
              </div>
            </a>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-xs font-heading font-bold uppercase tracking-wider text-zinc-600 shrink-0">
            <a href="#open-slots" className="hover:text-[#15803D] transition-colors whitespace-nowrap">
              Open Slots
            </a>
            <a href="#courts" className="hover:text-[#15803D] transition-colors whitespace-nowrap">
              Courts & Rates
            </a>
            <a href="#blueprint" className="hover:text-[#15803D] transition-colors whitespace-nowrap">
              Court Layout
            </a>
            <a href="#location" className="hover:text-[#15803D] transition-colors whitespace-nowrap">
              Location
            </a>
          </nav>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Book Court CTA: the one persistent booking button. The navbar is fixed, so it's always in reach. */}
            <motion.button
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              onClick={onOpenDirectBooking}
              className="group flex items-center gap-1.5 sm:gap-2 pl-2.5 sm:pl-4 pr-1 sm:pr-1.5 py-1.5 rounded-full bg-[#15803D] hover:bg-[#166534] text-white text-[11px] sm:text-xs font-sport font-bold uppercase tracking-wider transition-all cursor-pointer shadow-md shadow-emerald-950/20 shrink-0 whitespace-nowrap animate-book-glow md:animate-none motion-reduce:animate-none"
            >
              <span>Book<span className="hidden sm:inline"> Court</span></span>
              <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-white/20 group-hover:bg-[#CCFF00] group-hover:text-zinc-950 flex items-center justify-center transition-colors">
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:rotate-45 transition-transform" />
              </div>
            </motion.button>
          </div>
        </div>
      </div>
    </header>
  );
};
