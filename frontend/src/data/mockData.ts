import { Court, BookingAddon, Promotion, TimeSlot, TimePeriod } from '../types';

export const COURTS: Court[] = [
  {
    id: 'court-1',
    name: 'Court 1',
    tagline: 'Dual-tone pro blue surface with sky blue kitchen zone & bright night lights',
    type: 'standard',
    surface: 'Dual-Tone Pro Blue Acrylic Non-Slip Surface',
    image: '/images/housepickle-arena-court-clean.webp',
    dayRate: 250,
    nightRate: 200,
    badge: 'Court 1',
    features: [
      'Standard full-size court (20 x 44 ft)',
      'Bright night floodlights (no blinding glare)',
      'Sturdy tournament net with center strap',
      'Clubhouse lounge & shaded rest area',
      'Free parking right beside the court'
    ],
    dimensions: '20 x 44 ft'
  },
  {
    id: 'court-2',
    name: 'Court 2',
    tagline: 'Dual-tone pro blue surface with sky blue kitchen zone & bright night lights',
    type: 'standard',
    surface: 'Dual-Tone Pro Blue Acrylic Non-Slip Surface',
    image: '/images/housepickle-arena-court-clean.webp',
    dayRate: 250,
    nightRate: 200,
    badge: 'Court 2',
    features: [
      'Standard full-size court (20 x 44 ft)',
      'Bright night floodlights (no blinding glare)',
      'Sturdy tournament net with center strap',
      'Clubhouse lounge & shaded rest area',
      'Free parking right beside the court'
    ],
    dimensions: '20 x 44 ft'
  }
];

export const ADDONS: BookingAddon[] = [
  {
    id: 'addon-paddles',
    name: 'Pickleball Paddles (Pair)',
    price: 80,
    description: 'Pair of comfortable, lightweight paddles ready for your game.',
    image: '/images/gear-paddle.webp'
  },
  {
    id: 'addon-balls',
    name: 'Outdoor Pickleballs (Set of 3)',
    price: 50,
    description: 'High-bounce durable balls for casual and tournament matches.'
  }
];

export const PROMOTIONS: Promotion[] = [
  {
    id: 'promo-midnight',
    code: 'NIGHTOWL',
    title: 'Late Night Promo',
    discountFixed: 50,
    description: 'Save ₱50 per hour automatically from 10:00 PM to 6:00 AM (₱200/hr promo rate).',
    badge: '₱200 Promo Rate',
    nightOwlOnly: true
  }
];

export const COURT_DETAILS = {
  name: 'HousePickle Club',
  tagline: 'Play • Connect • Repeat',
  motto: 'Good Players, Better People',
  address: 'In front of Aloha Suites, Purok Masinadyahon, Barangay San Isidro, Koronadal City, South Cotabato',
  landmark: 'In front of Aloha Suites entrance',
  city: 'Koronadal City',
  province: 'South Cotabato',
  contactPerson: 'Reymark Vergara',
  contactNumber: '09128285344',
  gcashNumber: '09128285344',
  gcashAccountName: 'Reymark Vergara',
  hours: 'Open 24 Hours / 7 Days a week',
  parking: 'Free dedicated on-site parking',
  lighting: 'Super bright night floodlights (24/7, no blinding glare)',
  surface: 'Tournament red & charcoal non-slip court surface'
};

export const GENERATE_TIME_SLOTS = (): TimeSlot[] => {
  const slots: TimeSlot[] = [];

  const addSlot = (id: string, time: string, hour: number, period: TimePeriod) => {
    slots.push({
      id,
      time,
      hour,
      period,
      isPeak: hour >= 17 && hour <= 21,
      rateType: period === 'night_owl' ? 'night_owl' : 'standard'
    });
  };

  // Morning: 06:00 to 11:00
  addSlot('slot-06', '06:00 AM', 6, 'morning');
  addSlot('slot-07', '07:00 AM', 7, 'morning');
  addSlot('slot-08', '08:00 AM', 8, 'morning');
  addSlot('slot-09', '09:00 AM', 9, 'morning');
  addSlot('slot-10', '10:00 AM', 10, 'morning');
  addSlot('slot-11', '11:00 AM', 11, 'morning');

  // Afternoon: 12:00 to 16:00
  addSlot('slot-12', '12:00 PM', 12, 'afternoon');
  addSlot('slot-13', '01:00 PM', 13, 'afternoon');
  addSlot('slot-14', '02:00 PM', 14, 'afternoon');
  addSlot('slot-15', '03:00 PM', 15, 'afternoon');
  addSlot('slot-16', '04:00 PM', 16, 'afternoon');

  // Evening: 17:00 to 21:00
  addSlot('slot-17', '05:00 PM', 17, 'evening');
  addSlot('slot-18', '06:00 PM', 18, 'evening');
  addSlot('slot-19', '07:00 PM', 19, 'evening');
  addSlot('slot-20', '08:00 PM', 20, 'evening');
  addSlot('slot-21', '09:00 PM', 21, 'evening');

  // Night Owl: 22:00 to 05:00
  addSlot('slot-22', '10:00 PM', 22, 'night_owl');
  addSlot('slot-23', '11:00 PM', 23, 'night_owl');
  addSlot('slot-00', '12:00 AM', 0, 'night_owl');
  addSlot('slot-01', '01:00 AM', 1, 'night_owl');
  addSlot('slot-02', '02:00 AM', 2, 'night_owl');
  addSlot('slot-03', '03:00 AM', 3, 'night_owl');
  addSlot('slot-04', '04:00 AM', 4, 'night_owl');
  addSlot('slot-05', '05:00 AM', 5, 'night_owl');

  return slots;
};

// Static pre-generated slots so components don't recalculate on each render
export const ALL_TIME_SLOTS: TimeSlot[] = GENERATE_TIME_SLOTS();

export const SLOTS_BY_PERIOD: Record<TimePeriod, TimeSlot[]> = {
  morning: ALL_TIME_SLOTS.filter((s) => s.period === 'morning'),
  afternoon: ALL_TIME_SLOTS.filter((s) => s.period === 'afternoon'),
  evening: ALL_TIME_SLOTS.filter((s) => s.period === 'evening'),
  night_owl: ALL_TIME_SLOTS.filter((s) => s.period === 'night_owl'),
};
