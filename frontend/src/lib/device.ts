/**
 * What this device remembers. The server is the source of truth for bookings;
 * the device only keeps the secrets needed to reach them again after a refresh.
 */

export interface SavedPass {
  code: string;
  token: string;
  savedAt: string;
}

export interface SavedDetails {
  name: string;
  phone: string;
}

const PASSES_KEY = 'hpc_passes_v1';
const ACTIVE_KEY = 'hpc_active_hold_v1';
const DETAILS_KEY = 'hpc_details_v1';
const DOWNLOADED_KEY = 'hpc_pass_downloaded_v1';
const LEGACY_KEYS = ['housepickle_court_bookings_v2'];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked (private mode) - the flow still works for this session
  }
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const device = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  passes: (): SavedPass[] => read<SavedPass[]>(PASSES_KEY, []),

  savePass(code: string, token: string) {
    const rest = device.passes().filter((p) => p.code !== code);
    write(PASSES_KEY, [{ code, token, savedAt: new Date().toISOString() }, ...rest].slice(0, 30));
    emit();
  },

  forgetPass(code: string) {
    write(PASSES_KEY, device.passes().filter((p) => p.code !== code));
    if (device.activeHold()?.code === code) write(ACTIVE_KEY, null);
    emit();
  },

  tokenFor: (code: string) => device.passes().find((p) => p.code === code)?.token,

  /** The booking currently in its payment window (the server's hold time), if any. */
  activeHold: (): { code: string; token: string } | null => read(ACTIVE_KEY, null),

  setActiveHold(code: string, token: string) {
    write(ACTIVE_KEY, { code, token });
    emit();
  },

  clearActiveHold() {
    write(ACTIVE_KEY, null);
    emit();
  },

  details: (): SavedDetails | null => read<SavedDetails | null>(DETAILS_KEY, null),

  saveDetails(details: SavedDetails | null) {
    write(DETAILS_KEY, details);
  },

  wasDownloaded: (code: string) => read<string[]>(DOWNLOADED_KEY, []).includes(code),

  markDownloaded(code: string) {
    write(DOWNLOADED_KEY, [code, ...read<string[]>(DOWNLOADED_KEY, []).filter((c) => c !== code)].slice(0, 50));
  },

  dropLegacyData() {
    LEGACY_KEYS.forEach((k) => write(k, null));
  },
};
