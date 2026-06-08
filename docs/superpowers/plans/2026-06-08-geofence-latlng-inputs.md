# Geofence picker — editable lat/long fields with two-way map sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin set a branch's GPS coordinates by typing latitude/longitude into fields below the map, kept in two-way sync with the draggable map pin.

**Architecture:** A new pure helper `parseCoordInput` turns free-typed text into a bounded number (or null). The existing `GeofencePicker` Client Component gains a draft-string layer over its numeric `lat`/`lng` state: typing a valid value commits to the numeric state (which moves the pin via the existing reflection effect), and clicking/dragging the pin writes back into the text fields. The visible inputs carry the form's `latitude`/`longitude` names, so submission is WYSIWYG and the server action is unchanged.

**Tech Stack:** Next.js (App Router) Client Component, React `useState`/`useEffect`/`useCallback`, Leaflet, Vitest (unit), Playwright (E2E), Biome (lint/format), pnpm.

**Spec:** [docs/superpowers/specs/2026-06-08-geofence-latlng-inputs-design.md](../specs/2026-06-08-geofence-latlng-inputs-design.md)

---

## Environment note (read once)

This is a fresh git worktree. The default `node` on PATH is v22, but this repo's
`engines.node` requires `>=24`. **Every** `pnpm`/`node`/`git commit` command below
assumes you have prepended Homebrew's bin to PATH for the shell:

```bash
export PATH="/opt/homebrew/bin:$PATH"   # node 24+/26; pnpm available
node --version                          # expect v24+ (e.g. v26.x)
```

The pre-commit hook runs `pnpm lint-staged` → `biome check --write` on staged
`*.{ts,tsx,js,mjs,json}`. It needs `node_modules` installed (Task 0), or commits fail.

---

## File structure

- **Create** `src/components/map/parse-coord.ts` — pure parse+bounds helper. No React/Leaflet imports. Single responsibility: text → `{ ok, value }`.
- **Create** `src/components/map/parse-coord.test.ts` — Vitest unit tests for the helper.
- **Modify** `src/components/map/geofence-picker.tsx` — add draft-string state, editable inputs, two-way sync, and pin-removal-on-null in the reflection effect.
- **Modify** `src/app/(admin)/admin/settings/branches/branch-form.tsx` — update one hint string to mention typing (minor copy).
- **Create** `tests/e2e/admin-branch-geofence.spec.ts` — E2E: type coordinates → persist; out-of-range → server rejects.

No changes to `actions.ts` (the Zod `coordSchema` already parses + bounds-checks the submitted strings).

---

## Task 0: Install dependencies in the worktree

**Files:** none (environment only)

- [ ] **Step 1: Install deps**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm install
```
Expected: completes; `node_modules/.bin/vitest`, `node_modules/.bin/biome`, and `node_modules/.bin/lint-staged` now exist. (`postinstall` runs `prisma generate`; that's fine.)

- [ ] **Step 2: Sanity-check the test runner**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm test src/lib/attendance/haversine.test.ts
```
Expected: PASS (an existing pure-module test) — confirms Vitest works in this worktree before you write new tests.

---

## Task 1: `parseCoordInput` pure helper (TDD)

