import { Component, type ReactNode } from 'react';

const KEY = 'hp_reloaded_at';

/**
 * Reload the page, but at most once every 30 seconds so a real fault can't turn into a reload loop.
 * An installed app has no refresh button, so this is how it recovers by itself.
 */
export function reloadOnce(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // storage blocked: reload anyway (the page still only reloads when something failed)
  }
  window.location.reload();
  return true;
}

/** A screen's code that couldn't be fetched: usually the phone has an old page and the site was updated since. */
const isLoadFailure = (e: unknown) =>
  /dynamically imported module|importing a module script|loading chunk|unable to preload|load failed/i.test(String((e as Error)?.message ?? e));

/**
 * Catches a failed screen load so the app never ends on a blank page. A failed load reloads once on its own;
 * anything else shows a plain message with a button.
 */
export class RecoverBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (isLoadFailure(error)) reloadOnce();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F7F6F1] p-6">
        <div className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-lg ring-1 ring-zinc-200">
          <p className="font-heading text-lg font-bold text-zinc-950">That didn't load</p>
          <p className="mt-1 text-sm text-zinc-600">Check your connection, then try again.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 min-h-12 w-full rounded-2xl bg-[#15803D] px-4 font-semibold text-white active:scale-[0.98] cursor-pointer"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
