import React from 'react';
import { COURT_DETAILS } from '../data/mockData';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-white border-t border-emerald-100 py-10 text-xs text-zinc-500">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="HousePickle Club" className="w-8 h-8 rounded-xl shadow-xs" />
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-heading font-black text-sm tracking-wide text-zinc-950">
                HOUSE<span className="text-[#15803D]">PICKLE</span>
              </span>
              <span className="font-heading font-extrabold text-[9px] tracking-widest text-[#15803D] uppercase bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
                CLUB
              </span>
            </div>
            <p className="text-[10px] font-sport font-extrabold tracking-wider text-zinc-400 uppercase mt-0.5">
              Play • Connect • Repeat • Koronadal City
            </p>
          </div>
        </div>

        <div className="text-center md:text-right space-y-1 font-sport">
          <p className="text-xs text-zinc-700 font-bold uppercase tracking-wider">
            "Good Players Make Better People"
          </p>
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-3 text-[11px] text-zinc-500">
            <span>Court 1 & Court 2</span>
            <span>•</span>
            <span>In front of Aloha Suites</span>
            <span>•</span>
            <span>Host: {COURT_DETAILS.contactPerson} ({COURT_DETAILS.contactNumber})</span>
            <span>•</span>
            <span className="text-[#15803D] font-bold">GCash Verified</span>
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-8 flex items-center gap-1 text-[11px] text-zinc-400">
        <span>© {new Date().getFullYear()} HousePickle Club</span>
        <span aria-hidden>·</span>
        {/* Quiet on purpose: the desk is protected by its password, not by being hard to find.
            It sits on the left because the back-to-top button covers the bottom-right corner. */}
        <a href="/admin" rel="nofollow" className="px-1 py-2 hover:text-zinc-600 focus-visible:text-zinc-700">
          Staff
        </a>
      </div>
    </footer>
  );
};
