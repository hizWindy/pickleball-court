import { createContext, useContext } from 'react';
import type { AppConfig } from '../types';
import type { Tab } from './hooks';
import type { NavCounts, WeatherReport } from './types';

/** Pre-filled values when the booking form is opened from the schedule or a shortcut. */
export interface FormSeed {
  kind?: 'walk_in' | 'block';
  courtId?: string;
  date?: string;
  hour?: number;
}

/** The rain forecast, loaded once for the whole desk (the Weather tab, the overview card and the nav dot share it). */
export interface WeatherState {
  report: WeatherReport | null;
  /** Nothing has come back yet. */
  loading: boolean;
  /** The request itself failed (not the same as `report.available === false`). */
  failed: boolean;
}

export interface Desk {
  config: AppConfig | null;
  counts: NavCounts | null;
  weather: WeatherState;
  /** Ask for a fresh forecast (the server only calls the weather service every 15 minutes). */
  refreshWeather: () => void;
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
