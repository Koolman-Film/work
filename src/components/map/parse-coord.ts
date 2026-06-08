/**
 * Parse a coordinate input string into a bounded number (or null when empty).
 *
 * Used by the geofence picker to turn free-typed text into the map's numeric
 * lat/lng state. Mirrors the server-side bounds in
 * `app/(admin)/admin/settings/branches/actions.ts` so client and server agree
 * on what "valid" means.
 *
 *   ''      → { ok: true, value: null }   (empty = no coordinate / cleared)
 *   '13.7'  → { ok: true, value: 13.7 }
 *   '13.'   → { ok: true, value: 13 }     (partial but parseable)
 *   '999'   → { ok: false }               (out of range)
 *   'abc'   → { ok: false }
 *   '-'     → { ok: false }               (not yet a number)
 */
export type ParseCoordResult = { ok: true; value: number | null } | { ok: false };

export function parseCoordInput(text: string, kind: 'lat' | 'lng'): ParseCoordResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };

  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false };

  const bound = kind === 'lat' ? 90 : 180;
  if (n < -bound || n > bound) return { ok: false };

  return { ok: true, value: n };
}
