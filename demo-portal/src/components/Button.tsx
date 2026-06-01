/**
 * Demo-portal Button.
 *
 * Two variants (primary, secondary) and two sizes (md, lg) — the demo
 * intentionally has no destructive or ghost surface. Heights are bigger
 * than the dashboard's because consumer surfaces need touch-friendly
 * targets (both variants ≥ 44px to meet WCAG 2.5.5).
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary';
export type ButtonSize = 'md' | 'lg';

const buttonBase = cn(
  'inline-flex items-center justify-center gap-2 rounded-md',
  'font-medium transition-colors',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'focus-visible:outline-none focus-visible:ring-2',
  'focus-visible:ring-[var(--color-accent)]/40',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]',
);

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-accent)] text-white shadow-sm hover:opacity-90 active:opacity-100',
  secondary:
    'border border-[var(--color-border)] bg-[var(--color-bg-raised)] text-[var(--color-text)] hover:border-[var(--color-text-dim)]',
};

const buttonSizes: Record<ButtonSize, string> = {
  md: 'h-11 px-5 text-sm',
  lg: 'h-14 px-7 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show a spinner and disable while an action is in flight. */
  loading?: boolean;
  /** Optional decorative icon shown before the label. */
  leadingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    leadingIcon,
    children,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // Default `type="button"` so an accidental click inside a form
      // ancestor does not trigger a page reload.
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : leadingIcon ? (
        <span aria-hidden="true" className="inline-flex">
          {leadingIcon}
        </span>
      ) : null}
      {children}
    </button>
  );
});

export default Button;
