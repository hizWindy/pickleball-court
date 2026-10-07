import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown,
  HelpCircle,
  Sparkles,
  ShieldAlert,
  Clock,
  Footprints,
  Hourglass,
  Trash2,
  Activity,
  Moon,
  HeartHandshake,
  CheckCircle2,
  BookOpen
} from 'lucide-react';
import { HOUSE_RULES } from '../../data/houseRules';

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
    answer: 'Pick your date, time and court, then confirm. Your slot is held for 15 minutes while you send the exact amount via GCash to Reymark Vergara (09128285344) and upload a screenshot of the receipt. Your booking is confirmed right away and your court pass downloads. Each payment can only be used for one booking.'
  },
  {
    id: 'equipment-rental',
    category: 'Gear Rental',
    question: 'Can I rent paddles and balls if I do not have my own gear?',
    answer: 'Yes! We have paddles available for rent at only ₱80 per pair, and high-bounce balls are provided for your session. Beginners, families, and walk-in groups are always welcome.'
  }
];

const RULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'no-show-grace': Clock,
  'court-shoes': Footprints,
  'firm-turnover': Hourglass,
  'claygo-drinks': Trash2,
  'equipment-care': Activity,
  'night-owl-noise': Moon,
  'sportsmanship': HeartHandshake,
};

export const FramerRulesAccordion: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'rules' | 'faq'>('rules');
  const [openRuleId, setOpenRuleId] = useState<string | null>('no-show-grace');
  const [openFaqId, setOpenFaqId] = useState<string | null>(FAQ_ITEMS[0].id);

  const toggleRule = (id: string) => {
    setOpenRuleId(openRuleId === id ? null : id);
  };

  const toggleFaq = (id: string) => {
    setOpenFaqId(openFaqId === id ? null : id);
  };

  return (
    <section id="rules" className="py-16 sm:py-20 bg-[#FAFCF9] border-b border-zinc-200 cv-auto scroll-mt-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8 sm:mb-10"
        >
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F0FDF4] border border-emerald-200 text-[#15803D] font-sport font-extrabold text-xs uppercase tracking-widest mb-2">
            <BookOpen className="w-3.5 h-3.5 text-[#84CC16]" />
            Official Guidelines & FAQs
          </div>
          <h2 className="text-2xl sm:text-4xl font-heading font-black text-zinc-950 uppercase tracking-tight">
            HOUSE RULES & PLAYER GUIDE
          </h2>
          <p className="text-xs sm:text-sm text-zinc-500 font-medium mt-1.5 max-w-lg mx-auto">
            Everything you need to know about punctuality, court care, late-night etiquette, and easy GCash booking.
          </p>

          {/* Tab Switcher */}
          <div className="mt-6 inline-flex p-1 rounded-2xl bg-zinc-200/70 border border-zinc-300/80 shadow-inner">
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-heading font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'rules'
                  ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <ShieldAlert className={`w-4 h-4 ${activeTab === 'rules' ? 'text-[#15803D]' : 'text-zinc-400'}`} />
              House Rules ({HOUSE_RULES.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('faq')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-heading font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'faq'
                  ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <HelpCircle className={`w-4 h-4 ${activeTab === 'faq' ? 'text-[#15803D]' : 'text-zinc-400'}`} />
              FAQs ({FAQ_ITEMS.length})
            </button>
          </div>
        </motion.div>

        {/* Tab 1: House Rules */}
        {activeTab === 'rules' && (
          <motion.div
            key="rules-tab"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-3.5"
          >
            {/* Prominent High-Priority Alert Banner for No-Show Policy */}
            <div className="rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 via-amber-50/70 to-orange-50 p-4 sm:p-5 shadow-xs">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Clock className="w-5 h-5 animate-pulse" />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading font-black text-xs uppercase tracking-widest text-amber-900 bg-amber-200/70 px-2 py-0.5 rounded-md">
                      CRITICAL POLICY
                    </span>
                    <span className="font-heading font-black text-sm sm:text-base text-amber-950 uppercase">
                      20-Minute No-Show & Forfeiture Rule
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-amber-900/90 font-medium leading-relaxed mt-1.5">
                    Please arrive 10 minutes before your slot. If your group does not check in within <strong>20 minutes</strong> of your start time, the court is declared a <strong>No-Show</strong>, released to waiting walk-in players, and your payment is forfeited without refund.
                  </p>
                </div>
              </div>
            </div>

            {/* List of Rules */}
            {HOUSE_RULES.map((rule, idx) => {
              const isOpen = openRuleId === rule.id;
              const IconComp = RULE_ICONS[rule.id] || CheckCircle2;

              return (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-20px' }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
                  key={rule.id}
                  layout
                  className={`rounded-2xl border transition-all overflow-hidden ${
                    isOpen
                      ? rule.isCrucial
                        ? 'border-amber-400 bg-white shadow-md shadow-amber-950/5'
                        : 'border-[#15803D] bg-white shadow-md shadow-emerald-950/5'
                      : 'border-zinc-200/90 bg-white hover:border-emerald-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleRule(rule.id)}
                    className="w-full px-4 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between text-left cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3 sm:gap-4 pr-3 min-w-0">
                      <span className="font-sport font-black text-xs text-zinc-400 shrink-0 w-6">
                        {rule.number}
                      </span>
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        rule.isCrucial ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-[#15803D]'
                      }`}>
                        <IconComp className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs sm:text-sm font-heading font-extrabold uppercase text-zinc-950 tracking-wide truncate">
                            {rule.title}
                          </span>
                          <span className={`text-[10px] font-sport font-black uppercase px-2 py-0.5 rounded-full ${
                            rule.tagColor === 'amber'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : rule.tagColor === 'emerald'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : rule.tagColor === 'blue'
                              ? 'bg-blue-100 text-blue-800 border border-blue-200'
                              : 'bg-zinc-100 text-zinc-700 border border-zinc-200'
                          }`}>
                            {rule.tag}
                          </span>
                        </div>
                        <p className="text-[11px] sm:text-xs text-zinc-500 font-medium truncate mt-0.5">
                          {rule.summary}
                        </p>
                      </div>
                    </div>

                    <motion.div
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      className="shrink-0 text-zinc-400 ml-2"
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
                        <div className="px-5 pb-5 pt-1 text-xs text-zinc-600 leading-relaxed border-t border-zinc-100 bg-gradient-to-b from-zinc-50/50 to-white">
                          <p className="font-medium leading-relaxed text-zinc-700 text-xs sm:text-sm">
                            {rule.details}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Tab 2: FAQs */}
        {activeTab === 'faq' && (
          <motion.div
            key="faq-tab"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-3"
          >
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaqId === item.id;
              return (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-20px' }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
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
                    onClick={() => toggleFaq(item.id)}
                    className="w-full px-5 py-4 flex items-center justify-between text-left cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3 pr-4">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isOpen ? 'bg-[#CCFF00] ring-2 ring-[#15803D]' : 'bg-[#15803D]'}`} />
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
          </motion.div>
        )}
      </div>
    </section>
  );
};
