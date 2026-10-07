import React from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { COURT_DETAILS } from '../../data/mockData';

/**
 * Plain-language privacy notice shown before the player agrees.
 * Bump CONSENT_VERSION on the server whenever this text changes materially.
 */
export const PrivacyNotice: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-[80] flex items-end justify-center bg-zinc-950/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
    <div className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:max-w-md sm:rounded-3xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#15803D]" />
          <h2 id="privacy-title" className="text-lg font-bold text-zinc-950">Privacy Notice</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-4 text-sm leading-relaxed text-zinc-700">
        <p>
          {COURT_DETAILS.name} collects only what it needs to run your booking, in line with the Data Privacy Act of 2012 (RA 10173).
        </p>
        <div>
          <h3 className="font-semibold text-zinc-900">What we collect</h3>
          <p>Your name, mobile number, the court and time you book, and your payment proof (receipt image or reference number, payment time and payer name).</p>
        </div>
        <div>
          <h3 className="font-semibold text-zinc-900">Why</h3>
          <p>To hold and confirm your slot, check that your payment arrived, contact you about this booking, and keep a record of bookings at the venue.</p>
        </div>
        <div>
          <h3 className="font-semibold text-zinc-900">Who sees it</h3>
          <p>Only the court host ({COURT_DETAILS.contactPerson}). Receipt images are stored privately and are never shown publicly or sold.</p>
        </div>
        <div>
          <h3 className="font-semibold text-zinc-900">How long</h3>
          <p>
            Booking records are kept for reference. Receipt images are deleted about a week after your booking is confirmed. To confirm
            you instantly, our own server reads the amount, reference number, date and recipient off your receipt; the image is not sent
            to any other company.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-zinc-900">Your rights</h3>
          <p>
            You can ask to see, correct or delete your data by contacting {COURT_DETAILS.contactPerson} at {COURT_DETAILS.contactNumber}.
          </p>
        </div>
        <p className="rounded-2xl bg-emerald-50 p-3 text-xs text-emerald-900">
          Tip: before uploading a receipt you may crop out your balance. We only need the amount, reference number, date and recipient.
        </p>
      </div>
    </div>
  </div>
);
