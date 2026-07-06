# Audit Log Viewer (`/admin/audit`) — Design

**Date:** 2026-07-06
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with Claude

## Summary

Build a full-page, forensic, reverse-chronological **viewer** over the existing
`AuditLog` table at `/admin/audit`. Filterable by actor, action, entity-type,
specific entity, and date range. Rows expand to a human-readable field diff.

This is **purely a read surface**. No new data model and no new audit writes —
the `AuditLog` table already exists and is populated by ~80 callsites via
`auditLog()` / `auditLogTx()`. The `/admin/audit` sidebar item currently renders
as a disabled "เร็วๆ นี้" (coming soon) placeholder; this design makes it live.

## Context (what already exists)

- **Model:** `AuditLog` — `prisma/schema.prisma:831`. Fields: `id`, `actorId`
  (nullable, intentionally NOT a FK so history survives user deletion — `null` =
  system action), `action` (string, e.g. `payroll.publish`), `entityType`
  (string, e.g. `Employee`), `entityId` (uuid), `beforeValue` (Json?),
  `afterValue` (Json?), `metadata` (Json? — IP, user-agent, source), `createdAt`.
  Indexes: `[entityType, entityId, createdAt desc]`, `[actorId, createdAt desc]`,
  `[action]`.
- **Emission:** `src/lib/audit/log.ts` — `auditLog()` (fire-and-forget) and
  `auditLogTx()` (transactional). Canonical `AuditAction` and `AuditEntityType`
  string catalogs live here.
- **Permission:** `audit.read` exists (`src/lib/auth/permissions.ts:102`),
  granted to Admin by default (`src/lib/auth/roles.ts:111`); superadmin gets all.
- **Reference read UI:** `/owner` page (`src/app/(owner)/owner/page.tsx`) renders
  a 15-row recent-activity feed with an inline Thai `ACTION_LABELS` map and
  bulk actor-name resolution. We lift and centralize these patterns.

## Decisions

1. **Primary use = forensic feed, entity-filterable.** One reverse-chronological
   page, filterable. "Entity history" is achieved via the `entityType`+`entityId`
   filter (the table is already indexed for it), not a separate page. Embedded
   "Activity" tabs on entity detail pages are **deferred to Phase 2**.
2. **Branch scoping = global-only for now.** Only superadmin or holders of a
   *globally-scoped* `audit.read` (`branchId = null`) may open the page.
   Branch-scoped `audit.read` holders are denied (`notFound()`), matching the
   fact that per-branch audit enforcement is unbuilt ("Phase 3.7"). Revisit when
   branch-scoped audit access is actually granted.
3. **Change detail = expandable row + field diff.** Collapsed rows show a
   one-line summary; expanding shows a human-readable field-by-field diff, with a
   "view raw JSON" toggle for the untouched before/after.

## Non-goals (explicit YAGNI)

- Embedded "Activity" tabs on entity detail pages (Phase 2).
- Branch-scoped access / per-entity-type branch resolution.
- CSV export / download.
- Real-time streaming / live updates.
- Grouping or collapsing of bulk events (e.g. one `payroll.publish` writing many
  rows). The action filter is the v1 mitigation for feed noise.

## Architecture

### Route & gate

- **New:** `src/app/(admin)/admin/audit/page.tsx` — Server Component.
- **Gate:** `requirePermission('audit.read')` **plus** a global-scope check.
  Access granted iff user is superadmin OR holds an `audit.read` assignment with
  `branchId = null`. Otherwise `notFound()`.
- **New helper:** `hasGlobalPermission(user, perm)` in the auth lib — small,
  reusable, checks for a `branchId = null` assignment conferring `perm` (or
  superadmin).
- **Sidebar:** `src/components/admin/sidebar.tsx` — flip the `/admin/audit` item
  from disabled to live, and gate its **visibility** on the same global-scope
  check so branch-scoped admins never see a dead link.

### Data & query layer — `src/lib/audit/query.ts` (server-only)

- `buildAuditWhere(params)` → Prisma `where` from URL searchParams: `actor`,
  `action`, `entityType`, `entityId`, `dateFrom`, `dateTo`. Query paths align
  with the three existing indexes.
- **Keyset (cursor) pagination** on `(createdAt desc, id)`, page size **50**.
  Chosen over offset because audit rows are append-heavy — `OFFSET` would
  skip/repeat rows as new events land mid-session. Cursor encoded in the URL.
