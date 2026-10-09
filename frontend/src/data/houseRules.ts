import type { AppConfig } from '../types';

export interface HouseRule {
  id: string;
  number: string;
  title: string;
  tag: string;
  tagColor: 'amber' | 'emerald' | 'blue' | 'zinc';
  /** One short line. Used in the collapsed rows and in the condensed lists inside the booking flow. */
  summary: string;
  details: string;
  /** Opening phrase shown in bold in front of `details`. */
  lead?: string;
  isCrucial?: boolean;
}

// ── Booking & Court Policies ──────────────────────────────────────────────────
// The club's official poster ("11:11 Pickleball House: House Rules, Booking and Court Policies").
// The numbers come from the server config, so the wording can't drift from what the system really does.

export interface PolicyNumbers {
  lateAfterMinutes: number;
  rescheduleMinHours: number;
  rescheduleWindowDays: number;
}

export const DEFAULT_POLICY_NUMBERS: PolicyNumbers = { lateAfterMinutes: 15, rescheduleMinHours: 48, rescheduleWindowDays: 30 };

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 48 -> "forty-eight (48)", the way the poster writes it. */
function spelled(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
  const word = n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
  return `${word} (${n})`;
}

export function buildPolicies(n: PolicyNumbers = DEFAULT_POLICY_NUMBERS): HouseRule[] {
  return [
    {
      id: 'policy-booking',
      number: '01',
      title: 'Booking Policy',
      tag: 'Booking',
      tagColor: 'emerald',
      summary: 'First full payment, first confirmed booking. Unpaid holds are tentative. Walk-ins are welcome.',
      details:
        'Court reservations are strictly on a First Full Payment, First Confirmed Booking basis. Bookings are confirmed only after full payment has been received. Unpaid reservations are considered tentative and may be released without prior notice. Walk-in players are welcome, subject to court availability. Management reserves the right to decline or cancel bookings that violate these policies.',
    },
    {
      id: 'policy-payment',
      number: '02',
      title: 'Payment Policy',
      tag: 'Payment',
      tagColor: 'emerald',
      summary: 'Full payment confirms a reservation. Settle extra rentals or damages before you leave.',
      details:
        'Full payment is required to confirm all reservations. Payments made signify acceptance of all house rules and policies. Additional rentals, purchases, or damages must be settled before leaving the premises.',
    },
    {
      id: 'policy-cancellation',
      number: '03',
      title: 'Cancellation Policy',
      tag: 'No Refunds',
      tagColor: 'amber',
      isCrucial: true,
      summary: 'Strictly no cancellations. Bookings are final and non-refundable. One reschedule is allowed.',
      lead: 'Strictly no cancellations.',
      details:
        'All bookings are final and payments are non-refundable. A confirmed booking can be rescheduled once (see Rescheduling). If management closes the courts because of weather, affected bookings are moved free of charge.',
    },
    {
      id: 'policy-rescheduling',
      number: '04',
      title: 'Rescheduling Policy',
      tag: 'Once Only',
      tagColor: 'blue',
      summary: `One reschedule per booking, at least ${n.rescheduleMinHours} hours before your start. Weather moves don't count.`,
      details:
        `Requests to reschedule must be made at least ${spelled(n.rescheduleMinHours)} hours before the reserved schedule. Rescheduling is subject to court availability. Each confirmed booking may only be rescheduled once. Requests made within ${spelled(n.rescheduleMinHours)} hours may only be accommodated under exceptional circumstances and at the sole discretion of management. The new date must be within ${n.rescheduleWindowDays} days of the original date, and the new slot can't cost more than what you paid. Weather moves don't count as your one reschedule.`,
    },
    {
      id: 'policy-no-show',
      number: '05',
      title: 'No-Show Policy',
      tag: 'Late Rule',
      tagColor: 'amber',
      isCrucial: true,
      summary: `Not on court within ${n.lateAfterMinutes} minutes of your start? The booking is marked Late and the court goes to others.`,
      details:
        `Guests who fail to arrive within ${spelled(n.lateAfterMinutes)} minutes of their reserved schedule without prior notice shall be considered a No-Show (shown as "Late" on your pass), and the court is released to other players. No-Shows are not entitled to refunds, credits, or extensions.`,
    },
    {
      id: 'policy-late-arrival',
      number: '06',
      title: 'Late Arrival',
      tag: 'Schedule',
      tagColor: 'blue',
      summary: 'Arriving late does not extend your time. Sessions end at the scheduled hour.',
      details:
        'Late arrivals do not extend the reserved playing time. All sessions will end at the originally scheduled time to respect succeeding reservations.',
    },
  ];
}

export const POLICIES: HouseRule[] = buildPolicies();

/** Policies worded with this site's live numbers (falls back to the poster's numbers until the config loads). */
export const policiesFor = (config: AppConfig | null): HouseRule[] =>
  config
    ? buildPolicies({
        lateAfterMinutes: config.lateAfterMinutes,
        rescheduleMinHours: config.rescheduleMinHours,
        rescheduleWindowDays: config.rescheduleWindowDays,
      })
    : POLICIES;

