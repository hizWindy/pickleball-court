import React from 'react';
import { CalendarDays, CloudRain, ExternalLink, LayoutDashboard, ListChecks, LogOut, Plus } from 'lucide-react';
import type { Tab } from './hooks';
import { useNow } from './hooks';
import { cx } from './ui';

const NAV: { tab: Tab; label: string; Icon: typeof LayoutDashboard }[] = [
  { tab: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { tab: 'bookings', label: 'Bookings', Icon: ListChecks },
  { tab: 'schedule', label: 'Schedule', Icon: CalendarDays },
  { tab: 'weather', label: 'Weather', Icon: CloudRain },
];

const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export interface NavBadges {
  /** Paid bookings still waiting for a look. */
  pending: number;
  /** Late bookings the host can still restore. */
  late: number;
  /** Guests waiting to pick a new time after a rain delay. */
  rainDelay: number;
  /** Paid bookings fall in forecast rain. */
  rainExpected: boolean;
}

interface ShellProps {
  tab: Tab;
  onTab: (tab: Tab) => void;
  badges: NavBadges;
  onAdd: () => void;
  onSignOut: () => void;
  children: React.ReactNode;
}

const Badge: React.FC<{ n: number; label: string; tone?: 'amber' | 'blue'; className?: string }> = ({ n, label, tone = 'amber', className }) =>
  n > 0 ? (
    <span
      className={cx(
        'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none text-white tabular-nums',
        tone === 'amber' ? 'bg-amber-500' : 'bg-sky-600',
        className
      )}
      aria-label={label}
    >
      {n}
    </span>
  ) : null;

/** What a nav item wears: a number (something to do) or a quiet dot (rain is expected). */
const Marker: React.FC<{ tab: Tab; badges: NavBadges; floating?: boolean }> = ({ tab, badges, floating }) => {
  if (tab === 'bookings') {
    const className = floating ? 'absolute -right-3 -top-2' : undefined;
    // A Late booking can only be restored for a few minutes, so it outranks payments to look at.
    return badges.late > 0 ? (
      <Badge n={badges.late} label={`${badges.late} late, can be restored`} className={className} />
    ) : (
      <Badge n={badges.pending} label={`${badges.pending} to review`} className={className} />
    );
  }
  if (tab === 'weather') {
    if (badges.rainDelay > 0) {
      return <Badge n={badges.rainDelay} tone="blue" label={`${badges.rainDelay} guests waiting to rebook`} className={floating ? 'absolute -right-3 -top-2' : undefined} />;
    }
    if (badges.rainExpected) {
      return <span className={cx('h-2.5 w-2.5 rounded-full bg-sky-500 ring-2 ring-white', floating && 'absolute -right-1 -top-0.5')} role="img" aria-label="Rain expected" />;
    }
  }
  return null;
};

export const Shell: React.FC<ShellProps> = ({ tab, onTab, badges, onAdd, onSignOut, children }) => {
  const now = useNow(15000);

  return (
    <div id="admin-shell" className="min-h-dvh bg-[#F7F6F1] text-zinc-900">
      <header className="sticky top-0 z-30 h-14 bg-zinc-950 text-white">
        <div className="mx-auto flex h-full max-w-[1200px] items-center gap-2 px-4 lg:px-6">
          <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
          <span className="hidden font-heading text-[15px] font-black tracking-wide sm:block">
            HOUSE<span className="text-[#D2EE5E]">PICKLE</span>
          </span>
          <span className="rounded bg-[#D2EE5E] px-1.5 py-0.5 font-sport text-[10px] font-extrabold uppercase tracking-widest text-zinc-950">Desk</span>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <span className="mr-2 hidden text-xs font-medium tabular-nums text-zinc-400 md:block">{clockFmt.format(now)}</span>
            <button
              type="button"
              onClick={onAdd}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-[#D2EE5E] px-3 text-[13px] font-bold text-zinc-950 transition hover:bg-[#d9ff4d] active:scale-[0.97] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Plus className="h-4 w-4" strokeWidth={3} /> Add
            </button>
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              aria-label="Open the public site"
              title="Open the public site"
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white sm:flex"
            >
              <ExternalLink className="h-[18px] w-[18px]" />
            </a>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1200px]">
        <nav aria-label="Desk sections" className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 flex-col gap-1 border-r border-zinc-200 px-3 py-5 lg:flex">
          {NAV.map(({ tab: t, label, Icon }) => (
            <button
              key={t}
              type="button"
              onClick={() => onTab(t)}
              aria-current={tab === t ? 'page' : undefined}
              className={cx(
                'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]',
                tab === t ? 'bg-zinc-950 text-white' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span className="flex-1 text-left">{label}</span>
              <Marker tab={t} badges={badges} />
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-5 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
      </div>

      <nav aria-label="Desk sections" className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map(({ tab: t, label, Icon }) => (
            <button
              key={t}
              type="button"
              onClick={() => onTab(t)}
              aria-current={tab === t ? 'page' : undefined}
              className="relative flex h-16 flex-col items-center justify-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#15803D]"
            >
              <span className={cx('absolute top-0 h-0.5 w-10 rounded-full transition', tab === t ? 'bg-[#15803D]' : 'bg-transparent')} />
              <span className="relative">
                <Icon className={cx('h-[22px] w-[22px] transition', tab === t ? 'text-[#15803D]' : 'text-zinc-400')} />
                <Marker tab={t} badges={badges} floating />
              </span>
              <span className={cx('text-[11px] font-semibold', tab === t ? 'text-zinc-950' : 'text-zinc-500')}>{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
};
