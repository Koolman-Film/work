# Geofence picker — editable lat/long fields with two-way map sync

**Date:** 2026-06-08
**Status:** Design — approved, pending spec review
**Author:** brainstormed with Vivatchai Kaveeta

## Summary

The branch settings form's geofence picker
(`src/components/map/geofence-picker.tsx`) currently lets an admin set a
branch's GPS pin **only** by clicking or dragging on the Leaflet map. The
chosen coordinates are shown as **read-only** text (`พิกัด: 13.756300,
100.501800`) and submitted via two **hidden** `latitude` / `longitude`
inputs.

Add **editable** latitude / longitude number fields below the map, kept in
**two-way sync** with the pin:

- Type a coordinate → the pin + geofence circle move live (on each valid,
  in-range keystroke).
- Click / drag the pin → both fields update to the new coordinates.

## Goals

- Let the admin enter or correct a branch's latitude / longitude by typing,
  not only by clicking the map.
- Keep pin ⇄ fields synchronized in both directions, live as the admin types.
- What the admin sees in the fields is exactly what gets saved (WYSIWYG).
- Make the change with **zero server-side changes** — the existing Zod
  `coordSchema` in `actions.ts` already parses + bounds-checks the
  `latitude` / `longitude` strings.

## Non-goals

- No new map library, geocoding, or address→coordinate lookup.
- No change to the geofence radius input or the surrounding branch form
  fields.
- No change to the LIFF check-in geofence evaluation
  (`haversine.ts` / `evaluate.ts`) — this is admin-side data entry only.
- No reuse of this picker elsewhere; `branch-form.tsx` is the sole consumer.

## Key decisions

1. **Draft-string layer over the numeric state.** Today `lat` / `lng`
   (numbers) are the single source of truth driving the map. Binding an
   `<input value={lat}>` directly breaks mid-typing states (`"13."`, `"-"`,
   empty → `NaN`). Add `latText` / `lngText` string state for the input
   boxes; commit to numeric `lat` / `lng` only when a draft parses to a
   valid, in-range number. The numeric state stays the map's source of truth,
   so the existing "reflect state onto marker + circle" effect (current line
   127) moves the pin for free.

2. **Live commit requires *both* fields valid.** The pin only renders when
   both `lat` and `lng` are non-null (existing behavior). So a typed value
   commits to the map only when *its* draft is valid **and the other field is
   already a valid number**. This avoids the marker flickering away while the
   admin is partway through typing the first coordinate. Mechanically: each
   field's valid draft sets *its own* numeric state independently; the
   existing reflection effect's "both non-null" guard decides whether a pin is
   actually shown.

3. **Reflection effect must also *remove* the pin when a coordinate goes
   null.** Today the effect (current lines 127–154) only adds/moves the
   marker + circle; it never removes them (only the ล้างพิกัด button does). So
   if a pin exists and the admin empties one field, the stale marker would
   linger at its old spot. Extend the effect to remove the marker + circle
   when `lat == null || lng == null`, so emptying either field clears the pin
   uniformly. This also lets the clear button simply null out state + drafts
   and recenter, with removal handled in one place.

4. **WYSIWYG submission — drop the hidden inputs.** Give the **visible**
   inputs the `name="latitude"` / `name="longitude"` attributes directly and
   remove the two hidden inputs. What the admin sees is what submits — no risk
   of the box showing `999` while a stale hidden input saves the previous
   value. The server's existing `coordSchema` validates the submitted strings
   and the "both-or-neither" refine still holds, so **no `actions.ts`
   change**.

5. **Extract coordinate parsing into a pure helper.** Pull the
   parse-and-bounds-check into a pure function (mirrors the codebase's
   `haversine.ts` pure-module pattern) so it is unit-testable without a DOM or
   Leaflet:

   ```ts
   // src/components/map/parse-coord.ts
   // parseCoordInput('13.7', 'lat') -> { ok: true, value: 13.7 }
   // parseCoordInput('',    'lat')  -> { ok: true, value: null }   // empty = cleared
   // parseCoordInput('999', 'lat')  -> { ok: false }               // out of range
   // parseCoordInput('13.', 'lat')  -> { ok: true, value: 13 }     // partial-but-parseable
   // parseCoordInput('-',   'lat')  -> { ok: false }               // not yet a number
   export function parseCoordInput(
     text: string,
     kind: 'lat' | 'lng',
   ): { ok: true; value: number | null } | { ok: false };
   ```

   Bounds match the server exactly: lat ∈ [−90, 90], lng ∈ [−180, 180].

6. **Inline validation, non-blocking.** A non-empty field that fails to parse
   gets a red border + a short Thai hint; the map simply doesn't move until
   the value is valid again. The server-side Zod validation remains the
   backstop on submit.

7. **Pin → fields uses `toFixed(6)`.** When the admin clicks or drags the
   pin, both draft strings are rewritten to 6-decimal-place strings (matches
   the precision already used in the current read-only display).

## Architecture

### Data flow

```
                 ┌─────────────────────────────────────────┐
   type lat/lng  │  latText / lngText  (string draft state) │  ← input value
  ───────────────▶  (what the input boxes show)             │
                 └───────────────┬─────────────────────────┘
                                 │ parseCoordInput() ok & in range
                                 │ AND other field already valid
                                 ▼
                 ┌─────────────────────────────────────────┐
  click / drag   │  lat / lng  (numeric — map source of     │
  ───────────────▶  truth)                                   │
   pin           └───────────────┬─────────────────────────┘
        ▲                        │ existing effect (reflect onto map)
        │ setLatText/setLngText  ▼
        │              marker.setLatLng + circle.setLatLng/setRadius
        └──────────────────────  (pin moves)
```

