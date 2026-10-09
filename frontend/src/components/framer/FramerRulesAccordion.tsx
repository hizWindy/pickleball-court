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
  BookOpen,
  CalendarCheck,
  CalendarClock,
  Wallet,
  Ban,
  UserX,
  Timer,
  ScrollText,
} from 'lucide-react';
import { HOUSE_RULES, policiesFor, type HouseRule } from '../../data/houseRules';
import { useConfig } from '../../hooks/useBookingData';
import type { AppConfig } from '../../types';

interface AccordionItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  /** Optional button under the answer. */
  action?: 'reschedule';
}

function buildFaq(config: AppConfig | null): AccordionItem[] {
  const hold = config?.holdMinutes ?? 10;
  const late = config?.lateAfterMinutes ?? 15;
  const minHours = config?.rescheduleMinHours ?? 48;
  const windowDays = config?.rescheduleWindowDays ?? 30;
  return [
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
      answer: `Pick your date, time and court, then confirm. Your slot is held for ${hold} minutes while you send the full amount via GCash to Reymark Vergara (09128285344) and upload a screenshot of the receipt. When your receipt shows the full amount, your booking is confirmed right away and your court pass downloads. Each payment can only be used for one booking.`
    },
    {
      id: 'not-confirmed',
      category: 'Payment',
      question: 'Why is my booking not confirmed yet?',
      answer: "A booking is confirmed only after the full payment is received. If your receipt shows less than the total, or the amount can't be read, the host checks it by hand and your slot stays reserved meanwhile. If it was short, send the rest to the same account and text the host your new receipt."
    },
    {
      id: 'cancel',
      category: 'Bookings',
      question: 'Can I cancel my booking?',
      answer: `No. All bookings are final and payments are non-refundable. The only flexibility is one reschedule per booking, and if the host closes the courts because of weather your session is moved free of charge. Haven't paid yet? You can release your held slot before the ${hold} minutes run out. Nothing is charged.`
    },
    {
      id: 'reschedule',
      category: 'Bookings',
      question: 'Can I change my booking time?',
      answer: `Yes, once. Reschedule at least ${minHours} hours before your start time. Keep the same length, pick a new date within ${windowDays} days of your original date, and choose a slot that costs no more than you paid (a cheaper slot is fine, but the difference isn't refunded). Inside ${minHours} hours, message the host. Exceptions are at the host's discretion.`,
      action: 'reschedule'
    },
    {
      id: 'rain',
      category: 'Bookings',
      question: 'What if it rains?',
      answer: "If the host closes the courts because of weather, your booking is moved free of charge. You'll get a message with a link to pick a new time, and it doesn't use up your one reschedule.",
      action: 'reschedule'
    },
    {
      id: 'late',
      category: 'Bookings',
      question: "What happens if I'm late?",
      answer: `Be on the court within ${late} minutes of your start time. After that the booking is marked Late, the court is released to other players, and there are no refunds, credits or extensions. When you arrive, tap "I've arrived" on your pass (it opens 30 minutes before your start) so we know your group is here. Arriving late doesn't extend your time: every session ends at its scheduled hour.`
    },
    {
      id: 'equipment-rental',
      category: 'Gear Rental',
      question: 'Can I rent paddles and balls if I do not have my own gear?',
      answer: 'Yes! We have paddles available for rent at only ₱80 per pair, and high-bounce balls are provided for your session. Beginners, families, and walk-in groups are always welcome.'
    }
  ];
}

const RULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'policy-booking': CalendarCheck,
  'policy-payment': Wallet,
  'policy-cancellation': Ban,
  'policy-rescheduling': CalendarClock,
  'policy-no-show': UserX,
  'policy-late-arrival': Timer,
  'court-shoes': Footprints,
  'firm-turnover': Hourglass,
  'claygo-drinks': Trash2,
  'equipment-care': Activity,
  'night-owl-noise': Moon,
  'sportsmanship': HeartHandshake,
};

type Tab = 'policies' | 'rules' | 'faq';

