import React, { useState } from 'react';
import { motion } from 'motion/react';
import { COURTS } from '../data/mockData';
import { Court } from '../types';
import { FramerCourtVisualizer } from './framer/FramerCourtVisualizer';
import { Calendar, Maximize2, Sparkles, Check, ArrowRight, Sun, Moon } from 'lucide-react';

interface CourtShowcaseProps {
  onBookCourt: (court: Court) => void;
}

export const CourtShowcase: React.FC<CourtShowcaseProps> = ({ onBookCourt }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const gallery = [
    {
      title: 'HousePickle Club 3D Architecture',
      tag: 'Official 2-Court Vision',
      image: '/images/housepickle-render-cropped.png'
    },
    {
      title: 'Blue & Green Acrylic Court',
      tag: 'Knee-Friendly Surface',
      image: '/images/court-championship.webp'
    },
    {
      title: '24/7 Super Bright Night Lights',
      tag: 'No Blinding Glare',
      image: '/images/night-atmosphere.jpg'
    },
    {
      title: 'Official Court Dimensions & Kitchen',
      tag: 'Clean & Regulation',
      image: '/images/court-guide.webp'
    },
    {
      title: 'Rental Paddles & Balls',
      tag: 'Only ₱80 / pair',
      image: '/images/gear-paddle.webp'
    }
  ];

  return (
    <section id="courts" className="py-16 bg-white border-b border-zinc-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
        {/* Architectural Render Showcase Banner */}
        <div className="relative rounded-3xl overflow-hidden border border-emerald-300 shadow-xl group">
          <div className="relative aspect-[16/8] sm:aspect-[21/9] w-full bg-zinc-950 overflow-hidden">
            <img
              src="/images/housepickle-render-cropped.png"
              alt="HousePickle Club 3D Design"
              className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-700"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />

            {/* Top Tag */}
            <div className="absolute top-4 left-4 sm:top-6 sm:left-6 flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-[#CCFF00] font-sport font-extrabold text-xs uppercase tracking-wider border border-white/20 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#CCFF00] animate-ping" />
                Official 2-Court Venue Design
              </span>
            </div>

            {/* Bottom Slogan & Identity */}
            <div className="absolute bottom-4 left-4 right-4 sm:bottom-6 sm:left-6 sm:right-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3 text-white">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <img src="/housepickle-emblem.svg" alt="HousePickle Emblem" className="w-10 h-10 object-contain drop-shadow-md" />
                  <span className="font-heading font-black text-xl sm:text-3xl uppercase tracking-tight text-white">
                    HOUSE<span className="text-[#84CC16]">PICKLE</span> CLUB
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-zinc-300 font-sport font-bold uppercase tracking-widest">
                  "Good Players Make Better People" • Play • Connect • Repeat
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedImage('/images/housepickle-render-cropped.png')}
                  className="px-4 py-2 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md text-white text-xs font-sport font-bold uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 border border-white/20"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Enlarge Render</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Section 1: Direct Selection - CHOOSE YOUR COURT (Exactly Court 1 & Court 2) */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F0FDF4] border border-emerald-200 text-[#15803D] font-sport font-extrabold text-xs uppercase tracking-widest mb-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#84CC16]" />
                Direct Selection
              </div>
              <h3 className="text-2xl sm:text-4xl font-heading font-black text-zinc-950 uppercase tracking-tight">
                CHOOSE YOUR COURT
              </h3>
            </div>
            <div className="flex items-center gap-2 text-xs font-sport font-bold uppercase text-zinc-600">
              <span className="px-3 py-1 rounded-full bg-emerald-50 text-[#15803D] border border-emerald-200">
                Late Night Promo: ₱200/hr (10PM - 6AM)
              </span>
            </div>
          </div>

          {/* Dual Interactive Stadium Cards (Court 1 and Court 2) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {COURTS.map((court, idx) => {
              return (
                <motion.div
                  whileHover={{ y: -5 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  key={court.id}
                  className="rounded-3xl border border-emerald-200/80 bg-white overflow-hidden shadow-lg shadow-emerald-950/5 flex flex-col justify-between group"
                >
                  {/* Photo Header with Overlay Badges */}
                  <div className="relative h-56 overflow-hidden bg-zinc-950">
                    <img
                      src="/images/housepickle-render-cropped.png"
                      alt={court.name}
                      style={{ objectPosition: idx === 0 ? 'left center' : 'right center' }}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 opacity-90"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />

                    {/* Status Pill */}
                    <div className="absolute top-3 sm:top-4 left-3 sm:left-4 flex items-center gap-2">
                      <span className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-[#CCFF00] font-sport font-extrabold text-xs uppercase tracking-wider border border-white/20">
                        {court.name}
                      </span>
                    </div>

                    {/* Lighting Badge */}
                    <div className="absolute top-3 sm:top-4 right-3 sm:right-4">
                      <span className="px-2.5 py-1 rounded-full bg-[#15803D] text-white font-sport font-bold text-[9px] sm:text-[10px] uppercase tracking-wider shadow-xs">
                        <span className="hidden xs:inline">Super Bright </span>Night Lights
                      </span>
                    </div>

                    {/* Name & Surface over Image */}
                    <div className="absolute bottom-3 sm:bottom-4 left-3 sm:left-4 right-3 sm:right-4 text-white">
                      <h4 className="text-xl sm:text-3xl font-heading font-black uppercase text-white tracking-wide leading-tight">
                        {court.name}
                      </h4>
                      <p className="text-[11px] sm:text-xs text-zinc-300 font-medium mt-0.5">
                        Tournament Red & Charcoal Surface • Full 20 × 44 ft
                      </p>
                    </div>
                  </div>

                  {/* Pricing and Details Body */}
                  <div className="p-4 sm:p-6 space-y-4">
                    {/* Rate Chips */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                      <div className="p-3 rounded-2xl bg-zinc-50 border border-zinc-200/80 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1 text-[11px] font-sport font-bold uppercase text-zinc-500">
                            <Sun className="w-3.5 h-3.5 text-amber-500" />
                            Standard (6A-10P)
                          </div>
                          <div className="text-lg font-heading font-black text-zinc-900 mt-0.5">
                            ₱{court.dayRate}<span className="text-xs font-normal text-zinc-500">/hr</span>
                          </div>
                        </div>
                      </div>

                      <div className="p-3 rounded-2xl bg-[#F0FDF4] border border-emerald-200 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1 text-[11px] font-sport font-bold uppercase text-[#15803D]">
                            <Moon className="w-3.5 h-3.5 text-[#15803D]" />
                            Promo (10P-6A)
                          </div>
                          <div className="text-lg font-heading font-black text-[#15803D] mt-0.5">
                            ₱{court.nightRate}<span className="text-xs font-normal text-emerald-700">/hr</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Specs List */}
                    <div className="space-y-1.5 text-xs text-zinc-600 pt-1">
                      <div className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                        <span>Smooth red non-slip surface with charcoal kitchen</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                        <span>Sturdy center net with regulation tension strap</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                        <span>Clubhouse lounge access & free secure parking</span>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="pt-2">
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        type="button"
                        onClick={() => onBookCourt(court)}
                        className="w-full py-3 rounded-2xl bg-[#15803D] hover:bg-[#166534] text-white font-sport font-extrabold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-950/15"
                      >
                        <Calendar className="w-4 h-4" />
                        <span>Book {court.name} Now</span>
                        <ArrowRight className="w-4 h-4" />
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Section 2: Interactive Court Blueprint & Architecture */}
        <div id="blueprint">
          <div className="text-center max-w-2xl mx-auto mb-8">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F0FDF4] border border-emerald-200 text-[#15803D] font-sport font-extrabold text-xs uppercase tracking-widest mb-2">
              <Sparkles className="w-3.5 h-3.5 text-[#84CC16]" />
              Court Setup & Rules
            </div>
            <h2 className="text-2xl sm:text-4xl font-heading font-black text-zinc-950 uppercase tracking-tight">
              COURT LAYOUT & RULES
            </h2>
            <p className="text-xs text-zinc-500 font-medium mt-1">
              Official 20 × 44 ft playing area with clean boundaries and centered kitchen logo.
            </p>
          </div>

          <FramerCourtVisualizer />
        </div>

        {/* Section 3: Court & Atmosphere Photos Gallery */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-heading font-black text-zinc-900 uppercase tracking-wider">
              Court & Atmosphere Photos
            </h3>
            <span className="text-[11px] text-zinc-400 font-sport">Click image to enlarge</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {gallery.map((item, idx) => (
              <motion.div
                whileHover={{ y: -3 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                key={idx}
                onClick={() => setSelectedImage(item.image)}
                className={`border border-zinc-200 hover:border-[#15803D] rounded-2xl overflow-hidden bg-white shadow-xs transition-colors cursor-pointer group ${
                  idx === 4 ? 'col-span-2 sm:col-span-1' : ''
                }`}
              >
                <div className="h-28 sm:h-32 overflow-hidden bg-zinc-100 relative">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 backdrop-blur-md text-white border border-white/20 shadow-xs">
                    <Maximize2 className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="p-2.5">
                  <div className="text-xs font-heading font-black text-zinc-900 truncate">{item.title}</div>
                  <div className="text-[10px] font-sport uppercase tracking-wider text-[#15803D] font-bold mt-0.5">{item.tag}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Lightbox Modal */}
        {selectedImage && (
          <div
            onClick={() => setSelectedImage(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm cursor-pointer"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              className="relative max-w-4xl max-h-[85vh] rounded-3xl overflow-hidden bg-white p-3 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <img src={selectedImage} alt="Enlarged" className="w-full h-auto rounded-2xl object-contain max-h-[75vh]" />
              <div className="p-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedImage(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-950 text-white text-xs font-sport font-extrabold uppercase tracking-wider cursor-pointer"
                >
                  Close Preview
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </section>
  );
};
