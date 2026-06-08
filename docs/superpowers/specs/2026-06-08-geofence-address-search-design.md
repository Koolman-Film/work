# Geofence picker — address search (Nominatim geocoding)

**Date:** 2026-06-08
**Status:** Design — approved, pending spec review
**Author:** brainstormed with Vivatchai Kaveeta

## Summary

Add an address/place **search box** to the branch geofence picker
(`src/components/map/geofence-picker.tsx`). The admin types a place name or
address, presses Enter (or clicks 🔍), picks from a dropdown of matches, and
the map jumps to that location while the latitude/longitude fields fill in.

This is **geocoding** — turning text into coordinates — so unlike the existing
list search (which queries our own DB), it requires an external service. We use
**Nominatim** (OpenStreetMap's geocoder: free, no API key, natural pairing with
the OSM tiles the picker already renders), called through a thin Next.js
**Route Handler** proxy.

The selected coordinates flow into the picker's existing `syncFromMap(lat, lng)`
function — the same path used by click, drag, and typed coordinates — so the
"jump the map + update lat/long" behavior is already built. This feature only
adds the search box and the geocode call.

## Goals

- Let an admin locate a branch by **searching an address/place name**, not only
  by clicking the map or typing raw coordinates.
- Show a **dropdown of matches** so ambiguous queries (several "Central" malls)
  resolve to the right place; clicking one jumps the map and fills lat/long.
- Keep the geocoding provider/key **server-side** behind a permission gate.
- Reuse the existing two-way sync (`syncFromMap`) so address search needs no new
  pin/field-update logic.

## Non-goals

- No per-keystroke autocomplete (Nominatim's policy discourages it; search is
  submit-on-Enter, matching the employee-list search pattern).
- No reverse geocoding (coordinates → address) — out of scope.
- No external search service (Algolia/Elastic) and no keyed provider now;
  Nominatim is free and sufficient at admin/low-volume scale.
- No change to the LIFF/employee side — this is the admin branch-setup tool only.

## Key decisions

1. **Nominatim via a server-side Route Handler proxy** (not a direct browser
   call). Reasons: (a) Nominatim's usage policy asks for an identifying
   `User-Agent`, which a browser can't set; (b) proxying keeps the door open to
   swap in a keyed provider (Google) later **without exposing a key**; (c) we
   can gate the endpoint by permission so it isn't an open geocoding proxy. The
   proxy is ~25 lines.

2. **Dropdown of matches, click to select** (not auto-jump to the top hit).
   Nominatim frequently returns several candidates; letting the admin choose
   avoids silently landing on the wrong "Central". (Decided with user.)

3. **Selection feeds the existing `syncFromMap`.** `onSelect(lat, lng)` →
   `syncFromMap(lat, lng)` (moves pin + writes the lat/long draft fields) +
   `mapRef.current.setView([lat, lng], 16)`. No new pin/field code.

4. **Extract a pure parser** `parseNominatimResults(raw)` (mirrors the
   `parse-coord.ts` pattern). All the branchy logic (shape-mapping, dropping
   malformed/out-of-range entries) lives in a pure, unit-testable function; the
   Route Handler stays a thin fetch + parse + JSON wrapper.

5. **Permission-gate the endpoint** with the existing
   `requirePermission('settings.branch.manage')` — the same gate as branch CRUD.
   The picker only renders inside the authenticated admin branch form, so the
   opaque `notFound()` rejection (→ HTTP 404) is acceptable; the client treats
   any non-200 as a failed search.

6. **Thailand-biased results.** Pass `countrycodes=th` and `accept-language=th`
   to Nominatim. Correct for a Thai-only HR app; trivially removed if foreign
   branches ever appear. Jump zoom is **16** (street level, matches the picker's
   existing initial zoom when a pin is set).

7. **Search must not submit the branch form.** The picker renders inside the
   branch `<form action={…}>`. The search uses a `type="button"` trigger and an
   `onKeyDown` that calls `preventDefault()` on Enter before firing the search —
   no nested `<form>` (invalid HTML inside a form), no accidental branch save.

## Architecture

### Data flow

```
GeofenceSearch ('use client')
  type query → Enter / click 🔍   (onKeyDown preventDefault — no form submit)
     │
     ▼  fetch GET /api/geocode?q=<query>
  ┌──────────────────────────────────────────────────────────────┐
  │ app/api/geocode/route.ts (server)                             │
  │   requirePermission('settings.branch.manage')                 │
  │   fetch https://nominatim.openstreetmap.org/search            │
  │     ?q=…&format=jsonv2&addressdetails=0&limit=5               │
  │     &countrycodes=th&accept-language=th                       │
  │     headers: { 'User-Agent': 'koolman-hr/1.0 (admin geocode)'}│
  │   parseNominatimResults(json) → GeoResult[]                   │
  │   NextResponse.json(results)                                  │
  └──────────────────────────────────────────────────────────────┘
     │
     ▼  GeoResult[] = [{ displayName, lat, lng }]
  render dropdown (≤5)
     │  click a match
     ▼  onSelect(lat, lng)
  geofence-picker.tsx
     syncFromMap(lat, lng)          ← existing: pin moves + lat/long fields fill
     mapRef.current.setView([lat,lng], 16)
```

### Component / module responsibilities