// ── Court etiquette ───────────────────────────────────────────────────────────
export const HOUSE_RULES: HouseRule[] = [
  {
    id: 'court-shoes',
    number: '01',
    title: 'Non-Marking Athletic Shoes Only',
    tag: 'Required',
    tagColor: 'emerald',
    isCrucial: true,
    summary: 'Tennis, pickleball, or clean athletic sneakers with non-marking soles.',
    details:
      'To protect the professional dual-tone acrylic surface and prevent ankle slips, only non-marking athletic sneakers or court shoes are permitted. Strictly no slippers, flip-flops, crocs, hiking boots, running spikes, high heels, or bare feet on the playing area.',
  },
  {
    id: 'firm-turnover',
    number: '02',
    title: 'Firm Turnover at the Buzzer',
    tag: 'Schedule',
    tagColor: 'blue',
    summary: 'Conclude play at the 58th minute to give the next group a clean start.',
    details:
      'Sessions run on the hour. Please wrap up rallies at the 58th minute, collect all balls, and clear the court bench promptly. Extending your session into the next hour is strictly prohibited unless booked and paid in advance or cleared by the desk.',
  },
  {
    id: 'claygo-drinks',
    number: '03',
    title: 'Hydration Only & Clean As You Go (CLAYGO)',
    tag: 'Cleanliness',
    tagColor: 'zinc',
    summary: 'Sealed water and sports tumblers only bench-side. Dispose of all trash.',
    details:
      'Only sealed water bottles and sports drinks are allowed on the player benches. Food, snacks, sticky fruit juices, and colored sodas must stay in the clubhouse lounge. Always throw grip tape wrappers, empty bottles, and tissues into the trash bins provided before leaving.',
  },
  {
    id: 'equipment-care',
    number: '04',
    title: 'Paddle Care & Net Protection',
    tag: 'Gear Care',
    tagColor: 'blue',
    summary: 'Handle rented paddles with care; never sit or lean on tournament nets.',
    details:
      'Rented paddles (₱80/pair) and balls must be returned to the front desk after your game. Smashing paddles against the ground or walls in frustration is strictly penalized with full replacement costs. Do not sit on, climb over, or tamper with the tournament nets and center straps.',
  },
  {
    id: 'night-owl-noise',
    number: '05',
    title: '24/7 Night Owl Etiquette (10 PM – 6 AM)',
    tag: 'Community',
    tagColor: 'amber',
    summary: 'Keep cheering and portable speakers considerate during midnight hours.',
    details:
      'HousePickle Club is proud to offer 24/7 play in front of Aloha Suites. During late-night promo hours (10:00 PM to 6:00 AM), keep portable Bluetooth speakers and loud shouting at a respectful level for neighborhood peace. Night floodlights are turned on strictly for active booked sessions.',
  },
  {
    id: 'sportsmanship',
    number: '06',
    title: '"Good Players, Better People" Sportsmanship',
    tag: 'Motto',
    tagColor: 'emerald',
    summary: 'Treat opponents, partners, and staff with kindness and respect.',
    details:
      'Respect the calls of your peers, embrace fair play, and foster an encouraging environment for beginners and veterans alike. Profanity, physical intimidation, aggressive arguing, or gambling is grounds for immediate eviction from the venue without refund.',
  },
];

/** The short list shown on the review step, right before the player agrees to the rules. */
export function reviewNotices(n: Pick<PolicyNumbers, 'lateAfterMinutes' | 'rescheduleMinHours'>) {
  return [
    {
      title: 'Pay in full',
      text: 'Your booking is confirmed only after the full amount is received.',
    },
    {
      title: 'No cancellations',
      text: `Bookings are final and non-refundable. You can reschedule once, at least ${n.rescheduleMinHours} hours before your start.`,
    },
    {
      title: `${n.lateAfterMinutes}-Minute Late Rule`,
      text: `Be on court within ${n.lateAfterMinutes} minutes of your start. After that the booking is marked Late, the court goes to other players, and there is no refund.`,
    },
    {
      title: 'Footwear',
      text: 'Non-marking athletic court shoes strictly required (no flip-flops or bare feet).',
    },
    {
      title: 'CLAYGO',
      text: 'Water bottles only bench-side; dispose of trash in bins.',
    },
  ];
}

const LATE_MINUTES = DEFAULT_POLICY_NUMBERS.lateAfterMinutes;

export const QUICK_RULES_SUMMARY = [
  {
    icon: 'clock',
    title: `${LATE_MINUTES}-Min Late Rule`,
    text: `Be on court within ${LATE_MINUTES} mins of your start time or the booking is marked Late and the court goes to other players. No refunds.`,
  },
  {
    icon: 'shoe',
    title: 'Non-Marking Shoes Only',
    text: 'Proper athletic sneakers required. No slippers, crocs, or black-soled street shoes.',
  },
  {
    icon: 'water',
    title: 'Water Only & CLAYGO',
    text: 'Hydration bottles bench-side only. Keep court clean and throw trash in bins.',
  },
  {
    icon: 'turnover',
    title: 'Prompt Turnover',
    text: 'Clear court at the 58th minute so the next group starts right on the hour.',
  },
];