**Files:**
- Create: `src/components/map/parse-coord.ts`
- Test: `src/components/map/parse-coord.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/map/parse-coord.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCoordInput } from './parse-coord';

describe('parseCoordInput', () => {
  it('treats empty / whitespace as a cleared coordinate (null)', () => {
    expect(parseCoordInput('', 'lat')).toEqual({ ok: true, value: null });
    expect(parseCoordInput('   ', 'lng')).toEqual({ ok: true, value: null });
  });

  it('parses valid in-range numbers', () => {
    expect(parseCoordInput('13.7563', 'lat')).toEqual({ ok: true, value: 13.7563 });
    expect(parseCoordInput('100.5018', 'lng')).toEqual({ ok: true, value: 100.5018 });
    expect(parseCoordInput('-13.5', 'lat')).toEqual({ ok: true, value: -13.5 });
  });

  it('accepts a trailing-dot partial as the parsed integer', () => {
    expect(parseCoordInput('13.', 'lat')).toEqual({ ok: true, value: 13 });
  });

  it('rejects a lone minus sign (not yet a number)', () => {
    expect(parseCoordInput('-', 'lat')).toEqual({ ok: false });
  });

  it('rejects non-numeric garbage', () => {
    expect(parseCoordInput('abc', 'lat')).toEqual({ ok: false });
    expect(parseCoordInput('13abc', 'lng')).toEqual({ ok: false });
  });

  it('enforces latitude bounds [-90, 90]', () => {
    expect(parseCoordInput('90', 'lat')).toEqual({ ok: true, value: 90 });
    expect(parseCoordInput('-90', 'lat')).toEqual({ ok: true, value: -90 });
    expect(parseCoordInput('90.0001', 'lat')).toEqual({ ok: false });
    expect(parseCoordInput('91', 'lat')).toEqual({ ok: false });
  });

  it('enforces longitude bounds [-180, 180]', () => {
    expect(parseCoordInput('180', 'lng')).toEqual({ ok: true, value: 180 });
    expect(parseCoordInput('-180', 'lng')).toEqual({ ok: true, value: -180 });
    expect(parseCoordInput('181', 'lng')).toEqual({ ok: false });
  });

  it('applies the correct bound per kind (120 is a valid lng but not a valid lat)', () => {
    expect(parseCoordInput('120', 'lat')).toEqual({ ok: false });
    expect(parseCoordInput('120', 'lng')).toEqual({ ok: true, value: 120 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm test src/components/map/parse-coord.test.ts
```
Expected: FAIL — `Failed to resolve import "./parse-coord"` (file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/map/parse-coord.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm test src/components/map/parse-coord.test.ts
```
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add src/components/map/parse-coord.ts src/components/map/parse-coord.test.ts
git commit -m "feat(geofence): pure parseCoordInput helper with bounds checks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: commit succeeds; the pre-commit hook runs Biome on the two staged files with no errors.

---

## Task 2: Editable lat/long fields + two-way sync in `GeofencePicker`

**Files:**
- Modify: `src/components/map/geofence-picker.tsx` (replace the whole file)
- Modify: `src/app/(admin)/admin/settings/branches/branch-form.tsx:88-89` (hint copy)

> No unit test here: this worktree has no React component test harness (only
> Vitest for pure modules + Playwright for E2E). The behavior is pinned by the
> E2E test in Task 3. Verification in this task is typecheck + lint.

- [ ] **Step 1: Replace `geofence-picker.tsx` with the synced version**

Overwrite `src/components/map/geofence-picker.tsx` with:

```tsx
'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { parseCoordInput } from './parse-coord';

/**
 * Leaflet + OpenStreetMap geofence picker.
 *
 * Lets admin set a branch's lat/lng three ways — click the map, drag the pin,
 * or type into the latitude/longitude fields — all kept in two-way sync. A
 * circle previews the geofence radius. The visible lat/lng inputs carry the
 * form's `latitude` / `longitude` names, so what the admin sees is exactly
 * what the Server Action receives (WYSIWYG; no hidden inputs).
 *
 * Why Client Component:
 *   - Leaflet touches `window` at module top; can't render on the server.
 *   - The parent form uses dynamic({ssr: false}) to import this so the
 *     bundle stays out of SSR entirely.
 *
 * Why we set up the marker icon URLs manually:
 *   - Leaflet ships PNG icons that resolve via relative paths in
 *     /node_modules/leaflet/dist/images. Webpack/Turbopack don't preserve
 *     those URLs by default. Workaround: explicit CDN URLs (smallest blast
 *     radius — no asset-copying step in the build).
 */

type Props = {
  /** Initial pin position. If null, the map starts centered on Bangkok zoomed out. */
  initialLat: number | null;
  initialLng: number | null;
  /** Geofence radius in meters — used for the preview circle (re-read from input on change). */
  initialRadiusMeters: number;
  /** Names of the form inputs we submit (and keep in sync with the pin). */
  latInputName: string;
  lngInputName: string;
};

// Bangkok city center — sensible default when admin hasn't picked yet
const BANGKOK = { lat: 13.7563, lng: 100.5018 };

/** Format a numeric coordinate for the text fields (6 dp matches old display). */
function fmt(n: number): string {
  return n.toFixed(6);
}

export function GeofencePicker({
  initialLat,
  initialLng,
  initialRadiusMeters,
  latInputName,
  lngInputName,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  const [lat, setLat] = useState<number | null>(initialLat);
  const [lng, setLng] = useState<number | null>(initialLng);
  const [radius, setRadius] = useState<number>(initialRadiusMeters);

  // Draft strings backing the two text inputs. Kept separate from the numeric
  // lat/lng so partial input ("13.", "-", "") doesn't corrupt the map state.
  const [latText, setLatText] = useState<string>(initialLat != null ? fmt(initialLat) : '');
  const [lngText, setLngText] = useState<string>(initialLng != null ? fmt(initialLng) : '');

  // Pin → fields: set numeric state AND the text drafts together. Stable
  // identity (state setters are stable) so the init-only effect can capture it.
  const syncFromMap = useCallback((la: number, lo: number) => {
    setLat(la);
    setLng(lo);
    setLatText(fmt(la));
    setLngText(fmt(lo));
  }, []);

  // Watch the radiusMeters input in the parent form so the preview
  // circle resizes as admin tweaks the number.
  useEffect(() => {
    const radiusInput = document.querySelector<HTMLInputElement>('input[name="radiusMeters"]');
    if (!radiusInput) return;
    const onInput = () => {
      const n = Number(radiusInput.value);
      if (Number.isFinite(n) && n > 0) setRadius(n);
    };
    radiusInput.addEventListener('input', onInput);
    return () => radiusInput.removeEventListener('input', onInput);
  }, []);

  // Initialize the map exactly once — initial lat/lng/radius read on mount;
  // subsequent changes flow through the reflection effect below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: init-only effect by design
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Fix marker icon paths (see comment above)
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    const start = lat != null && lng != null ? { lat, lng } : BANGKOK;
    const zoom = lat != null && lng != null ? 16 : 11;

    const map = L.map(containerRef.current).setView([start.lat, start.lng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    // Initial marker + circle (only if we have a position)
    if (lat != null && lng != null) {
      markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(map);
      circleRef.current = L.circle([lat, lng], {
        radius,
        color: '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: 0.12,
        weight: 2,
      }).addTo(map);

      markerRef.current.on('dragend', () => {
        const pos = markerRef.current!.getLatLng();
        syncFromMap(pos.lat, pos.lng);
      });
    }

    // Click anywhere to set / move the pin
    map.on('click', (e: L.LeafletMouseEvent) => {
      syncFromMap(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, []);

  // Reflect lat/lng state onto the map. Removes the pin when either coordinate
  // is null (admin emptied a field or hit ล้างพิกัด); otherwise creates/moves
  // the marker + circle.
  useEffect(() => {
    if (!mapRef.current) return;

    if (lat == null || lng == null) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (circleRef.current) {
        circleRef.current.remove();
        circleRef.current = null;
      }
      return;
    }

    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
      markerRef.current.on('dragend', () => {
        const pos = markerRef.current!.getLatLng();
        syncFromMap(pos.lat, pos.lng);
      });
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }

    if (!circleRef.current) {
      circleRef.current = L.circle([lat, lng], {
        radius,
        color: '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: 0.12,
        weight: 2,
      }).addTo(mapRef.current);
    } else {
      circleRef.current.setLatLng([lat, lng]);
      circleRef.current.setRadius(radius);
    }
  }, [lat, lng, radius, syncFromMap]);

  // Fields → map: update the draft, and commit to numeric state on a valid parse.
  const onLatChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setLatText(text);
    const parsed = parseCoordInput(text, 'lat');
    if (parsed.ok) setLat(parsed.value);
  };
  const onLngChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setLngText(text);
    const parsed = parseCoordInput(text, 'lng');
    if (parsed.ok) setLng(parsed.value);
  };

  const latInvalid = !parseCoordInput(latText, 'lat').ok;
  const lngInvalid = !parseCoordInput(lngText, 'lng').ok;
  const hasAnyValue = latText !== '' || lngText !== '';

  const clearAll = () => {
    setLat(null);
    setLng(null);
    setLatText('');
    setLngText('');
    // Marker/circle removal is handled by the reflection effect (lat/lng null).
    if (mapRef.current) {
      mapRef.current.setView([BANGKOK.lat, BANGKOK.lng], 11);
    }
  };

  return (
    <div className="space-y-3">
      {/* role="application" is the conventional role for an interactive
          map container per ARIA APG. Pairs cleanly with aria-label so SR
          users hear "แผนที่สำหรับเลือกตำแหน่งสาขา" on focus. */}
      <div
        ref={containerRef}
        role="application"
        aria-label="แผนที่สำหรับเลือกตำแหน่งสาขา"
        className="h-72 w-full rounded-md border border-gray-200"
      />

      {/* Editable lat/long fields — two-way synced with the pin. These carry
          the form's latitude/longitude names (WYSIWYG submission). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="geofence-lat" className="mb-1 block text-xs font-medium text-gray-600">
            ละติจูด (Latitude)
          </label>
          <Input
            id="geofence-lat"
            name={latInputName}
            type="text"
            inputMode="decimal"
            placeholder="13.756300"
            value={latText}
            onChange={onLatChange}
            aria-invalid={latInvalid || undefined}
            aria-describedby={latInvalid ? 'geofence-lat-error' : undefined}
          />
          {latInvalid && (
            <p id="geofence-lat-error" className="mt-1 text-xs text-red-600">
              ละติจูดต้องเป็นตัวเลขระหว่าง -90 ถึง 90
            </p>
          )}
        </div>

        <div>
          <label htmlFor="geofence-lng" className="mb-1 block text-xs font-medium text-gray-600">
            ลองติจูด (Longitude)
          </label>
          <Input
            id="geofence-lng"
            name={lngInputName}
            type="text"
            inputMode="decimal"
            placeholder="100.501800"
            value={lngText}
            onChange={onLngChange}
            aria-invalid={lngInvalid || undefined}
            aria-describedby={lngInvalid ? 'geofence-lng-error' : undefined}
          />
          {lngInvalid && (
            <p id="geofence-lng-error" className="mt-1 text-xs text-red-600">
              ลองติจูดต้องเป็นตัวเลขระหว่าง -180 ถึง 180
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <p className="text-gray-500">
          คลิกบนแผนที่เพื่อปักหมุด ลากหมุดเพื่อปรับ หรือกรอกพิกัดด้านบน
        </p>
        {hasAnyValue && (
          <button
            type="button"
            onClick={clearAll}
            className="text-primary-600 hover:text-primary-700"
          >
            ล้างพิกัด
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the form-field hint to mention typing**

In `src/app/(admin)/admin/settings/branches/branch-form.tsx`, change the hint on the `<FormField label="ตำแหน่งบนแผนที่" ...>` (around line 89) from:

```tsx
              hint="คลิกเพื่อปักหมุด หรือลากหมุดเพื่อปรับ — ไม่บังคับ (ถ้าไม่ตั้งค่า จะไม่บังคับ geofence)"
```

to:

```tsx
              hint="คลิกเพื่อปักหมุด ลากหมุดเพื่อปรับ หรือกรอกพิกัดด้านล่าง — ไม่บังคับ (ถ้าไม่ตั้งค่า จะไม่บังคับ geofence)"
```

(Leave `htmlFor="latitude"` and the `<GeofencePicker .../>` props unchanged.)

- [ ] **Step 3: Typecheck**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm typecheck
```
Expected: PASS (no errors). If it complains about `ChangeEvent`, confirm the import line reads `import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';`.

- [ ] **Step 4: Lint the changed files**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm exec biome check src/components/map/geofence-picker.tsx 'src/app/(admin)/admin/settings/branches/branch-form.tsx'
```
Expected: no errors (the `biome-ignore` comment on the init effect is preserved).

- [ ] **Step 5: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add src/components/map/geofence-picker.tsx 'src/app/(admin)/admin/settings/branches/branch-form.tsx'
git commit -m "feat(geofence): editable lat/long fields synced two-way with map pin

Type a coordinate and the pin moves live; drag/click the pin and the
fields update. Visible inputs now carry the latitude/longitude form
names (drop the hidden inputs); the reflection effect removes the pin
when a field is emptied.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: commit succeeds; Biome runs clean on staged files.

---

## Task 3: E2E — type coordinates persist, out-of-range rejected

**Files:**
- Create: `tests/e2e/admin-branch-geofence.spec.ts`

> **Prerequisites for running E2E:** a `.env.local` pointing at the dev database,
> which must be seeded with the standard admin (`admin@koolman.local`) — the same
> precondition every existing spec relies on. Playwright auto-starts the app
> (`webServer.command: 'pnpm dev'`, `reuseExistingServer` when not CI), so you
> don't need a server running manually. Branches named `e2e-*` are swept by
> `cleanupE2eRecords()`.

- [ ] **Step 1: Write the E2E spec**

Create `tests/e2e/admin-branch-geofence.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId } from './helpers/db';

/**
 * Geofence picker — editable lat/long fields with two-way map sync.
 *
 * Verifies the admin can set a branch's coordinates by TYPING (not only by
 * clicking the map), that the typed values persist across a save + reload,
 * and that an out-of-range coordinate is rejected by the server's validation.
 *
 * Branch column is Decimal(10,7); the picker formats with toFixed(6), so a
 * value like 13.736700 round-trips to exactly "13.736700".
 */

test.afterAll(async () => {
  await cleanupE2eRecords();
});

test.describe('Branch geofence lat/long fields', () => {
  test('admin can type coordinates and they persist', async ({ page }) => {
    await loginAsAdmin(page);

    const name = `e2e-Branch-Geo-${e2eId()}`;
    await page.goto('/admin/settings/branches/new');

    await page.getByLabel('ชื่อสาขา').fill(name);
    await page.getByLabel(/ละติจูด/).fill('13.736700');
    await page.getByLabel(/ลองติจูด/).fill('100.523200');
    await page.getByRole('button', { name: 'สร้างสาขา' }).click();

    // Back on the list; open the new row's edit page to confirm persistence.
    await page.waitForURL(/\/admin\/settings\/branches$/);
    await expect(page.getByText(name).first()).toBeVisible();

    const editLink = page
      .locator('tr')
      .filter({ hasText: name })
      .getByRole('link', { name: 'แก้ไข' });
    await editLink.click();
    await page.waitForURL(/\/admin\/settings\/branches\/[^/]+\/edit/);

    await expect(page.getByLabel(/ละติจูด/)).toHaveValue('13.736700');
    await expect(page.getByLabel(/ลองติจูด/)).toHaveValue('100.523200');
  });

  test('rejects an out-of-range latitude on submit', async ({ page }) => {
    await loginAsAdmin(page);

    const name = `e2e-Branch-GeoBad-${e2eId()}`;
    await page.goto('/admin/settings/branches/new');

    await page.getByLabel('ชื่อสาขา').fill(name);
    // Client marks it invalid but does NOT block submit (non-blocking
    // validation by design); the server's coordSchema must reject it.
    await page.getByLabel(/ละติจูด/).fill('999');
    await page.getByLabel(/ลองติจูด/).fill('100.5');
    await page.getByRole('button', { name: 'สร้างสาขา' }).click();

    // Server redirects back to the create form with a Thai validation error.
    await page.waitForURL(/\/admin\/settings\/branches\/new\?error=/);
    await expect(page.getByRole('alert')).toContainText(/ไม่ถูกต้อง/);
  });
});
```

- [ ] **Step 2: Run the E2E spec (desktop project)**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm test:e2e admin-branch-geofence --project=chromium
```
(If the project name differs, run `pnpm exec playwright test --list` to see configured projects and substitute. Omit `--project` to run all.)
Expected: 2 passed. If the first test fails on the value assertion, confirm the picker formats with `toFixed(6)` and that the edit page converts `Number(branch.latitude)`.

- [ ] **Step 3: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add tests/e2e/admin-branch-geofence.spec.ts
git commit -m "test(e2e): geofence lat/long typing persists + out-of-range rejected

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm test
```
Expected: all green, including the new `parse-coord.test.ts`.

- [ ] **Step 2: Typecheck + lint the whole project**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
pnpm typecheck && pnpm lint
```
Expected: both PASS (no type errors, no Biome errors).

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run `pnpm dev`, open `/admin/settings/branches/new`, and verify:
- Typing a latitude and longitude drops/moves the pin live.
- Dragging the pin updates both fields to 6-dp values.
- Emptying one field removes the pin.
- Typing `999` in latitude shows the red inline error; submitting shows the server's Thai error.
- `ล้างพิกัด` clears both fields and removes the pin.

- [ ] **Step 4: Confirm the branch is ready**

Run:
```bash
export PATH="/opt/homebrew/bin:$PATH"
git log --oneline -4
git status
```
Expected: three feature/test commits on top of the spec commit; clean working tree.

---

## Self-review notes (author)

- **Spec coverage:** draft-string layer (Task 2 state) ✓; live commit both-valid via reflection effect guard (Task 2) ✓; reflection effect removes pin on null (Task 2 effect) ✓; WYSIWYG named inputs / no hidden inputs (Task 2 JSX) ✓; pure `parseCoordInput` with server-matching bounds (Task 1) ✓; inline non-blocking validation via `aria-invalid` + hint (Task 2) ✓; pin→fields `toFixed(6)` (Task 2 `fmt`/`syncFromMap`) ✓; layout below map, two columns (Task 2 grid) ✓; unit + E2E tests (Tasks 1, 3) ✓; no `actions.ts` change ✓.
- **Type consistency:** `ParseCoordResult` shape (`{ ok: true; value: number | null } | { ok: false }`) is produced in Task 1 and consumed in Task 2 (`parsed.ok`, `parsed.value`); `syncFromMap(la, lo)` and `fmt(n)` signatures are consistent across both effects and handlers.
- **Edge cases:** empty → `value: null` (not invalid); one-field-filled waits for the pair, server enforces both-or-neither; `13.`→`13`; lone `-`→invalid; bounds per kind.
