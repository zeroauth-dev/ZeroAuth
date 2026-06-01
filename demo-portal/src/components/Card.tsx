/**
 * Generic card primitive — used everywhere in the demo.
 *
 * Mirrors the dashboard's Card/CardHeader/CardBody triple so devs
 * who switch between the two surfaces don't re-learn the API. The
 * differences: lighter palette (white surface, cream page bg) and
 * larger rounding (2xl) for the softer consumer feel.
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

// ─── Outer card ───────────────────────────────────────────────────

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-raised)] shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────

export interface CardHeaderProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot, usually a single action button. */
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  // Render nothing when nothing meaningful was passed; saves callers
  // from wrapping the component in a conditional.
  if (!title && !description && !action) return null;
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-6 py-5',
        className,
      )}
    >
      <div className="min-w-0">
        {title ? (
          <h2
            // font-display (Fraunces) for the softer "real bank" voice.
            className="font-display text-lg font-medium text-[var(--color-text)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {title}
          </h2>
        ) : null}
        {description ? (
          <p className="mt-1 text-sm text-[var(--color-text-dim)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex-shrink-0">{action}</div> : null}
    </div>
  );
}

// ─── Body ─────────────────────────────────────────────────────────

export interface CardBodyProps {
  className?: string;
  children: ReactNode;
}

export function CardBody({ className, children }: CardBodyProps) {
  return <div className={cn('px-6 py-5', className)}>{children}</div>;
}

// ─── Footer ───────────────────────────────────────────────────────

export interface CardFooterProps {
  className?: string;
  children: ReactNode;
}

/** Optional bottom slot — used for "Save / Cancel" rows under a form. */
export function CardFooter({ className, children }: CardFooterProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] px-6 py-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export default Card;
