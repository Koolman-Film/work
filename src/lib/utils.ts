/**
 * Tiny utility helpers used across the UI.
 */

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * `cn(...)` is the shadcn-style class-name combiner: takes any number of
 * string / object / array inputs (à la clsx), then resolves Tailwind class
 * conflicts (last-one-wins) via tailwind-merge.
 *
 * Use this whenever you compose className strings that include Tailwind
 * utilities — especially when conditional classes might override base ones.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
