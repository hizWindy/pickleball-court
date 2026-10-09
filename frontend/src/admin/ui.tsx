import React, { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { cx } from '../components/booking/ui';
import { LABEL, type AdminLabel, type Tone } from './format';

export { cx };

// ── Surfaces & text ───────────────────────────────────────────────────────────
// A card that is given its own background or border colour (an amber note, say) must not also get the white one:
// when two utilities set the same property, the stylesheet order decides, not the order in the class list.
const hasBg = (c?: string) => /(^|\s)bg-/.test(c ?? '');
const hasBorderColor = (c?: string) => /(^|\s)border-(?:[a-z]+-\d{2,3}|transparent)/.test(c ?? '');

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div {...rest} className={cx('rounded-2xl border', !hasBorderColor(className) && 'border-zinc-200', !hasBg(className) && 'bg-white', className)} />
);

/** Small uppercase section label, in the club's condensed sport face. */
export const Label: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <span className={cx('font-sport text-[11px] font-extrabold uppercase tracking-[0.14em] text-zinc-500', className)}>{children}</span>
);

export const Num: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <span className={cx('font-heading font-bold tracking-tight', className)}>{children}</span>
);

const TONES: Record<Tone, { pill: string; dot: string }> = {
  green: { pill: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-600' },
  amber: { pill: 'bg-amber-50 text-amber-900 ring-amber-300', dot: 'bg-amber-500' },
  red: { pill: 'bg-red-50 text-red-800 ring-red-200', dot: 'bg-red-500' },
  zinc: { pill: 'bg-zinc-100 text-zinc-600 ring-zinc-200', dot: 'bg-zinc-400' },
  blue: { pill: 'bg-sky-50 text-sky-800 ring-sky-200', dot: 'bg-sky-500' },
  dark: { pill: 'bg-zinc-900 text-white ring-zinc-900', dot: 'bg-[#D2EE5E]' },
};

/** The one word on a booking: Paid, Late, Done, Rain delay (or one of the rare ones). */
export const LabelBadge: React.FC<{ label: AdminLabel; className?: string }> = ({ label, className }) => {
  const s = LABEL[label];
  const tone = TONES[s.tone];
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1', tone.pill, className)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', tone.dot, label === 'needs_check' && 'animate-pulse motion-reduce:animate-none')} />
      {s.label}
    </span>
  );
};

export const Tag: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = ({ tone = 'zinc', children, className }) => (
  <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1', TONES[tone].pill, className)}>{children}</span>
);

// ── Buttons ───────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'dark' | 'danger' | 'outline' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[#15803D] text-white hover:bg-[#166534] disabled:bg-zinc-200 disabled:text-zinc-400',
  dark: 'bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-400',
  danger: 'bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50',
  outline: 'bg-white text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-50 disabled:opacity-50',
  ghost: 'text-zinc-700 hover:bg-zinc-100 disabled:opacity-50',
};

type Size = 'sm' | 'md' | 'lg';
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean };

const btnClass = (variant: Variant, size: Size, className?: string) =>
  cx(
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition cursor-pointer disabled:cursor-not-allowed',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] focus-visible:ring-offset-2',
    'active:scale-[0.98] motion-reduce:active:scale-100',
    size === 'sm' ? 'h-9 px-3 text-[13px]' : size === 'md' ? 'h-11 px-4 text-sm' : 'h-12 px-5 text-[15px]',
    VARIANTS[variant],
    className
  );

export const Btn: React.FC<BtnProps> = ({ variant = 'outline', size = 'md', loading, className, children, disabled, type = 'button', ...rest }) => (
  <button {...rest} type={type} disabled={disabled || loading} className={btnClass(variant, size, className)}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
    {children}
  </button>
);

/** A link (call, text) that looks and feels like a Btn. */
export const LinkBtn: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }> = ({
  variant = 'outline',
  size = 'md',
  className,
  children,
  ...rest
}) => (
  <a {...rest} className={btnClass(variant, size, className)}>
    {children}
  </a>
);

