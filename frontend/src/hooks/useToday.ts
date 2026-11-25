import { useEffect, useState } from 'react';
import { onServerClock, serverNowMs } from '../lib/api';
import { currentPlayDate } from '../lib/time';

/**
 * Today's play day (YYYY-MM-DD), worked out from the server's clock and checked again every `intervalMs`, whenever the
 * page comes back into view, and whenever the server's clock is read. A page left open overnight moves on to the new
 * day at 5:00 AM, instead of keeping the day it was opened on.
 */
export function useToday(intervalMs = 30_000): string {
  const [today, setToday] = useState(() => currentPlayDate(serverNowMs()));
  useEffect(() => {
    // The same date again changes nothing: React skips the re-render.
    const check = () => setToday(currentPlayDate(serverNowMs()));
    const id = window.setInterval(check, intervalMs);
    const stop = onServerClock(check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      stop();
      document.removeEventListener('visibilitychange', check);
    };
  }, [intervalMs]);
  return today;
}
