# Geofence picker — address search (Nominatim) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an address/place search box to the branch geofence picker — type a query, pick a match from a dropdown, and the map jumps there while the latitude/longitude fields fill in.

**Architecture:** A pure `parseNominatimResults` helper turns Nominatim's raw response into a trimmed `GeoResult[]`. A thin, permission-gated Next.js Route Handler (`/api/geocode`) proxies the request to Nominatim (keeps the provider server-side, sets the required User-Agent, biases to Thailand). A client `GeofenceSearch` component does the fetch + dropdown and calls `onSelect(lat, lng)`, which the picker feeds into its existing `syncFromMap` (pin + fields) plus `map.setView`.

**Tech Stack:** Next.js 16 App Router (Route Handler + Client Component), React `useState`/`useEffect`/`useRef`, Leaflet, Nominatim (OpenStreetMap geocoding), Vitest (unit), Playwright (E2E, stubbed), Biome, pnpm.

**Spec:** [docs/superpowers/specs/2026-06-08-geofence-address-search-design.md](../specs/2026-06-08-geofence-address-search-design.md)

---

## Environment note (read once)

Prepend Homebrew's node to PATH in **every** command (this repo needs Node ≥24; the machine default is v22):

```bash
export PATH="/opt/homebrew/bin:$PATH"
node --version   # expect v24+ (e.g. v26.x)
```

This worktree already has `node_modules` and a copied `.env.local` (local Supabase) from prior work. Task 0 verifies this. The pre-commit hook runs `pnpm lint-staged` → `biome check --write` on staged `*.{ts,tsx,js,mjs,json}`.

---

## File structure

- **Create** `src/lib/geo/nominatim.ts` — pure `parseNominatimResults(raw): GeoResult[]` + `GeoResult` type. No React/Next imports.
- **Create** `src/lib/geo/nominatim.test.ts` — Vitest unit tests for the helper.
- **Create** `src/app/api/geocode/route.ts` — permission-gated `GET` proxy to Nominatim; thin (fetch + parse + JSON).
- **Create** `src/components/map/geofence-search.tsx` — `'use client'` search box + dropdown; `onSelect(lat,lng)` prop.
- **Modify** `src/components/map/geofence-picker.tsx` — render `<GeofenceSearch>` above the map; wire `onSelect` → `syncFromMap` + `setView`.
- **Create** `tests/e2e/admin-branch-geocode.spec.ts` — Playwright E2E with a **stubbed** `/api/geocode` (no live Nominatim).

---

## Task 0: Verify the worktree environment

**Files:** none (environment only)

- [ ] **Step 1: Confirm deps + node**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
node --version && pnpm exec vitest --version && test -f .env.local && echo ".env.local present" || echo "MISSING .env.local"
```
Expected: node v24+, a vitest version prints, and `.env.local present`. If `.env.local` is missing, copy it: `cp /Users/tong/Works/fai/koolman_hr/.env.local .env.local` (local Supabase; gitignored).

---

## Task 1: `parseNominatimResults` pure helper (TDD)

**Files:**
- Create: `src/lib/geo/nominatim.ts`
- Test: `src/lib/geo/nominatim.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/geo/nominatim.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseNominatimResults } from './nominatim';

