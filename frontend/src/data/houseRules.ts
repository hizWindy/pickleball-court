export interface HouseRule {
  id: string;
  number: string;
  title: string;
  tag: string;
  tagColor: 'amber' | 'emerald' | 'blue' | 'zinc';
  summary: string;
  details: string;
  isCrucial?: boolean;
}

export const HOUSE_RULES: HouseRule[] = [
  {
    id: 'no-show-grace',
    number: '01',
    title: '20-Minute No-Show & Forfeiture Policy',
    tag: 'Strict Rule',
    tagColor: 'amber',
    isCrucial: true,
    summary: 'Be on the court within 20 minutes of your reserved start time.',
    details:
      'Players must check in and occupy their court no later than 20 minutes after their scheduled start time. If a group fails to arrive or notify management within 20 minutes, the booking is declared a No-Show. The reservation is forfeited without refund, and staff will immediately open the slot to waiting walk-in players.',
  },
  {
    id: 'court-shoes',
    number: '02',
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
    number: '03',
    title: 'Firm Turnover at the Buzzer',
    tag: 'Schedule',
    tagColor: 'blue',
    summary: 'Conclude play at the 58th minute to give the next group a clean start.',
    details:
      'Sessions run on the hour. Please wrap up rallies at the 58th minute, collect all balls, and clear the court bench promptly. Extending your session into the next hour is strictly prohibited unless booked and paid in advance or cleared by the desk.',
  },
  {
    id: 'claygo-drinks',
    number: '04',
    title: 'Hydration Only & Clean As You Go (CLAYGO)',
    tag: 'Cleanliness',
    tagColor: 'zinc',
    summary: 'Sealed water and sports tumblers only bench-side. Dispose of all trash.',
    details:
      'Only sealed water bottles and sports drinks are allowed on the player benches. Food, snacks, sticky fruit juices, and colored sodas must stay in the clubhouse lounge. Always throw grip tape wrappers, empty bottles, and tissues into the trash bins provided before leaving.',
  },
  {
    id: 'equipment-care',
    number: '05',
    title: 'Paddle Care & Net Protection',
    tag: 'Gear Care',
    tagColor: 'blue',
    summary: 'Handle rented paddles with care; never sit or lean on tournament nets.',
    details:
      'Rented paddles (₱80/pair) and balls must be returned to the front desk after your game. Smashing paddles against the ground or walls in frustration is strictly penalized with full replacement costs. Do not sit on, climb over, or tamper with the tournament nets and center straps.',
  },
  {
    id: 'night-owl-noise',
    number: '06',
    title: '24/7 Night Owl Etiquette (10 PM – 6 AM)',
    tag: 'Community',
    tagColor: 'amber',
    summary: 'Keep cheering and portable speakers considerate during midnight hours.',
    details:
      'HousePickle Club is proud to offer 24/7 play in front of Aloha Suites. During late-night promo hours (10:00 PM to 6:00 AM), keep portable Bluetooth speakers and loud shouting at a respectful level for neighborhood peace. Night floodlights are turned on strictly for active booked sessions.',
  },
  {
    id: 'sportsmanship',
    number: '07',
    title: '"Good Players, Better People" Sportsmanship',
    tag: 'Motto',
    tagColor: 'emerald',
    summary: 'Treat opponents, partners, and staff with kindness and respect.',
    details:
      'Respect the calls of your peers, embrace fair play, and foster an encouraging environment for beginners and veterans alike. Profanity, physical intimidation, aggressive arguing, or gambling is grounds for immediate eviction from the venue without refund.',
  },
];

export const QUICK_RULES_SUMMARY = [
  {
    icon: 'clock',
    title: '20-Min No-Show Rule',
    text: 'Check in within 20 mins of start time or the slot is released to walk-ins with no refund.',
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
