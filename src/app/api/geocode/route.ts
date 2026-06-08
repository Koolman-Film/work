import { type NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/check-permission';
import { parseNominatimResults } from '@/lib/geo/nominatim';

/**
 * Geocoding proxy → Nominatim (OpenStreetMap).
 *
 * Why a server proxy instead of a direct browser call:
 *   - Nominatim's usage policy wants an identifying User-Agent (browsers can't
 *     set one).
 *   - Keeps the provider server-side so we can later swap to a keyed provider
 *     (Google/LocationIQ) without exposing a key.
 *   - Permission-gated so it isn't an open geocoding proxy.
 *
 * GET /api/geocode?q=<query> → GeoResult[] (max 5), biased to Thailand.
 * Reuses requirePermission('settings.branch.manage') — same gate as branch
 * CRUD; unauthorized callers get the opaque notFound() (404).
 */
export async function GET(req: NextRequest) {
  await requirePermission('settings.branch.manage');

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json([]);

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'th'); // Thai-only HR app — bias results
  url.searchParams.set('accept-language', 'th');

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'koolman-hr/1.0 (admin branch geocoding)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'geocode_failed' }, { status: 502 });
    }
    const results = parseNominatimResults(await res.json());
    return NextResponse.json(results);
  } catch {
    // Network error / timeout / bad JSON — surface as a clean failure.
    return NextResponse.json({ error: 'geocode_failed' }, { status: 502 });
  }
}
