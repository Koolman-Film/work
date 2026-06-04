# PR-6 — Attendance redesign Implementation Plan

> **For agentic workers:** executed subagent-driven (same session). UI is verified by Playwright e2e + screenshot review, not unit TDD. Each sub-part is its own commit.

**Goal:** Port the four Attendance admin pages (`/admin/attendance` records, `/disputed`, `/live`, `/manual`) onto the Sapphire system at full mockup fidelity, preserving 100% of functionality (void/restore, dispute approve/reject, manual create, Realtime live updates).

**Decisions (locked with the user):**
- **Disputed** = **master-detail** per mockup (list left + detail pane right: selfie + embedded GPS map + facts + note + approve/reject). Replaces the inline `DisputedReviewPanel`.
- **Live board** = **full mockup**: KPI stat strip + branch-grouped status chips (Realtime + 30s polling preserved).
- **Records** = `ResponsiveTable` + status badges + filter chips + Export + ⋯ row menu (void/restore) + pagination.
- **Manual** = `PageHeader` + padding (already mostly Sapphire).
- **Sub-nav** = replace the left-sidebar `AttendanceNav` with a horizontal **link-pill `AttendanceTabs`** strip rendered per page under its `PageHeader` (consistent with the leave/advance filter-chip styling). The `layout.tsx` becomes a thin pass-through (each page owns `px-4 py-6 sm:px-6 lg:px-8` + `PageHeader` + `AttendanceTabs`, like leave/advance).

**Mockups (the visual spec):** `account-attendance-sapphire.html`, `disputed-review-sapphire.html`, `live-board-sapphire.html` (in `.superpowers/brainstorm/64600-1780264990/content/`).

**Server actions (unchanged — UI only):**
- `voidAttendance(id, reason)` / `restoreAttendance(id)` — `@/lib/attendance/void` (`VoidResult`).
- `approveDisputed({attendanceId, note})` / `rejectDisputed({attendanceId, note})` — `@/lib/attendance/admin-review` (`{ok:true,nextStatus}|{ok:false,code,message}`, note required).
- `createManualAttendance(input)` — `@/lib/attendance/manual`.
- `getTodayAttendance()` — `@/lib/attendance/live` (`LiveAttendanceRow[]`; client-callable).

**Shared components reused:** `PageHeader`, `Card`, `ResponsiveTable` (`Column<T>{key,header,render?}`), `StatCard`, `EmptyState`, `StatusBadge` + `statusRail`/`STATUS_ICON`, `VoidDialog`/`RestoreButton`, `Dialog`/`ConfirmDialog`, and a new `RowMenu` (⋯) + `AttendanceTabs` + read-only `DisputeMap` (Leaflet).

---

## Sub-part order (each = 1 commit, verified before next)

### 6-1 · Sub-nav foundation + Manual page (quick, establishes the pattern)
- **New:** `src/app/(admin)/admin/attendance/attendance-tabs.tsx` — a server component link strip: 4 pills (`ประวัติ` → `/admin/attendance`, `ต้องตรวจสอบ` → `/disputed` with a pending-count badge, `สด` → `/live`, `คีย์มือ` → `/manual`). Active pill = `bg-primary-50 text-primary-700 ring-1 ring-primary-200` (same as leave/advance chips); inactive = `text-ink-4 hover:bg-gray-50`. Takes `current` + optional `disputedCount`.
- **Modify:** `attendance/layout.tsx` → thin pass-through (remove the sidebar grid + `AttendanceNav`); delete `attendance-nav.tsx`.
- **Modify:** `manual/page.tsx` → `px-4 py-6 sm:px-6 lg:px-8` + `<PageHeader breadcrumb="ลงเวลา" title="คีย์มือ — บันทึกการขาด/ลา/สาย" subtitle=…/>` + `<AttendanceTabs current="manual"/>` + the existing `<Card>`+`ManualAttendanceForm` (unchanged form).
- **Verify:** manual e2e (if any) green; screenshot `/admin/attendance/manual`.