export const FramerRulesAccordion: React.FC<{ onReschedule?: () => void }> = ({ onReschedule }) => {
  const { config } = useConfig();
  const policies = policiesFor(config);
  const faqItems = buildFaq(config);
  const lateMinutes = config?.lateAfterMinutes ?? 15;

  const [activeTab, setActiveTab] = useState<Tab>('policies');
  const [openRuleId, setOpenRuleId] = useState<string | null>('policy-cancellation');
  const [openFaqId, setOpenFaqId] = useState<string | null>('night-owl');

  const toggleRule = (id: string) => {
    setOpenRuleId(openRuleId === id ? null : id);
  };

  const toggleFaq = (id: string) => {
    setOpenFaqId(openFaqId === id ? null : id);
  };

  const tabs: { id: Tab; label: string; long: string; count: number; Icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'policies', label: 'Policies', long: 'Booking Policies', count: policies.length, Icon: ScrollText },
    { id: 'rules', label: 'Rules', long: 'House Rules', count: HOUSE_RULES.length, Icon: ShieldAlert },
    { id: 'faq', label: 'FAQs', long: 'FAQs', count: faqItems.length, Icon: HelpCircle },
  ];

  return (
    <section id="rules" className="py-16 sm:py-20 bg-[#F7F6F1] border-b border-zinc-200 cv-auto scroll-mt-20">
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
            Everything you need to know about booking, cancellations, punctuality, court care, late-night etiquette, and easy GCash booking.
          </p>

          {/* Tab Switcher */}
          <div role="tablist" aria-label="Rules and policies" className="mt-6 mx-auto grid max-w-md grid-cols-3 p-1 rounded-2xl bg-zinc-200/70 border border-zinc-300/80 shadow-inner">
            {tabs.map(({ id, label, long, count, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`flex min-h-11 items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2.5 rounded-xl text-[11px] sm:text-sm font-heading font-extrabold uppercase tracking-wider transition-all cursor-pointer ${
                  activeTab === id
                    ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Icon className={`hidden sm:block w-4 h-4 ${activeTab === id ? 'text-[#15803D]' : 'text-zinc-400'}`} />
                <span className="sm:hidden">{label}</span>
                <span className="hidden sm:inline">{long} ({count})</span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Tab 1: Booking & Court Policies */}
        {activeTab === 'policies' && (
          <motion.div
            key="policies-tab"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-3.5"
          >
            <div className="text-center sm:text-left">
              <h3 className="font-heading font-black text-base sm:text-lg uppercase tracking-tight text-zinc-950">Booking & Court Policies</h3>
              <p className="text-xs sm:text-sm text-zinc-500 font-medium mt-0.5">
                The club's official policies. Paying for a booking means you accept them.
              </p>
            </div>

            {/* Prominent High-Priority Alert Banner for the Late Rule */}
            <div className="rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 via-amber-50/70 to-orange-50 p-4 sm:p-5 shadow-xs">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Clock className="w-5 h-5 animate-pulse motion-reduce:animate-none" />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading font-black text-xs uppercase tracking-widest text-amber-900 bg-amber-200/70 px-2 py-0.5 rounded-md">
                      CRITICAL POLICY
                    </span>
                    <span className="font-heading font-black text-sm sm:text-base text-amber-950 uppercase">
                      {lateMinutes}-Minute Late Rule
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-amber-900/90 font-medium leading-relaxed mt-1.5">
                    Be on the court within <strong>{lateMinutes} minutes</strong> of your start time. After that your booking is marked <strong>Late</strong> (a No-Show), the court is released to other players, and there are no refunds. Bookings are final: <strong>no cancellations</strong>.
                  </p>
                </div>
              </div>
            </div>

            <RuleList rules={policies} openId={openRuleId} onToggle={toggleRule} />

            {onReschedule && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-emerald-200 bg-[#F0FDF4]/70 p-4">
                <div>
                  <p className="font-heading font-extrabold text-xs sm:text-sm uppercase tracking-wide text-zinc-900">Need to move your booking?</p>
                  <p className="text-xs text-zinc-600 font-medium mt-0.5">You can reschedule once, at least {config?.rescheduleMinHours ?? 48} hours before your start time.</p>
                </div>
                <button
                  type="button"
                  onClick={onReschedule}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#15803D] px-4 text-xs sm:text-sm font-heading font-extrabold uppercase tracking-wider text-white shadow-xs hover:bg-[#166534] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300"
                >
                  <CalendarClock className="w-4 h-4" /> Reschedule my booking
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* Tab 2: Court etiquette */}
        {activeTab === 'rules' && (
          <motion.div
            key="rules-tab"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-3.5"
          >
            <div className="text-center sm:text-left">
              <h3 className="font-heading font-black text-base sm:text-lg uppercase tracking-tight text-zinc-950">Court Etiquette</h3>
              <p className="text-xs sm:text-sm text-zinc-500 font-medium mt-0.5">Small things that keep the courts great for everyone.</p>
            </div>
            <RuleList rules={HOUSE_RULES} openId={openRuleId} onToggle={toggleRule} />
          </motion.div>
        )}

        {/* Tab 3: FAQs */}
        {activeTab === 'faq' && (
          <motion.div
            key="faq-tab"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-3"
          >
            {faqItems.map((item, idx) => {
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
                    aria-expanded={isOpen}
                    className="w-full px-5 py-4 flex items-center justify-between text-left cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3 pr-4">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isOpen ? 'bg-[#D2EE5E] ring-2 ring-[#15803D]' : 'bg-[#15803D]'}`} />
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
                          {item.action === 'reschedule' && onReschedule && (
                            <button
                              type="button"
                              onClick={onReschedule}
                              className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-xs font-heading font-extrabold uppercase tracking-wider text-[#15803D] underline underline-offset-4 hover:text-[#166534] cursor-pointer"
                            >
                              <CalendarClock className="w-4 h-4" /> Reschedule my booking
                            </button>
                          )}
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

/** One accordion row per rule or policy, shared by the Policies and Rules tabs. */
const RuleList: React.FC<{
  rules: HouseRule[];
  openId: string | null;
  onToggle: (id: string) => void;
}> = ({ rules, openId, onToggle }) => (
  <>
    {rules.map((rule, idx) => {
      const isOpen = openId === rule.id;
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
            onClick={() => onToggle(rule.id)}
            aria-expanded={isOpen}
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
                  <span className="text-xs sm:text-sm font-heading font-extrabold uppercase text-zinc-950 tracking-wide">
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
                {!isOpen && (
                  <p className="text-[11px] sm:text-xs text-zinc-500 font-medium line-clamp-2 mt-0.5">
                    {rule.summary}
                  </p>
                )}
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
                    {rule.lead && <strong className="text-zinc-950">{rule.lead} </strong>}
                    {rule.details}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      );
    })}
  </>
);
