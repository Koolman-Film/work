/**
 * Tolerant reader for the `User.productUpdatesSeen` JSON column (a string[]).
 * Server- and client-safe, no I/O. Mirrors the tolerance the retired
 * localStorage reader used to provide, but for the DB value.
 */
export function parseSeen(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}
