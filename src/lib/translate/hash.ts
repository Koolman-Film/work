import { createHash } from 'node:crypto';

/** Normalize source text for caching — only outer whitespace is collapsed, so
 *  visually-identical submissions that differ by a trailing newline reuse the
 *  same cache row. Inner content is left untouched (it's the thing translated). */
export function normalizeSource(text: string): string {
  return text.trim();
}

/** Stable cache key for a piece of source text: `sha256(normalized)` as
 *  lowercase hex. Target language is NOT folded in here — it's the second
 *  half of the `(sourceHash, targetLang)` composite key in the DB, so one
 *  source can be cached per target. */
export function sourceHashFor(text: string): string {
  return createHash('sha256').update(normalizeSource(text), 'utf8').digest('hex');
}
