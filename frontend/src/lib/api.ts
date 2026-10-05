import type {
  AppConfig,
  Availability,
  Booking,
  BookingWithToken,
  CreateBookingRequest,
} from '../types';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Device clocks are often wrong; every response carries serverNow and we keep the offset.
let serverOffsetMs = 0;

export const serverNowMs = () => Date.now() + serverOffsetMs;

function syncClock(payload: unknown) {
  const now = (payload as { serverNow?: string; booking?: { serverNow?: string } } | null);
  const iso = now?.serverNow ?? now?.booking?.serverNow;
  if (iso) {
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) serverOffsetMs = parsed - Date.now();
  }
}

const NETWORK_ERROR = () =>
  new ApiError('network', "Can't reach the booking server. Check your connection and try again.", 0);

async function parse<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(err?.code ?? 'http_error', err?.message ?? 'Something went wrong. Please try again.', res.status);
  }
  syncClock(body);
  return body as T;
}

async function request<T>(path: string, init: RequestInit & { json?: unknown; token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  if (init.token) headers.set('X-Booking-Token', init.token);
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      cache: 'no-store',
    });
  } catch {
    throw NETWORK_ERROR();
  }
  return parse<T>(res);
}

const enc = encodeURIComponent;

export const api = {
  config: () => request<AppConfig>('/api/config'),

  availability: (date: string) => request<Availability>(`/api/availability?date=${enc(date)}`),

  createBooking: (body: CreateBookingRequest) =>
    request<BookingWithToken>('/api/bookings', { method: 'POST', json: body }),

  getBooking: (code: string, token: string) => request<Booking>(`/api/bookings/${enc(code)}`, { token }),

  cancel: (code: string, token: string) =>
    request<Booking>(`/api/bookings/${enc(code)}/cancel`, { method: 'POST', token }),

  submitReference: (
    code: string,
    token: string,
    body: { referenceNumber: string; paidTime: string; payerName: string }
  ) => request<Booking>(`/api/bookings/${enc(code)}/reference`, { method: 'POST', json: body, token }),

  /** XHR instead of fetch so we can show real upload progress on slow mobile data. */
  uploadReceipt: (code: string, token: string, file: Blob, onProgress?: (fraction: number) => void) =>
    new Promise<Booking>((resolve, reject) => {
      const form = new FormData();
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      form.append('receipt', file, `receipt.${ext}`);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/bookings/${enc(code)}/receipt`);
      xhr.setRequestHeader('X-Booking-Token', token);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onerror = () => reject(NETWORK_ERROR());
      xhr.onload = () => {
        const res = new Response(xhr.responseText, {
          status: xhr.status,
          headers: { 'Content-Type': 'application/json' },
        });
        parse<Booking>(res).then(resolve, reject);
      };
      xhr.send(form);
    }),
};

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
}
