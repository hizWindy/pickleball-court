import React from 'react';
import { hourLabel } from '../lib/time';
import { manilaHour } from './format';
import { rainFill, upcomingHours } from './forecast';
import { cx } from './ui';
import type { WeatherReport } from './types';

/** The next 12 hours as little bars: tall and dark means rain is likely. */
export const RainBars: React.FC<{ report: WeatherReport; nowMs: number; className?: string }> = ({ report, nowMs, className }) => {
  const hours = upcomingHours(report, nowMs).slice(0, 12);
  if (hours.length === 0) return null;
  const label = hours.map((h) => `${hourLabel(manilaHour(Date.parse(h.at)))} ${h.probability}%`).join(', ');
  return (
    <div className={className}>
      <div role="img" aria-label={`Chance of rain, next ${hours.length} hours: ${label}`} className="flex h-10 items-end gap-[3px]">
        {hours.map((h) => (
          <div
            key={h.at}
            title={`${hourLabel(manilaHour(Date.parse(h.at)))}: ${h.probability}% chance of rain`}
            className={cx('min-w-0 flex-1 rounded-t-[3px]', h.probability >= report.warnPercent && 'ring-1 ring-sky-700/30')}
            style={{ height: `${Math.max(8, h.probability)}%`, backgroundColor: rainFill(h.probability) }}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-[10px] font-medium text-zinc-400" aria-hidden>
        {hours.map((h, i) => (
          <span key={h.at} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-left">
            {i % 3 === 0 ? hourLabel(manilaHour(Date.parse(h.at))).replace(' ', '') : ''}
          </span>
        ))}
      </div>
    </div>
  );
};
