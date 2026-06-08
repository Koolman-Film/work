/**
 * Nominatim (OpenStreetMap geocoding) response parsing.
 *
 * Pure — no React/Next imports — so it's unit-testable in isolation. The
 * /api/geocode Route Handler stays a thin fetch wrapper around this; all the
 * shape-mapping and validation lives here.
 *
 * Nominatim rows look like: { display_name: string, lat: "13.7", lon: "100.5", … }
 * (lat/lon are strings). We trim to what the picker needs and drop anything
 * malformed or out of geographic range.
 */

export type GeoResult = {
  /** Human-readable label shown in the dropdown (Nominatim's display_name). */
  displayName: string;
  lat: number;
  lng: number;
};

export function parseNominatimResults(raw: unknown): GeoResult[] {
  if (!Array.isArray(raw)) return [];

  const out: GeoResult[] = [];
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;

    const displayName = typeof r.display_name === 'string' ? r.display_name : '';
    if (!displayName) continue;

    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) continue;

    out.push({ displayName, lat, lng });
  }
  return out;
}