- `resolveActors(rows)` → bulk-fetch `User` (+ employee) for the distinct
  `actorId`s on the current page into a display-name Map (lifts `/owner`
  pattern). `null` actor → "ระบบ" (system).

### Presentation helpers — `src/lib/audit/labels.ts` and `src/lib/audit/diff.ts`

- **`labels.ts`** — relocate `ACTION_LABELS` out of the `/owner` page into this
  shared module; both pages import it (dedupe). Add:
  - `ENTITY_TYPE_LABELS` (e.g. `Employee` → "พนักงาน").
  - `SENSITIVE_ACTIONS` set: role/permission changes, `roleAssignment.*`,
    `user.account-merge`, `user.archive`, `user.delete`, `employee.archive`,
    `employee.delete`, `payroll.publish`, `payroll.revise`, `payrollConfig.update`.
  - `FIELD_LABELS` — friendly Thai labels for common diff fields (e.g. `salary`,
    `branchId`).
- **`diff.ts`** — `diffValues(before, after)` returns an ordered list of diff
  rows (`{ field, label, before, after, changeType }`) over the union of keys.
  Value formatters: thousands-separated numbers, localized dates,
  booleans → "ใช่"/"ไม่ใช่", `null`/absent → "—". ID-valued fields
  (`branchId`, `departmentId`, roleId) resolved to names best-effort; unresolved
  keys fall back to the raw value.

### Components

- **`AuditFilters` (client)** — filter bar. Actor + date-range + action lead
  (forensic priority); entity-type secondary; `entityId` is deep-link driven.
  **All filter state lives in the URL** so any filtered view is shareable
  (incident writeups) and the entity-history view is just a pre-filled URL.
- **`AuditRow` (client)** — collapsed: `actor · action label · target ·
  relative time` + sensitive badge. Expanded: field-diff table, metadata
  (source, IP from `metadata`), and a "ดู JSON ดิบ" (view raw) toggle.
- **Target link** — the entity target renders as a link that self-filters the
  feed to that entity (`?entityType=…&entityId=…`), delivering the
  entity-history use case with no extra page.
- **Pagination control** — next/prev via URL cursor.

## Error / empty states

- No results for the active filters → friendly empty state naming the filters.
- Denied (non-global `audit.read`) → `notFound()` (consistent with other gates).
- Malformed searchParams → ignored / treated as unset (defensive parsing in
  `buildAuditWhere`).

## Testing (TDD, matching existing culture)

- **Unit:**
  - `diffValues` — add / remove / change / no-change cases; nested/scalar values.
  - Value formatters (numbers, dates, booleans, null).
  - Sensitive-action classification.
  - `buildAuditWhere` — each filter and combinations; malformed input ignored.
  - `hasGlobalPermission` — superadmin, global grant, branch-only grant, none.
- **Integration:**
  - Filtered queries return correct rows for representative combos.
  - Actor resolution (including deleted actor → id retained, `null` → system).
  - Branch-scoped admin denied; global admin allowed.
  - Keyset paging stable across concurrent inserts.
  - Seed a handful of `AuditLog` rows as fixtures.

## Files

**New**

- `src/lib/audit/labels.ts` — action/entity labels, sensitive set, field labels.
- `src/lib/audit/query.ts` — `buildAuditWhere`, page fetch, `resolveActors`.
- `src/lib/audit/diff.ts` — `diffValues` + formatters.
- `src/app/(admin)/admin/audit/page.tsx` — server component.
- `src/app/(admin)/admin/audit/audit-filters.tsx` — client filter bar.
- `src/app/(admin)/admin/audit/audit-row.tsx` — client expandable row.
- `hasGlobalPermission` helper (in the auth lib alongside existing checks).

**Modified**

- `src/components/admin/sidebar.tsx` — enable + visibility-gate the audit item.
- `src/app/(owner)/owner/page.tsx` — import shared labels (dedupe).

## Phase 2 (deferred, no rework implied)

- Embedded "Activity" tab on entity detail pages (employee, payroll, leave),
  reusing `AuditRow` + the entity filter query.
- Branch-scoped audit access with per-entity-type branch resolution.
- CSV export of a filtered view.
- Bulk-event grouping for noisy actions (e.g. `payroll.publish`).