Both directions converge on the same numeric `lat` / `lng` state and the same
map-reflection effect. The only new wiring is: (a) typing → draft → maybe
numeric, and (b) pin move → also refresh the draft strings.

### Component / module responsibilities

- **`src/components/map/parse-coord.ts`** *(new)* — exports
  `parseCoordInput(text, kind)`. Pure, no React/Leaflet imports. Empty/
  whitespace → `{ ok: true, value: null }`; finite & in-range →
  `{ ok: true, value: n }`; everything else → `{ ok: false }`.

- **`src/components/map/geofence-picker.tsx`** *(modify)* —
  - Add `latText` / `lngText` string state, initialized from
    `initialLat` / `initialLng` (`toFixed(6)` when present, else `''`).
  - **Map → fields:** in the `click` handler and the marker `dragend`
    handler, after `setLat` / `setLng`, also `setLatText(pos.lat.toFixed(6))`
    / `setLngText(pos.lng.toFixed(6))`.
  - **Fields → map:** each input's `onChange` sets its draft string, then
    runs `parseCoordInput`. On `{ ok: true, value }`:
    - `value === null` (field emptied) → set that coordinate's numeric state
      to `null` (the reflection effect — extended per decision 3 — then removes
      the pin since the pair is no longer complete).
    - numeric `value` → set that coordinate's numeric state (commits; pin
      moves if the other coordinate is also non-null).
    On `{ ok: false }` → keep the draft string (so the admin sees what they
    typed) but leave the numeric state untouched; mark the field invalid.
  - **Validation display:** derive `latInvalid` / `lngInvalid` from
    `parseCoordInput` on the current draft (non-empty + `!ok`). Apply a red
    border + small Thai hint to the offending field.
  - **Replace** the read-only `พิกัด:` text + hidden inputs with the two
    visible `<input name="latitude">` / `<input name="longitude">` fields
    (value = draft strings). Keep the existing **ล้างพิกัด** (clear) button;
    it now also empties both draft strings.
  - **Extend the reflection effect** (current lines 127–154) to remove the
    marker + circle when `lat == null || lng == null` (per decision 3), so
    emptying a field clears a previously-shown pin.
  - Keep the existing radius-input watcher and the init-only map effect
    unchanged.

- **`src/app/(admin)/admin/settings/branches/branch-form.tsx`**
  *(unchanged)* — still passes `latInputName="latitude"`
  / `lngInputName="longitude"`; the picker now binds those names to the
  visible inputs. The `<FormField label="ตำแหน่งบนแผนที่">` wrapper hint copy
  may gain a few words noting fields can be typed (minor, optional).

- **`src/app/(admin)/admin/settings/branches/actions.ts`** *(unchanged)* —
  `coordSchema` already accepts the coordinate strings and enforces
  lat ∈ [−90, 90] / lng ∈ [−180, 180] and both-or-neither.

### Layout (below the map, two columns)

```
[ Leaflet map — h-72, full width ]
[ ละติจูด (name=latitude) ]  [ ลองติจูด (name=longitude) ]   ← 2-col grid, reuses <Input>
[ helper text / per-field invalid hint        ·       ล้างพิกัด ]
```

Fields use the existing `<Input>` component (`type="text"`,
`inputMode="decimal"` so mobile shows a numeric keypad with a minus/decimal;
`type="number"` is avoided because it rejects partial drafts like `"-"` and
strips them). Two-column grid keeps the map full width inside the narrow
settings card and stacks cleanly on mobile.

## Error handling & edge cases

- **Both fields empty** → no pin, no geofence (unchanged "geofence optional"
  semantics; submits empty `latitude` / `longitude`).
- **One field filled, other empty** → no pin yet (map waits for the complete
  pair); on submit the server's both-or-neither refine returns the existing
  Thai error.
- **Out-of-range / unparseable value** (`999`, `abc`, lone `-`) → field shows
  red + hint, map does not move, numeric state retains the last valid value.
- **Partial-but-parseable** (`13.`, `-13`) → `Number()` accepts it
  (`Number('13.') === 13`), so the pin tracks it; the admin can keep typing.
- **Clear button (ล้างพิกัด)** → empties both drafts + numeric state, removes
  marker + circle, recenters on Bangkok (existing behavior, plus the two new
  `setLatText('')` / `setLngText('')`).
- **Drag / click after typing** → both fields refresh to the dragged pin's
  `toFixed(6)` value, clearing any stale invalid draft.

## Testing

- **`parseCoordInput` (unit, pure):** valid lat & lng; empty / whitespace →
  `value: null`; out-of-range per kind (lat `91`, lng `181`); garbage
  (`abc`); partial (`13.` → `13`, lone `-` → `ok:false`); boundary values
  (`90`, `-90`, `180`, `-180` ok; `90.0001` not).
- **E2E (extend the branches Playwright spec):**
  - Type a latitude + longitude, save, reload the edit page, assert the
    fields show the saved coordinates.
  - Confirm the existing map-click path still sets + saves coordinates.
  - (If practical) assert that typing a valid pair updates the on-screen
    coordinate state; full Leaflet pin-position assertions are best-effort
    given the canvas/DOM nature of the map.

## Out of scope / future

- Address or place-name geocoding to coordinates.
- "Use my current location" button.
- Per-field copy/paste of a `lat, lng` pair into a single box.