- **`src/lib/geo/nominatim.ts`** *(new)* — pure, no React/Next imports.
  ```ts
  export type GeoResult = { displayName: string; lat: number; lng: number };

  // Maps Nominatim's raw rows → trimmed GeoResult[]; drops entries whose
  // lat/lon are missing, non-finite, or out of range. Non-array input → [].
  export function parseNominatimResults(raw: unknown): GeoResult[];
  ```
  Bounds reuse the same lat ∈ [−90,90] / lng ∈ [−180,180] sanity checks as
  `parse-coord.ts`.

- **`src/app/api/geocode/route.ts`** *(new)* — `export async function GET(req)`.
  - `requirePermission('settings.branch.manage')` first.
  - Read `q` from `req.nextUrl.searchParams`; if empty/blank → `NextResponse.json([])`.
  - Fetch Nominatim (URL + params + `User-Agent` as above). Use `limit=5`.
  - On a non-OK upstream response or a thrown fetch error → `NextResponse.json({ error: 'geocode_failed' }, { status: 502 })`.
  - On success → `parseNominatimResults(await res.json())` → `NextResponse.json(results)`.
  - `export const runtime = 'nodejs'` (default) — needs the auth/session +
    outbound fetch; no edge requirement.

- **`src/components/map/geofence-search.tsx`** *(new, `'use client'`)* —
  - Props: `{ onSelect: (lat: number, lng: number) => void }`.
  - State: `query` (string), `status` (`'idle' | 'loading' | 'error'`),
    `results` (`GeoResult[]`), `open` (dropdown visibility).
  - `runSearch()`: trims `query`; if empty, no-op. Sets `loading`, `fetch('/api/geocode?q=' + encodeURIComponent(q))`; on ok → `results = await res.json()`, `open = true`, `status='idle'`; on non-ok/throw → `status='error'`.
  - Input: `type="text"`, `onKeyDown` → if `Enter`: `e.preventDefault()` then `runSearch()`. A sibling `type="button"` 🔍 also calls `runSearch()`.
  - Dropdown: lists up to 5 `displayName`s as buttons; click → `onSelect(r.lat, r.lng)`, then `open=false` (query text preserved). Empty results → "ไม่พบสถานที่". `status==='error'` → "ค้นหาไม่สำเร็จ ลองอีกครั้ง". Closes on Escape and outside-click (a `useEffect` pointerdown listener + ref).

- **`src/components/map/geofence-picker.tsx`** *(modify)* — render
  `<GeofenceSearch onSelect={handleGeocodeSelect} />` directly **above** the map
  div. `handleGeocodeSelect = useCallback((la, lo) => { syncFromMap(la, lo);
  mapRef.current?.setView([la, lo], 16); }, [syncFromMap])`. No other changes;
  `syncFromMap` already moves the pin and writes the lat/long fields.

### Layout

```
[ 🔍  ค้นหาสถานที่/ที่อยู่… ]            ← GeofenceSearch (input + button + dropdown)
[ Leaflet map — h-72 ]
[ ละติจูด ] [ ลองติจูด ]                  ← existing synced fields
[ helper text · ล้างพิกัด ]
```
The dropdown overlays below the input (absolute-positioned) so it doesn't shift
the map.

## Error handling & edge cases

- **Empty/blank query** → no fetch; dropdown stays closed.
- **No matches** → dropdown shows "ไม่พบสถานที่".
- **Upstream/network failure** → endpoint returns 502; client shows
  "ค้นหาไม่สำเร็จ ลองอีกครั้ง" and does not crash or move the map.
- **Unauthorized caller** → `requirePermission` rejects (404); client treats it
  as a failed search. (Not reachable in normal use — picker is behind admin auth.)
- **Malformed Nominatim rows** (missing/NaN lat/lon) → dropped by
  `parseNominatimResults`; never reach the dropdown or the map.
- **Rate limiting** → submit-on-Enter (not per keystroke) stays within
  Nominatim's ~1 req/s policy; no debounce needed.
- **Selecting a result** → map jumps + lat/long fill; the typed query text stays
  so the admin can refine and search again.

## Testing

- **Unit — `parseNominatimResults`** (pure, fast): a valid multi-row response →
  trimmed `GeoResult[]`; empty array → `[]`; non-array / null input → `[]`; rows
  with missing or non-numeric `lat`/`lon` dropped; out-of-range coordinate
  dropped; `display_name` mapped to `displayName`.
- **E2E — `tests/e2e/admin-branch-geocode.spec.ts`** with Playwright
  `page.route('**/api/geocode*', route => route.fulfill({ json: [...] }))` so the
  test is deterministic and never hits the live service: type a query → press
  Enter → stubbed dropdown appears → click a match → assert the ละติจูด/ลองติจูด
  fields now hold the selected coordinates (and, best-effort, that the map state
  updated). Also a stub returning `[]` → asserts the "ไม่พบสถานที่" empty state.
- **Not tested live:** the real Nominatim call (external, rate-limited, flaky) —
  deliberately stubbed. The Route Handler stays thin so the untested surface is
  minimal; its only logic (`parseNominatimResults`) is unit-tested directly.

## Out of scope / future

- Keyed provider (Google/LocationIQ) for Thai street-number precision — clean
  upgrade later: swap the fetch inside the Route Handler, keep the key in env,
  client unchanged.
- Reverse geocoding (show the address of a dropped pin).
- Type-ahead autocomplete (would need Photon/Komoot or a keyed provider +
  debounce; intentionally deferred).
- Recent/saved searches.
