import React, { useState } from 'react';
import {
  Phone,
  MessageSquare,
  Navigation,
  Copy,
  Check,
  MapPin,
  Clock,
  Car,
  Sparkles
} from 'lucide-react';
import { motion } from 'motion/react';
import { COURT_DETAILS } from '../data/mockData';

export const LocationDetails: React.FC = () => {
  const [copiedPhone, setCopiedPhone] = useState(false);

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(COURT_DETAILS.contactNumber);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    'Aloha Suites Purok Masinadyahon Barangay San Isidro Koronadal City'
  )}`;

  return (
    <section id="location" className="py-16 bg-white border-b border-zinc-200 cv-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-10"
        >
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F0FDF4] border border-emerald-200 text-[#15803D] font-sport font-extrabold text-xs uppercase tracking-widest mb-2">
            <Sparkles className="w-3.5 h-3.5 text-[#84CC16]" />
            Koronadal City Venue
          </div>
          <h2 className="text-2xl sm:text-4xl font-heading font-black text-zinc-950 uppercase tracking-tight">
            LOCATION & VENUE CONTACT
          </h2>
          <p className="text-xs text-zinc-500 font-medium mt-1">
            Centrally situated in Purok Masinadyahon, directly across the Aloha Suites entrance.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Address Box with Double-Bezel Hardware Styling */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="double-bezel shadow-md"
          >
            <div className="double-bezel-inner p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-heading font-black uppercase tracking-wider text-zinc-950 block flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-[#15803D]" />
                    Official Court Address
                  </span>
                  <p className="text-xs text-zinc-800 font-semibold mt-2 leading-relaxed">
                    In front of Aloha Suites, Purok Masinadyahon, Barangay San Isidro, Koronadal City, South Cotabato
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full text-[10px] font-sport font-extrabold uppercase tracking-wider bg-[#F0FDF4] text-[#15803D] border border-emerald-300 shrink-0">
                  24 Hours Open
                </span>
              </div>

              <div className="text-xs text-zinc-600 space-y-2 pt-3 border-t border-zinc-100">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#15803D] shrink-0" />
                  <span><strong>Landmark:</strong> Directly across Aloha Suites main gate.</span>
                </div>
                <div className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-[#15803D] shrink-0" />
                  <span><strong>Parking:</strong> Dedicated free parking on premise with direct court access.</span>
                </div>
              </div>

              <div className="pt-2">
                <motion.a
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 rounded-full border border-emerald-300 bg-[#F0FDF4] hover:bg-emerald-100 text-[#15803D] text-xs font-sport font-extrabold uppercase tracking-wider transition-colors shadow-xs w-full sm:w-auto text-center"
                >
                  <Navigation className="w-4 h-4" />
                  <span>Open Directions in Google Maps</span>
                </motion.a>
              </div>
            </div>
          </motion.div>

          {/* Host & Direct Payment Box */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.65, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="double-bezel shadow-md"
          >
            <div className="double-bezel-inner p-6 space-y-4">
              <div>
                <span className="text-xs font-heading font-black uppercase tracking-wider text-zinc-950 block">
                  Court Management & Host
                </span>
                <p className="text-xs text-zinc-600 mt-1 font-medium">
                  Managed directly on-site by <strong>{COURT_DETAILS.contactPerson}</strong>. Point of contact for regular court booking, tournament block-offs, and GCash payments.
                </p>
              </div>

              <div className="p-4 bg-gradient-to-br from-[#F0FDF4] to-emerald-50/50 rounded-2xl border border-emerald-200 space-y-2.5 text-xs">
                <div className="flex flex-col xs:flex-row xs:items-center justify-between gap-1">
                  <span className="text-zinc-600 font-sport font-bold uppercase text-[11px]">Host / GCash Contact:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-zinc-950 text-sm">{COURT_DETAILS.contactNumber}</span>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      type="button"
                      onClick={handleCopyPhone}
                      className="p-1.5 rounded-lg bg-white text-zinc-600 hover:text-zinc-950 border border-emerald-300 cursor-pointer shadow-xs"
                      title="Copy phone number"
                    >
                      {copiedPhone ? <Check className="w-3.5 h-3.5 text-[#15803D]" /> : <Copy className="w-3.5 h-3.5" />}
                    </motion.button>
                  </div>
                </div>
                <div className="flex flex-col xs:flex-row xs:items-center justify-between gap-1 pt-1 border-t border-emerald-200/60">
                  <span className="text-zinc-600 font-sport font-bold uppercase text-[11px]">Verified GCash Name:</span>
                  <span className="font-heading font-black text-zinc-950">{COURT_DETAILS.gcashAccountName}</span>
                </div>
              </div>

              <div className="flex gap-3 pt-1 text-xs">
                <motion.a
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  href={`tel:${COURT_DETAILS.contactNumber}`}
                  className="flex-1 py-2.5 rounded-full bg-[#15803D] hover:bg-[#166534] text-white font-sport font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-emerald-950/15"
                >
                  <Phone className="w-4 h-4" /> Call Host
                </motion.a>
                <motion.a
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  href={`sms:${COURT_DETAILS.contactNumber}`}
                  className="flex-1 py-2.5 rounded-full border border-zinc-300 hover:bg-zinc-50 text-zinc-800 font-sport font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
                >
                  <MessageSquare className="w-4 h-4" /> Send SMS
                </motion.a>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
