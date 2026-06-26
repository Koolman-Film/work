/**
 * Per-browser "seen" set for product-updates, in localStorage.
 *
 * SSR-safe: on the server (no `window`) or when storage is unavailable /
 * malformed, reads return an empty set and writes are no-ops — never throws.
 * Cross-device consistency is intentionally out of scope (see the design spec).
 */

export const SEEN_STORAGE_KEY = 'koolman.productUpdates.seen.v1';

export function readSeen(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((x): x is string => typeof x === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

export function persistSeen(ids: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // storage full / disabled — degrade silently
  }
}
