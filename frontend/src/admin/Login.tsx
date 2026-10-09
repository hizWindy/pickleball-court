import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { adminApi } from './api';
import { cx } from './ui';

/** Faint court markings behind the form: baselines, kitchen lines and the centre line. */
const CourtLines: React.FC = () => (
  <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full text-white opacity-[0.07]" viewBox="0 0 440 200" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="30" y="20" width="380" height="160" />
    <line x1="220" y1="8" x2="220" y2="192" strokeWidth="2" />
    <line x1="150" y1="20" x2="150" y2="180" />
    <line x1="290" y1="20" x2="290" y2="180" />
    <line x1="30" y1="100" x2="150" y2="100" />
    <line x1="290" y1="100" x2="410" y2="100" />
  </svg>
);

export const Login: React.FC<{ onSignedIn: () => void }> = ({ onSignedIn }) => {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.login(password);
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-zinc-950 px-5 py-10 text-white">
      <CourtLines />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="relative w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-11 w-11 rounded-xl" />
          <div className="leading-none">
            <div className="flex items-center gap-2">
              <span className="font-heading text-lg font-black tracking-wide">
                HOUSE<span className="text-[#D2EE5E]">PICKLE</span>
              </span>
              <span className="rounded bg-[#D2EE5E] px-1.5 py-0.5 font-sport text-[10px] font-extrabold uppercase tracking-widest text-zinc-950">Desk</span>
            </div>
            <p className="mt-1.5 font-sport text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400">Staff only</p>
          </div>
        </div>

        <h1 className="font-heading text-3xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-1.5 text-sm text-zinc-400">Check payments, manage the courts and see how the week is going.</p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          {/* Lets iCloud Keychain / Google Password Manager save and fill the password. */}
          <input type="text" name="username" autoComplete="username" defaultValue="desk" readOnly tabIndex={-1} aria-hidden className="sr-only" />
          <div>
            <label htmlFor="desk-password" className="mb-1.5 block text-[13px] font-semibold text-zinc-300">
              Password
            </label>
            <div className="relative">
              <input
                id="desk-password"
                ref={input}
                type={show ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'desk-error' : undefined}
                className={cx(
                  'h-12 w-full rounded-xl border bg-white/[0.06] pl-4 pr-12 text-base text-white placeholder:text-zinc-500 transition',
                  'focus:border-[#D2EE5E] focus:outline-none focus:ring-2 focus:ring-[#D2EE5E]/30',
                  error ? 'border-red-400/70' : 'border-white/15'
                )}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-zinc-400 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D2EE5E]"
              >
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            {error && (
              <p id="desk-error" role="alert" className="mt-2 text-sm font-medium text-red-300">
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!password || busy}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#D2EE5E] text-[15px] font-bold text-zinc-950 transition hover:bg-[#d9ff4d] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>

        <a href="/" className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to the site
        </a>
      </motion.div>
    </main>
  );
};
