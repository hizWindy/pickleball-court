import { ApiError } from '../lib/api';
import type {
  AdminBookingDetail,
  AdminBookingList,
  AdminSchedule,
  CreateBody,
  ListQuery,
  NavCounts,
  Overview,
  UpdateBody,
} from './types';

/** Fired when the server says the session is gone, so the whole desk can fall back to the sign-in screen. */
export const SIGNED_OUT_EVENT = 'hp-admin-signed-out';

async function call<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: {
        'X-HP-Admin': '1', // writes are refused without it, which a forged cross-site form can't add
        ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('network', "Can't reach the server. Check the connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    if (res.status === 401 && err?.code === 'unauthorized') window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new ApiError(err?.code ?? 'http_error', err?.message ?? 'Something went wrong. Please try again.', res.status);
  }
  return body as T;
}

const enc = encodeURIComponent;

export const adminApi = {
  session: () => call<{ authenticated: boolean }>('/api/admin/session'),
  login: (password: string) => call<{ authenticated: boolean }>('/api/admin/login', { method: 'POST', json: { password } }),
  logout: () => call<{ authenticated: boolean }>('/api/admin/logout', { method: 'POST' }),

  counts: () => call<NavCounts>('/api/admin/counts'),
  overview: (days: number) => call<Overview>(`/api/admin/overview?days=${days}`),
  schedule: (date: string) => call<AdminSchedule>(`/api/admin/schedule?date=${enc(date)}`),

  list: (query: ListQuery) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '' && value !== 'all') params.set(key, String(value));
    }
    return call<AdminBookingList>(`/api/admin/bookings?${params}`);
  },
  get: (code: string) => call<AdminBookingDetail>(`/api/admin/bookings/${enc(code)}`),
  create: (body: CreateBody) => call<AdminBookingDetail>('/api/admin/bookings', { method: 'POST', json: body }),
  update: (code: string, body: UpdateBody) => call<AdminBookingDetail>(`/api/admin/bookings/${enc(code)}`, { method: 'PATCH', json: body }),
  confirm: (code: string) => call<AdminBookingDetail>(`/api/admin/bookings/${enc(code)}/confirm`, { method: 'POST' }),
  /** "Looks good": the host checked an automatically confirmed payment. */
  check: (code: string) => call<AdminBookingDetail>(`/api/admin/bookings/${enc(code)}/check`, { method: 'POST' }),
  reject: (code: string, reason?: string) =>
    call<AdminBookingDetail>(`/api/admin/bookings/${enc(code)}/reject`, { method: 'POST', json: { reason: reason || null } }),
  cancel: (code: string, reason?: string) =>
    call<AdminBookingDetail>(`/api/admin/bookings/${enc(code)}/cancel`, { method: 'POST', json: { reason: reason || null } }),
  remove: (code: string) => call<void>(`/api/admin/bookings/${enc(code)}`, { method: 'DELETE' }),
  receiptUrl: (code: string) => `/api/admin/bookings/${enc(code)}/receipt`,
};
