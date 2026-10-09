import React, { useState, useRef } from 'react';
import { motion, AnimatePresence, useInView } from 'motion/react';
import { Sparkles, Eye, Layers, Play, Pause } from 'lucide-react';

interface Hotspot {
  id: string;
  name: string;
  title: string;
  desc: string;
  x: number; // percentage
  y: number; // percentage
  tag: string;
  badgeColor: string;
}

const HOTSPOTS: Hotspot[] = [
  {
    id: 'kitchen',
    name: 'The Kitchen Area',
    title: '7 Feet from the Net',
    desc: 'The most important rule in pickleball! Just let the ball bounce first before stepping inside this zone to hit it. No hitting out of the air while inside.',
    x: 50,
    y: 42,
    tag: 'Easy Rule',
    badgeColor: 'bg-[#D2EE5E] text-zinc-950'
  },
  {
    id: 'net',
    name: 'Center Net',
    title: '34 Inches at Center',
    desc: 'Official height steel-cabled net. Lower in the middle so you can hit fast crosscourt dinks and rallies with ease.',
    x: 50,
    y: 50,
    tag: 'Court Net',
    badgeColor: 'bg-white text-zinc-900'
  },
  {
    id: 'baseline',
    name: 'Serving & Deep Baseline',
    title: 'Back of the Court (44 ft total)',
    desc: 'Where you serve and defend. Serves must be hit underhand into the diagonally opposite box past the kitchen.',
    x: 75,
    y: 82,
    tag: 'Serving Area',
    badgeColor: 'bg-emerald-100 text-[#15803D]'
  },
  {
    id: 'lights',
    name: 'Bright Night Lights',
    title: 'Super Bright Night Floodlights',
    desc: 'Four elevated night lights set up so you can clearly see the ball even at midnight without blinding your eyes.',
    x: 18,
    y: 18,
    tag: '24/7 Lights',
    badgeColor: 'bg-amber-100 text-amber-900'
  },
  {
    id: 'surface',
    name: 'Knee-Friendly Soft Surface',
    title: 'Cushioned Non-Slip Coating',
    desc: 'Soft rubberized cushion beneath the surface that absorbs shocks to protect your knees, ankles, and feet during games.',
    x: 28,
    y: 78,
    tag: 'Safe for Knees',
    badgeColor: 'bg-blue-100 text-blue-900'
  }
];