describe('parseNominatimResults', () => {
  it('maps valid Nominatim rows to GeoResult[]', () => {
    const raw = [
      { display_name: 'CentralWorld, Bangkok', lat: '13.7466', lon: '100.5396' },
      { display_name: 'Central Rama 9', lat: '13.758', lon: '100.565' },
    ];
    expect(parseNominatimResults(raw)).toEqual([
      { displayName: 'CentralWorld, Bangkok', lat: 13.7466, lng: 100.5396 },
      { displayName: 'Central Rama 9', lat: 13.758, lng: 100.565 },
    ]);
  });

  it('returns [] for non-array input', () => {
    expect(parseNominatimResults(null)).toEqual([]);
    expect(parseNominatimResults({})).toEqual([]);
    expect(parseNominatimResults('nope')).toEqual([]);
  });

  it('returns [] for an empty array', () => {
    expect(parseNominatimResults([])).toEqual([]);
  });

  it('drops rows missing display_name', () => {
    expect(parseNominatimResults([{ lat: '13.7', lon: '100.5' }])).toEqual([]);
  });

  it('drops rows with non-numeric or out-of-range coordinates', () => {
    const raw = [
      { display_name: 'bad lat', lat: 'abc', lon: '100.5' },
      { display_name: 'lat out of range', lat: '95', lon: '100.5' },
      { display_name: 'lng out of range', lat: '13.7', lon: '200' },
      { display_name: 'ok', lat: '13.7', lon: '100.5' },
    ];
    expect(parseNominatimResults(raw)).toEqual([{ displayName: 'ok', lat: 13.7, lng: 100.5 }]);
  });

  it('ignores non-object entries', () => {
    const raw = [null, 42, 'str', { display_name: 'ok', lat: '1', lon: '2' }];
    expect(parseNominatimResults(raw)).toEqual([{ displayName: 'ok', lat: 1, lng: 2 }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm test src/lib/geo/nominatim.test.ts
```
Expected: FAIL — `Failed to resolve import "./nominatim"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/geo/nominatim.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm test src/lib/geo/nominatim.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add src/lib/geo/nominatim.ts src/lib/geo/nominatim.test.ts
git commit -m "feat(geocode): pure parseNominatimResults helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: commit succeeds; Biome runs clean on the staged files.

---

## Task 2: `/api/geocode` Route Handler (Nominatim proxy)

**Files:**
- Create: `src/app/api/geocode/route.ts`

> No unit test: importing the handler pulls in `@/lib/supabase/server` (`next/headers` `cookies()`), which isn't available under plain Vitest, and the only real logic (`parseNominatimResults`) is already unit-tested. Verification here is typecheck + lint; the client wiring is covered by the stubbed E2E (Task 5), and the live call by the manual smoke (Task 6).

- [ ] **Step 1: Write the route handler**

Create `src/app/api/geocode/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
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
```

- [ ] **Step 2: Typecheck**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Lint the new file**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm exec biome check src/app/api/geocode/route.ts
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add src/app/api/geocode/route.ts
git commit -m "feat(geocode): permission-gated Nominatim proxy route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `GeofenceSearch` client component

**Files:**
- Create: `src/components/map/geofence-search.tsx`

> Verification is typecheck + lint here; the component's behavior is exercised end-to-end by the stubbed E2E in Task 5 (after it's wired in Task 4).

- [ ] **Step 1: Write the component**

Create `src/components/map/geofence-search.tsx`:

```tsx
'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { GeoResult } from '@/lib/geo/nominatim';

/**
 * Address/place search for the geofence picker.
 *
 * Type a query → Enter or click ค้นหา → fetch /api/geocode (server proxy to
 * Nominatim) → dropdown of matches → click one → onSelect(lat, lng). The
 * parent picker feeds onSelect into its existing syncFromMap + map.setView.
 *
 * IMPORTANT: this renders inside the branch <form>. Pressing Enter must NOT
 * submit that form, so the input intercepts Enter with preventDefault and the
 * trigger is a type="button" (never a submit).
 */

type Props = {
  /** Called when the admin picks a match — feeds the picker's syncFromMap. */
  onSelect: (lat: number, lng: number) => void;
};

type Status = 'idle' | 'loading' | 'error';

export function GeofenceSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setStatus('loading');
    setOpen(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        setResults([]);
        setStatus('error');
        return;
      }
      setResults((await res.json()) as GeoResult[]);
      setStatus('idle');
    } catch {
      setResults([]);
      setStatus('error');
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault(); // don't submit the surrounding branch <form>
      runSearch();
    }
  }

  function handlePick(r: GeoResult) {
    onSelect(r.lat, r.lng);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="ค้นหาสถานที่ / ที่อยู่ แล้วกด Enter"
          aria-label="ค้นหาสถานที่เพื่อปักหมุด"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={status === 'loading'}
          className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {status === 'loading' ? 'กำลังค้นหา…' : 'ค้นหา'}
        </button>
      </div>

      {open && (
        <div className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
          {status === 'error' ? (
            <p className="px-3 py-2 text-xs text-red-600">ค้นหาไม่สำเร็จ ลองอีกครั้ง</p>
          ) : status === 'loading' ? (
            <p className="px-3 py-2 text-xs text-gray-500">กำลังค้นหา…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">ไม่พบสถานที่</p>
          ) : (
            <ul className="max-h-60 overflow-auto">
              {results.map((r, i) => (
                <li key={`${r.lat},${r.lng},${i}`}>
                  <button
                    type="button"
                    onClick={() => handlePick(r)}
                    className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                  >
                    {r.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm typecheck && pnpm exec biome check src/components/map/geofence-search.tsx
```
Expected: PASS, no Biome errors. (If Biome reflows JSX/formatting, run `pnpm exec biome check --write src/components/map/geofence-search.tsx` and re-check.)

- [ ] **Step 3: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add src/components/map/geofence-search.tsx
git commit -m "feat(geocode): GeofenceSearch box + matches dropdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire `GeofenceSearch` into the picker

**Files:**
- Modify: `src/components/map/geofence-picker.tsx`

- [ ] **Step 1: Import the search component**

In `src/components/map/geofence-picker.tsx`, add the import after the existing `Input` import (line 6):

```tsx
import { GeofenceSearch } from './geofence-search';
```

- [ ] **Step 2: Add the select handler**

In `geofence-picker.tsx`, immediately AFTER the `syncFromMap` `useCallback` block (ends at line 77, `}, []);`), add:

```tsx
  // Address search → same path as click/drag/typed coords: move the pin + fill
  // the fields, then recenter the map on the chosen place.
  const handleGeocodeSelect = useCallback(
    (la: number, lo: number) => {
      syncFromMap(la, lo);
      mapRef.current?.setView([la, lo], 16);
    },
    [syncFromMap],
  );
```

- [ ] **Step 3: Render the search box above the map**

In `geofence-picker.tsx`, the return currently opens:

```tsx
  return (
    <div className="space-y-3">
      {/* role="application" is the conventional role for an interactive
```

Insert the search box as the first child, so it becomes:

```tsx
  return (
    <div className="space-y-3">
      {/* Address search — jumps the map + fills lat/long via syncFromMap. */}
      <GeofenceSearch onSelect={handleGeocodeSelect} />

      {/* role="application" is the conventional role for an interactive
```

- [ ] **Step 4: Typecheck + lint**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm typecheck && pnpm exec biome check src/components/map/geofence-picker.tsx
```
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add src/components/map/geofence-picker.tsx
git commit -m "feat(geocode): wire address search into geofence picker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: E2E — stubbed geocode, pick a match, fields fill

**Files:**
- Create: `tests/e2e/admin-branch-geocode.spec.ts`

> **Prerequisite:** `.env.local` present (Task 0) + the dev DB seeded with `admin@koolman.local`. Playwright auto-starts `pnpm dev`. The geocode endpoint is **stubbed** via `page.route`, so no live Nominatim call and no external dependency.

- [ ] **Step 1: Write the E2E spec**

Create `tests/e2e/admin-branch-geocode.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords } from './helpers/db';

/**
 * Geofence address search (Nominatim) — wiring test.
 *
 * /api/geocode is STUBBED (no live Nominatim) so the test is deterministic and
 * never depends on an external service. Asserts: search → dropdown → pick →
 * the ละติจูด/ลองติจูด fields fill (proving onSelect → syncFromMap), and the
 * empty-results state.
 */

test.afterAll(async () => {
  await cleanupE2eRecords();
});

test.describe('Branch geofence address search', () => {
  test('search → pick a match → lat/long fields fill', async ({ page }) => {
    await page.route('**/api/geocode*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { displayName: 'CentralWorld, Bangkok', lat: 13.7466, lng: 100.5396 },
          { displayName: 'Central Rama 9, Bangkok', lat: 13.758, lng: 100.565 },
        ]),
      }),
    );

    await loginAsAdmin(page);
    await page.goto('/admin/settings/branches/new');

    const search = page.getByLabel('ค้นหาสถานที่เพื่อปักหมุด');
    await search.fill('central');
    await search.press('Enter');

    // Dropdown shows the stubbed matches; pick the first.
    await page.getByRole('button', { name: /CentralWorld/ }).click();

    // onSelect → syncFromMap filled the fields (formatted to 6 dp).
    await expect(page.getByLabel(/ละติจูด/)).toHaveValue('13.746600');
    await expect(page.getByLabel(/ลองติจูด/)).toHaveValue('100.539600');
  });

  test('no matches shows an empty state', async ({ page }) => {
    await page.route('**/api/geocode*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await loginAsAdmin(page);
    await page.goto('/admin/settings/branches/new');

    const search = page.getByLabel('ค้นหาสถานที่เพื่อปักหมุด');
    await search.fill('zzz nowhere place');
    await search.press('Enter');

    await expect(page.getByText('ไม่พบสถานที่')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E spec**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm test:e2e admin-branch-geocode --project=chromium
```
Expected: 2 passed. If the first test fails on the value assertion, confirm the picker's `handleGeocodeSelect` calls `syncFromMap` (which formats via `toFixed(6)`), and that the stub `body` uses the `{ displayName, lat, lng }` shape the client expects.

- [ ] **Step 3: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add tests/e2e/admin-branch-geocode.spec.ts
git commit -m "test(e2e): geofence address search picks a match + fills fields

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm test
```
Expected: all green, including the new `nominatim.test.ts` (6 tests).

- [ ] **Step 2: Typecheck + lint whole project**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm typecheck && pnpm lint
```
Expected: typecheck PASS; Biome reports no NEW errors in the files this plan created/modified (pre-existing warnings in unrelated seed files are fine).

- [ ] **Step 3: Manual smoke (recommended — exercises the REAL Nominatim call)**

Run `pnpm dev`, open `/admin/settings/branches/new`, and verify:
- Type a real place (e.g. `เซ็นทรัลเวิลด์` or `สยามพารากอน`), press Enter → a dropdown of matches appears.
- Click a match → the map jumps there, the pin drops, and ละติจูด/ลองติจูด fill in.
- The dropdown overlays the map (not hidden behind it). If it's clipped behind the map, bump the dropdown's `z-[1000]` higher.
- Pressing Enter in the search box does **not** save/submit the branch form.
- A nonsense query shows "ไม่พบสถานที่".

- [ ] **Step 4: Confirm branch state**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
git log --oneline -6
git status
```
Expected: five feature/test commits on top of the spec commit; clean working tree (ignore an auto-regenerated `next-env.d.ts` — `git checkout next-env.d.ts` to revert if it appears).

---

## Self-review notes (author)

- **Spec coverage:** Nominatim via server proxy (Task 2) ✓; dropdown-of-matches + click (Task 3) ✓; selection → existing `syncFromMap` + `setView(16)` (Task 4) ✓; pure `parseNominatimResults` + bounds (Task 1) ✓; permission gate `settings.branch.manage` (Task 2) ✓; Thailand bias `countrycodes=th` (Task 2) ✓; Enter doesn't submit the branch form (Task 3 `preventDefault` + `type="button"`) ✓; error/empty/loading states (Task 3) ✓; unit + stubbed E2E (Tasks 1, 5) ✓; live call left to manual smoke (Task 6) ✓.
- **Type consistency:** `GeoResult { displayName; lat; lng }` defined in Task 1, consumed in Tasks 2/3/5; `parseNominatimResults(raw: unknown): GeoResult[]`, `onSelect(lat, lng)`, and `handleGeocodeSelect(la, lo)` signatures line up across tasks; the E2E stub body uses the `{ displayName, lat, lng }` shape the client parses.
- **Edge cases:** empty query → no fetch / `[]`; non-200 → error state; malformed rows dropped by the pure parser; submit-on-Enter keeps within Nominatim's ~1 req/s policy; 5s fetch timeout → clean 502.
