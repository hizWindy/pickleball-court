import { createContext, useContext } from 'react';
import type { AppConfig } from '../types';
import type { Tab } from './hooks';
import type { NavCounts } from './types';

/** Pre-filled values when the booking form is opened from the schedule or a shortcut. */
export interface FormSeed {
  kind?: 'walk_in' | 'block';
  courtId?: string;
  date?: string;
  hour?: number;
}

export interface Desk {
  config: AppConfig | null;
  counts: NavCounts | null;
  /** Bumped after every change, so lists and charts reload. */
  refreshKey: number;
  refresh: () => void;
  openBooking: (code: string) => void;
  addBooking: (seed?: FormSeed) => void;
  editBooking: (code: string) => void;
  goto: (tab: Tab, opts?: { status?: string }) => void;
  notify: (message: string) => void;
}

export const DeskContext = createContext<Desk | null>(null);

export function useDesk(): Desk {
  const desk = useContext(DeskContext);
  if (!desk) throw new Error('useDesk must be used inside the desk');
  return desk;
}