/** Copy some text (a message to paste into Messenger, say), with a quiet "Copied" confirmation. */
export const CopyBtn: React.FC<{ text: string; label?: string; size?: Size; className?: string }> = ({ text, label = 'Copy', size = 'md', className }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older iOS without clipboard permission: select a hidden input instead
      const input = document.createElement('input');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setCopied(true);
  };

  return (
    <Btn size={size} variant="outline" onClick={copy} className={cx(copied && '!bg-emerald-50 !text-emerald-800 !ring-emerald-200', className)} aria-live="polite">
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? 'Copied' : label}
    </Btn>
  );
};

// ── Form fields ───────────────────────────────────────────────────────────────
const inputBase =
  'w-full rounded-xl border border-zinc-300 bg-white px-3 text-base text-zinc-900 placeholder:text-zinc-400 transition sm:text-sm ' +
  'focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:bg-zinc-50 disabled:text-zinc-500';

export const Field: React.FC<{ label: string; hint?: string; error?: string | null; children: (id: string) => React.ReactNode; className?: string }> = ({
  label,
  hint,
  error,
  children,
  className,
}) => {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-zinc-700">
        {label}
      </label>
      {children(id)}
      {error ? <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p> : hint ? <p className="mt-1.5 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
};

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) => (
  <input ref={ref} {...rest} className={cx(inputBase, 'h-11', className)} />
));
TextInput.displayName = 'TextInput';

export const SelectInput: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className, ...rest }) => (
  <select {...rest} className={cx(inputBase, 'h-11 cursor-pointer', className)} />
);

export const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className, ...rest }) => (
  <textarea {...rest} className={cx(inputBase, 'min-h-20 py-2.5', className)} />
);

/** Pick one of a few options. Roomy tap targets, one line on a phone. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('flex gap-1 rounded-xl bg-zinc-100 p-1', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-9 flex-1 rounded-lg px-3 text-[13px] font-semibold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]',
            o.value === value ? 'bg-white text-zinc-950 shadow-xs ring-1 ring-zinc-200' : 'text-zinc-500 hover:text-zinc-800'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({ checked, onChange, label, hint }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
  >
    <span>
      <span className="block text-sm font-semibold text-zinc-800">{label}</span>
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </span>
    <span className={cx('relative h-6 w-10 shrink-0 rounded-full transition', checked ? 'bg-[#15803D]' : 'bg-zinc-300')}>
      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </span>
  </button>
);

export const ErrorNote: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  children ? (
    <div role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700 ring-1 ring-red-100">
      {children}
    </div>
  ) : null;

// ── Layers ────────────────────────────────────────────────────────────────────
let openLayers = 0;
/** While a sheet or dialog is open, the desk behind it can't be tapped, tabbed to or read by a screen reader. */
function useInertBackground() {
  useEffect(() => {
    const shell = document.getElementById('admin-shell');
    openLayers += 1;
    shell?.setAttribute('inert', '');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      openLayers -= 1;
      if (openLayers === 0) {
        shell?.removeAttribute('inert');
        document.body.style.overflow = prevOverflow;
      }
    };
  }, []);
}

function useEscape(onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ref.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Full-height sheet: slides up on a phone, sits at the right edge on a desktop. */
export const Sheet: React.FC<{
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  label: string;
}> = ({ title, onClose, children, footer, label }) => {
  useInertBackground();
  useEscape(onClose);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus(), []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-zinc-950/55"
        onClick={onClose}
        aria-hidden
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        className="relative mt-8 flex w-full flex-col overflow-hidden rounded-t-3xl bg-[#F6F8FA] shadow-2xl outline-none sm:mt-0 sm:max-w-[34rem] sm:rounded-none sm:rounded-l-3xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="shrink-0 border-t border-zinc-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">{footer}</div>}
      </motion.div>
    </div>
  );
};

export const Dialog: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  actions: React.ReactNode;
}> = ({ title, onClose, children, actions }) => {
  useInertBackground();
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-zinc-950/60" onClick={onClose} aria-hidden />
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl"
      >
        <h2 className="font-heading text-lg font-bold text-zinc-950">{title}</h2>
        <div className="mt-2 space-y-3 text-sm text-zinc-600">{children}</div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{actions}</div>
      </motion.div>
    </div>
  );
};
