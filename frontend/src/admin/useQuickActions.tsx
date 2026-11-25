import React, { useCallback, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi } from './api';
import { useDesk } from './desk';
import { firstName } from './format';
import { Btn, Dialog } from './ui';
import type { AdminBooking } from './types';

/** What a screen needs to put a booking back, mark it arrived or release its court, with one shared "busy" and one error dialog. */
export interface QuickApi {
  /** `restore:CODE`, `arrived:CODE` or `release:CODE` while a request is in flight. */
  busy: string | null;
  restore: (b: Pick<AdminBooking, 'code' | 'customerName' | 'courtName' | 'label'>) => void;
  arrived: (b: Pick<AdminBooking, 'code' | 'customerName' | 'label'>) => void;
  /** Release court (a Late group) or Open these hours (a rain delay). */
  release: (b: Pick<AdminBooking, 'code' | 'customerName' | 'courtName' | 'label'>) => void;
}

interface Problem {
  title: string;
  message: string;
  code: string;
  /** Offer "Edit this booking" (the way out when the hours were taken or the time ran out). */
  canEdit: boolean;
}

const PROBLEM_TITLE: Record<string, string> = {
  slot_taken: 'Someone booked those hours',
  restore_window_closed: 'Too late to restore',
  use_restore: 'Already released',
  use_arrived: 'The court is still theirs',
  not_restorable: "Can't be restored",
  cannot_release: "Can't be released",
};

export function useQuickActions(): { q: QuickApi; problemDialog: React.ReactNode } {
  const desk = useDesk();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const run = useCallback(
    async (key: string, code: string, action: () => Promise<unknown>, done: string) => {
      setBusy(key);
      try {
        await action();
        desk.refresh();
        desk.notify(done);
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        setProblem({
          title: (err && PROBLEM_TITLE[err.code]) || "That didn't work",
          message: err?.message ?? 'Something went wrong. Please try again.',
          code,
          canEdit: err?.code === 'slot_taken' || err?.code === 'restore_window_closed',
        });
      } finally {
        setBusy(null);
      }
    },
    [desk]
  );

  const q: QuickApi = {
    busy,
    restore: (b) =>
      run(
        `restore:${b.code}`,
        b.code,
        () => adminApi.restore(b.code),
        b.label === 'rain_delay' ? `Rain delay undone. ${firstName(b.customerName)} is back on ${b.courtName}.` : `${firstName(b.customerName)} is back on ${b.courtName}.`
      ),
    arrived: (b) =>
      run(
        `arrived:${b.code}`,
        b.code,
        () => adminApi.arrived(b.code),
        b.label === 'late' ? `${firstName(b.customerName)}'s group is here. No longer Late.` : `${firstName(b.customerName)}'s group is marked as here. It won't go Late.`
      ),
    release: (b) =>
      run(
        `release:${b.code}`,
        b.code,
        () => adminApi.release(b.code),
        b.label === 'rain_delay' ? `${b.courtName}'s hours are open to others until ${firstName(b.customerName)} picks a new time.` : `${b.courtName} is open to others now.`
      ),
  };

  const problemDialog = problem && (
    <Dialog
      title={problem.title}
      onClose={() => setProblem(null)}
      actions={
        <>
          <Btn onClick={() => setProblem(null)}>OK</Btn>
          {problem.canEdit && (
            <Btn
              variant="dark"
              onClick={() => {
                setProblem(null);
                desk.editBooking(problem.code);
              }}
            >
              Edit this booking
            </Btn>
          )}
        </>
      }
    >
      <p>{problem.message}</p>
    </Dialog>
  );

  return { q, problemDialog };
}
