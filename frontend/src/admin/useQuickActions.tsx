import React, { useCallback, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi } from './api';
import { useDesk } from './desk';
import { firstName } from './format';
import { Btn, Dialog } from './ui';
import type { AdminBooking } from './types';

/** What a screen needs to put a booking back or mark it arrived, with one shared "busy" and one error dialog. */
export interface QuickApi {
  /** `restore:CODE` or `arrived:CODE` while a request is in flight. */
  busy: string | null;
  restore: (b: Pick<AdminBooking, 'code' | 'customerName' | 'courtName' | 'label'>) => void;
  arrived: (b: Pick<AdminBooking, 'code' | 'customerName'>) => void;
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
  not_restorable: "Can't be restored",
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
    arrived: (b) => run(`arrived:${b.code}`, b.code, () => adminApi.arrived(b.code), `${firstName(b.customerName)}'s group is marked as here. It won't go Late.`),
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
