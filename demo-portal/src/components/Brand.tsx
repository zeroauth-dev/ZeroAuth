/**
 * NeoBank wordmark.
 *
 * Text-only mark in the demo's display family. Two size variants:
 *
 *   small  — AppShell top bar (~18px). Sits inline with nav links.
 *   large  — hero / standalone placements (~36px).
 *
 * Rendered as a <span> so it can be wrapped by an <a> or <Link>
 * without producing invalid nesting (AppShell wraps it in a Link).
 */

import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export type BrandVariant = 'small' | 'large';

export interface BrandProps extends HTMLAttributes<HTMLSpanElement> {
  /** Defaults to `small` — the variant used by the AppShell. */
  variant?: BrandVariant;
}

// font-bold = Tailwind 700; tracking-tight matches .font-display.
// Same weight + tracking across variants so the marks feel like one
// wordmark at two sizes, not two different marks.
const variantClasses: Record<BrandVariant, string> = {
  small: 'text-lg font-bold tracking-tight text-[var(--color-text)]',
  large: 'text-4xl font-bold tracking-tight text-[var(--color-text)]',
};

export function Brand({ variant = 'small', className, ...rest }: BrandProps) {
  return (
    <span
      // Family bound inline so the wordmark is stable on routes that
      // override the body font for a tenant-branded variant.
      style={{ fontFamily: 'var(--font-sans)' }}
      className={cn('inline-block select-none', variantClasses[variant], className)}
      {...rest}
    >
      NeoBank
    </span>
  );
}

export default Brand;