### 6-2 · Records list
- **Modify:** `attendance/page.tsx` → `PageHeader` (`title="ประวัติการลงเวลา"`) + `AttendanceTabs current="records"` + filter chips (month prev/next + branch + type, restyled to Sapphire pills/selects; keep the existing query params) + an **Export** affordance (keep existing CSV link if present, else a placeholder that's wired to the existing export route if one exists — confirm during impl) + `ResponsiveTable` columns: พนักงาน (avatar+name), วันที่, ประเภท (`StatusBadge`), เวลา (in/out), ระยะเวลา, แหล่งที่มา, สถานะ, and a trailing **⋯ `RowMenu`** holding **ลบ (VoidDialog)** in live view / **กู้คืน (RestoreButton)** in trash view. Keep the trash toggle + pagination/"แสดง N จาก M".
- **New:** `src/components/ui/row-menu.tsx` — a small ⋯ dropdown (button + popover, closes on outside-click/Esc) holding action items; reused by records (and later lists).
- **Verify:** `admin-attendance-void` e2e behavior preserved (the void flow now lives in the ⋯ menu — update selectors if needed); screenshot desktop + mobile (stacked cards).

### 6-3 · Live board (KPI + chips)
- **Modify:** `live/page.tsx` + `live/live-client.tsx` → `PageHeader` (`title="การลงเวลาสด"` + a `🟢 LIVE` indicator pill driven by realtime-connected state) + branch filter + **KPI strip** (`StatCard` ×N) + **branch-grouped status chips** (compact avatar+name+time chip with a status color rail; grouped by `checkInBranch.name`). **Preserve** the Supabase realtime channel + 30s polling in `live-client.tsx` — only the rendering changes.
- **KPI scope:** compute from the day's rows that are actually available (เข้างานแล้ว = present count, ออกแล้ว vs ยังทำงาน via checkout time, ตรวจสอบ = Disputed count). **"ยังไม่มา" (absent vs roster) needs the expected roster** — if `getTodayAttendance` doesn't expose it, either (a) extend it to also return the active-employee count, or (b) omit that KPI for now and `log`/note it. Decide during impl; do NOT silently fake it.
- **Verify:** realtime still updates (manual DB insert → board updates within 30s); screenshot.

### 6-4 · Disputed master-detail (biggest)
- **New:** `src/components/map/dispute-map.tsx` (+ dynamic wrapper) — read-only Leaflet mini-map: branch marker + geofence circle (radius) + employee check-in marker, auto-fit bounds. Reuses the existing react-leaflet dep (see `geofence-picker.tsx`).
- **New:** `disputed/disputed-client.tsx` — master-detail client component: left = scrollable list of disputed items (avatar+name+time+distance, selected-state highlight); right = detail pane (big selfie, `DisputeMap`, facts grid: distance vs radius, GPS accuracy, system reason, a "เปิดใน Google Maps" link, the required note textarea, and **ไม่อนุมัติ / อนุมัติเป็นปกติ** buttons calling `rejectDisputed`/`approveDisputed`). On success → `router.refresh()` (drops the row, selects the next). Mobile: list, tap → detail (back button).
- **Modify:** `disputed/page.tsx` → `PageHeader` (`title="ต้องตรวจสอบ"`) + `AttendanceTabs current="disputed"` + `EmptyState` when none + render `<DisputedClient rows={vm}/>` (server builds a serializable VM incl. signed selfie URL, branch coords+radius, employee GPS, computed distance).
- **Delete:** `disputed/disputed-review-panel.tsx`.
- **Reuse note:** the note+approve/reject mechanics mirror `ReviewModal`, but the surface is a persistent detail pane (not a modal) — keep it bespoke to this page.
- **Verify:** new/updated `admin-attendance-disputed` e2e (seed a Disputed CheckIn → select in list → fill note → approve → row leaves list; reject path likewise) — assert via Prisma `checkInStatus`. Screenshot desktop + mobile.

### 6-5 · Cleanup + gate
- Remove any temp screenshot specs. Full gate: `tsc`, `biome check src/ tests/`, `vitest run`, the attendance e2e specs. Update the master plan's PR-6 line to ✅. Final review subagent over the whole PR-6 diff.

---

## Risks / watch-items
- **Live "ยังไม่มา" KPI** needs roster data — resolve explicitly (extend `live.ts` or omit), never fake.
- **`admin-attendance-void` e2e** can't run locally if it imports `src/lib/attendance/void.ts` via a `*-void` collection path (the known `next/headers` limitation). Confirm which attendance e2e specs are locally runnable; for those that aren't, rely on the records-list interaction via a runnable spec + manual verification.
- **Leaflet SSR** — must use the dynamic-import (`ssr:false`) wrapper pattern from `geofence-picker-dynamic.tsx`.
- **Mobile** — records (stacked cards), live (chips wrap), disputed (list→detail) all need a phone-width screenshot pass.
