import clsx, { type ClassValue } from 'clsx';

/**
 * Tiny class-name helper. clsx alone is enough for our needs — we don't
 * need tailwind-merge because we don't have conflicting utility overrides
 * in our primitives.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
