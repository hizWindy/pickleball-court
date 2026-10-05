import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, HelpCircle, Sparkles } from 'lucide-react';

interface AccordionItem {
  id: string;
  question: string;
  answer: string;
  category: string;
}

const FAQ_ITEMS: AccordionItem[] = [
  {
    id: 'night-owl',
    category: 'Hours & Rates',
    question: 'What are the night hours and rates?',
    answer: 'We are open 24 hours non-stop, 7 days a week! From 10:00 PM to 6:00 AM, our late-night promo gives you a ₱200/hr rate (standard daytime rate is ₱250/hr). The super bright night lights stay on all night so you can play anytime with zero blinding glare.'
  },
  {
    id: 'kitchen-rule',
    category: 'Easy Rules',
    question: 'What is "The Kitchen" and how do I play it?',
    answer: 'The Kitchen is the 7-foot box in front of the net. The simple rule is: let the ball bounce first before stepping inside to hit it! You cannot hit the ball in mid-air while standing inside the kitchen or touching its line.'
  },
  {
    id: 'location-landmark',
    category: 'Location & Parking',
    question: 'Where is the court located in Koronadal City?',
    answer: 'We are located right in front of Aloha Suites, Purok Masinadyahon, Barangay San Isidro, Koronadal City. We have free, secure parking on-site with direct access to Court 1 and Court 2.'
  },
  {
    id: 'gcash-process',
    category: 'Payment',
    question: 'How do I pay with GCash?',
    answer: 'Pick your date, time and court, then confirm. Your slot is held for 15 minutes while you send the exact amount via GCash to Reymark Vergara (09128285344) and upload a screenshot of the receipt. You get your court pass right away, and it switches to Confirmed once the host verifies the payment.'
  },
  {
    id: 'equipment-rental',
    category: 'Gear Rental',
    question: 'Can I rent paddles and balls if I do not have my own gear?',
    answer: 'Yes! We have paddles available for rent at only ₱80 per pair, and high-bounce balls are provided for your session. Beginners, families, and walk-in groups are always welcome.'
  }
];

export const FramerRulesAccordion: React.FC = () => {
  const [openId, setOpenId] = useState<string | null>(FAQ_ITEMS[0].id);

  const toggleItem = (id: string) => {
    setOpenId(openId === id ? null : id);
  };

  return (
    <section className="py-16 bg-[#FAFCF9] border-b border-zinc-200 cv-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F0FDF4] border border-emerald-200 text-[#15803D] font-sport font-extrabold text-xs uppercase tracking-widest mb-2">
            <HelpCircle className="w-3.5 h-3.5 text-[#84CC16]" />
            Quick Player Guide
          </div>
          <h2 className="text-2xl sm:text-4xl font-heading font-black text-zinc-950 uppercase tracking-tight">
            FREQUENTLY ASKED QUESTIONS
          </h2>
          <p className="text-xs text-zinc-500 font-medium mt-1 max-w-md mx-auto">
            Everything you need to know about court hours, night lights, kitchen rules, and quick GCash payment.
          </p>
        </motion.div>

        {/* Framer Accordion Container */}
        <div className="space-y-3">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openId === item.id;
            return (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.45, delay: idx * 0.08 }}
                key={item.id}
                layout
                className={`rounded-2xl border transition-all overflow-hidden ${
                  isOpen
                    ? 'border-[#15803D] bg-white shadow-md shadow-emerald-950/5'
                    : 'border-zinc-200/90 bg-white hover:border-emerald-300'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  className="w-full px-5 py-4 flex items-center justify-between text-left cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3 pr-4">
                    <span className={`w-2 h-2 rounded-full ${isOpen ? 'bg-[#CCFF00] ring-2 ring-[#15803D]' : 'bg-[#15803D]'}`} />
                    <span className="text-xs sm:text-sm font-heading font-extrabold uppercase text-zinc-900 tracking-wide">
                      {item.question}
                    </span>
                  </div>
                  <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="shrink-0 text-zinc-500"
                  >
                    <ChevronDown className="w-4 h-4 text-[#15803D]" />
                  </motion.div>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    >
                      <div className="px-5 pb-5 pt-1 text-xs text-zinc-600 leading-relaxed border-t border-emerald-100 bg-gradient-to-b from-[#F0FDF4]/50 to-white">
                        <p className="font-medium leading-relaxed">{item.answer}</p>
                        <div className="mt-3 flex items-center justify-between text-[10px] font-sport uppercase tracking-wider">
                          <span className="text-zinc-400">Category: {item.category}</span>
                          <span className="text-[#15803D] font-bold flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-[#84CC16]" /> HousePickle Club Guide
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