export const FramerCourtVisualizer: React.FC = () => {
  const visualizerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(visualizerRef, { margin: '150px' });
  const [activeHotspot, setActiveHotspot] = useState<Hotspot | null>(HOTSPOTS[0]);
  const [isSimulating, setIsSimulating] = useState(true);

  return (
    <div ref={visualizerRef} className="double-bezel max-w-5xl mx-auto shadow-2xl shadow-emerald-950/10">
      <div className="double-bezel-inner overflow-hidden">
        {/* Header Bar */}
        <div className="bg-gradient-to-r from-[#15803D] via-[#166534] to-[#093b1b] px-5 py-3.5 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#D2EE5E] animate-pulse" />
            <span className="font-heading font-black text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#D2EE5E]" />
              Court Layout & Simple Rules Guide
            </span>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={() => setIsSimulating(!isSimulating)}
              className="text-[11px] font-sport font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer flex items-center gap-1.5 border border-white/20"
            >
              {isSimulating ? <Pause className="w-3 h-3 text-[#D2EE5E]" /> : <Play className="w-3 h-3 text-[#D2EE5E]" />}
              <span>{isSimulating ? 'Pause Ball Rally' : 'Simulate Rally'}</span>
            </motion.button>
          </div>
        </div>

        <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Visual Court Canvas */}
          <div className="lg:col-span-8 relative">
            {/* Court Container */}
            <div className="relative aspect-[16/9] w-full bg-zinc-950 rounded-2xl p-3 sm:p-4 border-2 border-zinc-800 shadow-2xl overflow-hidden flex items-center justify-center select-none">
              {/* Outer Runoff Texture with Stadium Lighting Glow */}
              <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 via-zinc-950 to-zinc-900 opacity-95" />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-28 bg-[#D2EE5E]/10 rounded-full blur-2xl pointer-events-none" />

              {/* Court Boundary (White Lines) */}
              <div className="relative w-[92%] h-[85%] bg-[#DC2626] border-[3px] border-white rounded-xs shadow-2xl overflow-hidden flex flex-col">
                {/* Top Half Court (Tournament Red) */}
                <div className="relative flex-1 border-b border-white/80 bg-[#DC2626]">
                  {/* Service Courts */}
                  <div className="absolute inset-x-0 top-0 h-[50%] grid grid-cols-2 border-b-[3px] border-white">
                    <div className="border-r-[2px] border-white flex items-center justify-center p-1">
                      <span className="text-[8px] sm:text-[10px] md:text-xs font-sport font-extrabold uppercase text-white/60 tracking-tight sm:tracking-widest text-center leading-tight">
                        <span className="hidden sm:inline">Right Service Box</span>
                        <span className="sm:hidden">Right Box</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-center p-1">
                      <span className="text-[8px] sm:text-[10px] md:text-xs font-sport font-extrabold uppercase text-white/60 tracking-tight sm:tracking-widest text-center leading-tight">
                        <span className="hidden sm:inline">Left Service Box</span>
                        <span className="sm:hidden">Left Box</span>
                      </span>
                    </div>
                  </div>

                    {/* Non-Volley Zone (The Kitchen) Top - Charcoal Gray with HousePickle Branding */}
                  <div className="absolute inset-x-0 bottom-0 h-[50%] bg-[#374151] flex items-center justify-center">
                    <div className="flex items-center gap-1 sm:gap-1.5 opacity-90 px-1">
                      <img src="/icon.svg" alt="HousePickle" width={14} height={14} loading="lazy" decoding="async" className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                      <span className="text-[8px] sm:text-[10px] md:text-[11px] font-heading font-black uppercase text-white tracking-wider sm:tracking-widest">
                        <span className="hidden sm:inline">Kitchen • Charcoal Zone</span>
                        <span className="sm:hidden">Kitchen Zone</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Regulation Center Net Line */}
                <div className="relative h-2 bg-white shadow-md z-10 flex items-center justify-center">
                  <div className="absolute w-10 h-4 bg-zinc-950 border border-white rounded-xs text-[7px] text-[#D2EE5E] flex items-center justify-center font-black tracking-widest">
                    NET
                  </div>
                </div>

                {/* Bottom Half Court (Tournament Red) */}
                <div className="relative flex-1 bg-[#DC2626]">
                  {/* Non-Volley Zone (The Kitchen) Bottom - Charcoal Gray with HousePickle Branding */}
                  <div className="absolute inset-x-0 top-0 h-[50%] bg-[#374151] flex items-center justify-center border-b-[3px] border-white">
                    <div className="flex items-center gap-1 sm:gap-1.5 opacity-90 px-1">
                      <img src="/icon.svg" alt="HousePickle" width={14} height={14} loading="lazy" decoding="async" className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                      <span className="text-[8px] sm:text-[10px] md:text-[11px] font-heading font-black uppercase text-white tracking-wider sm:tracking-widest">
                        <span className="hidden sm:inline">Kitchen • Charcoal Zone</span>
                        <span className="sm:hidden">Kitchen Zone</span>
                      </span>
                    </div>
                  </div>

                  {/* Service Courts */}
                  <div className="absolute inset-x-0 bottom-0 h-[50%] grid grid-cols-2">
                    <div className="border-r-[2px] border-white flex items-center justify-center p-1">
                      <span className="text-[8px] sm:text-[10px] md:text-xs font-sport font-extrabold uppercase text-white/60 tracking-tight sm:tracking-widest text-center leading-tight">
                        <span className="hidden sm:inline">Left Service Box</span>
                        <span className="sm:hidden">Left Box</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-center p-1">
                      <span className="text-[8px] sm:text-[10px] md:text-xs font-sport font-extrabold uppercase text-white/60 tracking-tight sm:tracking-widest text-center leading-tight">
                        <span className="hidden sm:inline">Right Service Box</span>
                        <span className="sm:hidden">Right Box</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Animated Pickleball Rally Simulation with Impact Glow (Only animates while on-screen) */}
                {isSimulating && isInView && (
                  <motion.div
                    className="absolute z-20 w-5 h-5 rounded-full bg-[#D2EE5E] border-2 border-zinc-950 shadow-lg shadow-[#D2EE5E]/50"
                    style={{ willChange: 'left, top, transform' }}
                    animate={{
                      left: ['26%', '70%', '32%', '66%', '26%'],
                      top: ['22%', '80%', '68%', '16%', '22%'],
                      scale: [1, 0.8, 1.25, 0.85, 1]
                    }}
                    transition={{
                      duration: 3.2,
                      repeat: Infinity,
                      ease: 'easeInOut'
                    }}
                  >
                    {/* Ball Holes Detail */}
                    <div className="w-full h-full relative">
                      <span className="absolute top-1 left-1 w-0.5 h-0.5 rounded-full bg-zinc-950" />
                      <span className="absolute top-1 right-1 w-0.5 h-0.5 rounded-full bg-zinc-950" />
                      <span className="absolute bottom-1 left-2 w-0.5 h-0.5 rounded-full bg-zinc-950" />
                    </div>
                  </motion.div>
                )}

                {/* Hotspot Interactive Markers */}
                {HOTSPOTS.map((spot) => {
                  const isSelected = activeHotspot?.id === spot.id;
                  return (
                    <button
                      key={spot.id}
                      type="button"
                      onClick={() => setActiveHotspot(spot)}
                      style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
                      className="absolute z-20 -translate-x-1/2 -translate-y-1/2 p-2 rounded-full transition-transform cursor-pointer group"
                    >
                      <span className="relative flex h-6 w-6 items-center justify-center">
                        <span
                          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                            isSelected ? 'bg-[#D2EE5E]' : 'bg-white'
                          }`}
                        />
                        <span
                          className={`relative inline-flex rounded-full h-5 w-5 border-2 border-white items-center justify-center text-[9px] font-black ${
                            isSelected
                              ? 'bg-[#D2EE5E] text-zinc-950 shadow-md scale-110'
                              : 'bg-[#15803D] text-white hover:bg-[#166534]'
                          }`}
                        >
                          ●
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 text-[11px] sm:text-xs text-zinc-500 font-sport">
              <span>Standard Full-Size Court: 20 × 44 Feet</span>
              <span className="text-[#15803D] font-extrabold flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-[#84CC16]" /> Tap points to see rules & tips
              </span>
            </div>
          </div>

          {/* Selected Hotspot Details Box (Framer Card Style) */}
          <div className="lg:col-span-4">
            <AnimatePresence mode="wait">
              {activeHotspot && (
                <motion.div
                  key={activeHotspot.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="p-5 rounded-2xl border border-emerald-200 bg-gradient-to-br from-[#F0FDF4] via-white to-emerald-50/40 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-sport font-black uppercase tracking-wider border border-emerald-300 ${activeHotspot.badgeColor}`}>
                      {activeHotspot.tag}
                    </span>
                    <Eye className="w-4 h-4 text-[#15803D]" />
                  </div>

                  <div>
                    <h4 className="text-base font-heading font-black uppercase text-zinc-950 leading-tight">
                      {activeHotspot.title}
                    </h4>
                    <p className="text-xs text-zinc-600 mt-2 leading-relaxed font-medium">
                      {activeHotspot.desc}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-emerald-200/70 flex items-center justify-between text-xs">
                    <span className="text-zinc-500 font-sport uppercase text-[11px]">Court Area:</span>
                    <span className="font-heading font-bold text-[#15803D]">
                      {activeHotspot.name}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Quick Hotspot Buttons */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {HOTSPOTS.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setActiveHotspot(h)}
                  className={`text-[11px] px-3 py-1.5 rounded-xl border transition-all cursor-pointer font-sport font-bold uppercase tracking-wider ${
                    activeHotspot?.id === h.id
                      ? 'bg-[#15803D] text-white border-[#15803D] shadow-xs'
                      : 'bg-white text-zinc-700 border-zinc-200 hover:border-emerald-300'
                  }`}
                >
                  {h.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
