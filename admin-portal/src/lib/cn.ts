import clsx, { type ClassValue } from 'clsx';

/**
 * Tiny class-name helper, byte-identical to dashboard/src/lib/cn.ts and
 * demo-portal/src/lib/cn.ts. clsx alone is enough — no conflicting utility
 * overrides in our primitives, so we skip tailwind-merge.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
