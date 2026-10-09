import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Clock,
  Zap,
  MapPin,
  ShieldCheck,
  ArrowUpRight,
  Sparkles,
  Award,
  Copy,
  Check
} from 'lucide-react';
import { COURT_DETAILS } from '../../data/mockData';

// Memoized standalone live clock so its 1-second interval never re-renders the whole Bento grid
const LiveClock: React.FC = React.memo(() => {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    const update = () => {
      setTime(
        new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return <span>{time || '12:00:00 AM'}</span>;
});

export const FramerBentoFeatures: React.FC = () => {
  const [copiedNumber, setCopiedNumber] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(COURT_DETAILS.contactNumber);
    setCopiedNumber(true);
    setTimeout(() => setCopiedNumber(false), 2000);
  };

  return (
    <section className="py-14 bg-white border-b border-zinc-200 relative overflow-hidden cv-auto">
      {/* Background glow orbs */}
      <div className="absolute top-1/2 left-0 w-72 h-72 bg-[#15803D]/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4"
        >
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F0FDF4] border border-emerald-200 text-[#15803D] font-sport font-extrabold text-xs uppercase tracking-widest mb-2">
              <Sparkles className="w-3.5 h-3.5 text-[#84CC16]" />
              Why Players Love HousePickle Club
            </div>
            <h2 className="text-2xl sm:text-4xl font-heading font-black text-zinc-950 uppercase tracking-tight">
              EVERYTHING READY FOR YOUR GAME
            </h2>
          </div>
          <p className="text-xs text-zinc-500 font-medium max-w-sm">
            Open all night, easy on your knees, with bright night lights, free parking, and quick booking right on your phone.
          </p>
        </motion.div>

        {/* Dynamic Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Card 1: 24/7 Night Owl Arena (Span 7) - Always Shows Night Court Photo */}
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            whileHover={{ y: -5, scale: 1.01 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="md:col-span-7 rounded-3xl border border-emerald-200/90 overflow-hidden shadow-md relative flex flex-col justify-between min-h-[300px] group bg-zinc-950"
          >
            {/* Permanent Full-Quality Background Image (Optimized WebP, 110KB) */}
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
              <img
                src="/images/night-atmosphere.webp"
                alt="Night play atmosphere"
                width={1280}
                height={960}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover select-none"
              />
              {/* Warm stadium lighting glow */}
              <div className="absolute top-0 right-1/4 w-72 h-72 bg-[#D2EE5E]/15 rounded-full blur-3xl pointer-events-none" />
              {/* Clean bottom vignette for text contrast while keeping court photo 100% visible */}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/45 to-transparent" />
            </div>

            {/* Card Header */}
            <div className="p-6 flex items-start justify-between text-white relative z-10">
              <div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-[#D2EE5E] font-sport font-bold text-xs uppercase tracking-wider border border-white/20">
                  <span className="w-2 h-2 rounded-full bg-[#D2EE5E] animate-ping" />
                  Open 24 Hours Non-Stop
                </span>
                <h3 className="text-xl sm:text-2xl font-heading font-black uppercase text-white mt-3 leading-tight tracking-wide">
                  Bright Night Lights (No Curfew)
                </h3>
              </div>
              <div className="w-10 h-10 rounded-2xl bg-white/15 backdrop-blur-md border border-white/25 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Clock className="w-5 h-5 text-[#D2EE5E]" />
              </div>
            </div>

            {/* Card Footer with Live Clock */}
            <div className="p-6 text-white pt-0 relative z-10">
              <p className="text-xs text-zinc-200 leading-relaxed max-w-lg mb-4 font-medium">
                Play anytime! Late night promo rate is only <strong>₱200/hr from 10:00 PM to 6:00 AM</strong> (₱250 standard daytime), with super bright lights so you can see the ball clearly without hurting your eyes.
              </p>
              <div className="pt-3 border-t border-white/20 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-300 font-sport uppercase text-[11px] font-semibold">Koronadal Clock:</span>
                  <span className="font-mono font-bold text-[#D2EE5E] bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/20 shadow-xs">
                    <LiveClock />
                  </span>
                </div>
                <span className="text-[11px] font-sport font-bold uppercase tracking-wider text-emerald-300">
                  No Curfew • Always Open
                </span>
              </div>
            </div>
          </motion.div>

          {/* Card 2: GCash Direct Pay (Span 5) */}
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            whileHover={{ y: -5, scale: 1.01 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="md:col-span-5 rounded-3xl border border-blue-200/80 bg-gradient-to-br from-blue-50/70 via-white to-white p-6 shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-800 font-sport font-bold text-xs uppercase tracking-wider border border-blue-200">
                    <Zap className="w-3.5 h-3.5 text-blue-600" />
                    Easy GCash Pay
                  </span>
                  <h3 className="text-lg sm:text-xl font-heading font-black uppercase text-zinc-950 mt-3">
                    Fast & Easy GCash Booking
                  </h3>
                </div>
                <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-blue-600/20">
                  <ShieldCheck className="w-5 h-5" />
                </div>
              </div>

              <div className="my-4 p-3.5 bg-white rounded-2xl border border-blue-100 shadow-xs space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 font-sport uppercase text-[11px]">Host / Receiver:</span>
                  <span className="font-heading font-bold text-zinc-950">{COURT_DETAILS.contactPerson}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 font-sport uppercase text-[11px]">GCash Number:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-blue-700">{COURT_DETAILS.contactNumber}</span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="p-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 cursor-pointer transition-colors"
                      title="Copy GCash Number"
                    >
                      {copiedNumber ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-xs">
              <span className="text-zinc-500">Pay on your phone</span>
              <span className="font-sport font-bold text-[#15803D] uppercase tracking-wider">
                Pass Once Paid in Full
              </span>
            </div>
          </motion.div>

          {/* Card 3: Location / Aloha Suites (Span 6) */}
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            whileHover={{ y: -5, scale: 1.01 }}
            transition={{ duration: 0.6, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="md:col-span-6 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm flex flex-col justify-between group"
          >
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-50 text-amber-800 font-sport font-bold text-xs uppercase tracking-wider border border-amber-200">
                    <MapPin className="w-3 h-3 text-amber-600" />
                    Easy to Find
                  </span>
                  <h3 className="text-lg sm:text-xl font-heading font-black uppercase text-zinc-950 mt-3">
                    Right in Front of Aloha Suites
                  </h3>
                  <p className="text-xs text-zinc-600 mt-1.5 leading-relaxed">
                    Purok Masinadyahon, Brgy. San Isidro, Koronadal City. Free parking right next to the court with safe, easy access.
                  </p>
                </div>
                <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 text-[#15803D] flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-zinc-100 flex items-center justify-between">
              <span className="text-xs text-zinc-500 font-sport uppercase">Koronadal Sports Hub</span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Aloha Suites Koronadal City')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-sport font-extrabold uppercase tracking-wider text-[#15803D] hover:underline"
              >
                <span>Open in Google Maps</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </motion.div>

          {/* Card 4: Pro Carbon Paddle Station (Span 6) with Image Preview */}
          <motion.div
            initial={{ opacity: 0, y: 35 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            whileHover={{ y: -5, scale: 1.01 }}
            transition={{ duration: 0.6, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="md:col-span-6 rounded-3xl border border-emerald-200 bg-[#F0FDF4] p-6 shadow-sm flex flex-col justify-between relative overflow-hidden group"
          >
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-[#15803D] font-sport font-bold text-xs uppercase tracking-wider border border-emerald-300">
                    <Award className="w-3.5 h-3.5" />
                    Paddles & Balls
                  </span>
                  <h3 className="text-lg sm:text-xl font-heading font-black uppercase text-zinc-950 mt-3">
                    Rental Paddles Ready on Arrival
                  </h3>
                  <p className="text-xs text-zinc-600 mt-1.5 leading-relaxed max-w-sm">
                    No paddle yet? No problem! Rent a pair of tournament paddles for just <strong>₱80 per pair</strong>. High-bounce balls are included with your court time.
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl overflow-hidden border border-emerald-300 shrink-0 shadow-xs">
                  <img src="/images/gear-paddle.webp" alt="Paddle" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                </div>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-emerald-200/80 flex items-center justify-between text-xs">
              <span className="font-sport font-bold text-zinc-700">₱80 / pair rental</span>
              <span className="font-heading font-extrabold text-[#15803D] uppercase">
                Add when booking
              </span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
