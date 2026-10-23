'use client';

import { forwardRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// ---------- Button ----------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
};

const variantCls: Record<string, string> = {
  primary:
    'bg-turmeric text-ink font-semibold hover:bg-turmeric-dark active:scale-[0.98] shadow-card',
  secondary:
    'border border-leaf text-leaf font-semibold hover:bg-leaf-tint active:scale-[0.98]',
  ghost: 'text-ink-soft hover:bg-rice-deep',
  danger: 'bg-chili text-white font-semibold hover:bg-chili-dark active:scale-[0.98]',
};
const sizeCls: Record<string, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  md: 'px-4 py-2.5 text-sm rounded-xl',
  lg: 'px-6 py-3 text-base rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variantCls[variant]} ${sizeCls[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------- VegDot (FSSAI-style mark) ----------

export function VegDot({ isVeg, className = '' }: { isVeg: boolean; className?: string }) {
  const color = isVeg ? '#1E4D2B' : '#C63D2F';
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center border-2 ${className}`}
      style={{ borderColor: color }}
      title={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      aria-label={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

// ---------- Badge ----------

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: 'green' | 'amber' | 'red' | 'neutral';
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    green: 'bg-leaf-tint text-leaf',
    amber: 'bg-turmeric-tint text-turmeric-deep',
    red: 'bg-chili-tint text-chili-dark',
    neutral: 'bg-rice-deep text-ink-soft',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ---------- Chip ----------

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-pill border min-h-[44px] px-3.5 text-sm font-medium transition-colors ${
        active
          ? 'border-leaf bg-leaf text-white'
          : 'border-rice-line bg-white text-ink-soft hover:border-leaf/40'
      }`}
    >
      {children}
    </button>
  );
}

// ---------- Card ----------

export function Card({
  className = '',
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
  children: React.ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div className={`rounded-card border border-rice-line bg-white shadow-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

// ---------- Form fields ----------

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`w-full rounded-xl border border-rice-line bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-leaf ${className}`}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = '', ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={`w-full rounded-xl border border-rice-line bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-leaf ${className}`}
      {...rest}
    />
  );
});

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className = '', children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={`w-full rounded-xl border border-rice-line bg-white px-3.5 py-2.5 text-sm text-ink focus:border-leaf ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
});

// ---------- Skeleton / EmptyState ----------

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function EmptyState({
  emoji,
  title,
  body,
  action,
}: {
  emoji: string;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="text-5xl" aria-hidden>
        {emoji}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {body && <p className="max-w-sm text-sm text-ink-soft">{body}</p>}
      {action}
    </div>
  );
}

// ---------- Stars ----------

export function Stars({ rating, count }: { rating: number; count?: number }) {
  if (!rating) return <span className="text-xs text-ink-faint">New kitchen</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span className="inline-flex items-center gap-0.5 rounded-md bg-leaf px-1.5 py-0.5 text-xs font-bold text-white">
        ★ {rating.toFixed(1)}
      </span>
      {count !== undefined && <span className="text-xs text-ink-faint">({count})</span>}
    </span>
  );
}

// ---------- SectionTitle ----------

export function SectionTitle({
  eyebrow,
  title,
  className = '',
}: {
  eyebrow?: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={`mb-4 ${className}`}>
      {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
      <h2 className="text-xl font-bold sm:text-2xl">{title}</h2>
    </div>
  );
}

// ---------- Modal / Bottom sheet ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  sheet = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /**
   * Optional actions bar (e.g. a wizard's Back/Continue pair) rendered
   * OUTSIDE the scrollable body, in its own fixed-height flex row at the
   * bottom of the dialog — so it stays reachable no matter how tall the
   * body content is or how short the viewport is (a plain CSS
   * `position: sticky` footer can still end up pushed past a very short
   * viewport if the sticky element itself is taller than the remaining
   * space; pinning it outside the scroll region entirely avoids that).
   */
  footer?: React.ReactNode;
  /** bottom-sheet on mobile */
  sheet?: boolean;
}) {
  // Lock background scroll while the dialog is open. The cleanup function
  // below fires whenever `open` flips back to false (dependency change) —
  // AND whenever this Modal component itself unmounts, since React always
  // runs an effect's cleanup on unmount regardless of why the unmount
  // happened. That matters here: if the parent tree unmounts abruptly
  // (e.g. a route navigation while the dialog is open) framer-motion's own
  // exit animation never runs, so an onExitComplete-only restore would
  // leave body scroll locked forever — this cleanup restores it either way.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className={`fixed inset-0 z-[80] flex justify-center ${sheet ? 'items-end sm:items-center' : 'items-center px-4'}`}>
          <motion.button
            aria-label="Close"
            className="absolute inset-0 w-full bg-ink/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal
            initial={sheet ? { y: '100%' } : { opacity: 0, scale: 0.95, y: 12 }}
            animate={sheet ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={sheet ? { y: '100%' } : { opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', damping: 30, stiffness: 380 }}
            className={
              // Centred with flexbox (not CSS translate): framer-motion writes an inline
              // `transform` for the enter animation, which would override a translate-based centring.
              sheet
                ? 'relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl bg-rice shadow-lift sm:max-w-md sm:rounded-3xl'
                : 'relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-rice shadow-lift'
            }
          >
            {/* Scrollable body — overscroll-contain stops an over-scroll at
                the top/bottom of this box from "leaking" into a rubber-band
                scroll of the page behind it (mainly an iOS Safari behaviour;
                the body-overflow lock above is the primary/cross-browser fix). */}
            <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${sheet ? 'p-5 pb-8' : 'p-5'}`}>
              {title && <h3 className="mb-4 text-lg font-bold">{title}</h3>}
              {children}
            </div>
            {footer && (
              <div className="sticky bottom-0 shrink-0 border-t border-rice-line bg-rice px-5 py-4">{footer}</div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
