# Unified Approvals Inbox (`/admin/approvals`) — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with Claude

## Summary

A new admin page that aggregates the three existing pending-approval queues —
**leave requests, cash advances, and disputed check-ins** — into a single
actionable list. The admin approves/rejects each item **inline**, reusing the
existing per-type review modals and the existing server actions. **No new
mutation logic**: the money- and state-moving code is already built, tested, and
in production. The three dedicated pages (`/admin/leave`, `/admin/advance`,
`/admin/attendance/disputed`) remain unchanged for deep filtering, trash views,
and heavy detail.

This is roadmap item #4 — a fast win that recomposes data and actions that
already exist.

## Context (what already exists)

- **Three pending loaders**, each applying `viaEmployeeBranchScope(permitted)`:
  - `loadLeaveInbox(...)` — `src/app/(admin)/admin/leave/_load-inbox.ts`; pending = `{ status: 'Pending' }`.
  - `loadAdvanceInbox(...)` — `src/app/(admin)/admin/advance/_load-inbox.ts`; pending = `{ status: 'Pending' }`.
  - `loadDisputedCheckIns(permitted)` — `src/app/(admin)/admin/attendance/disputed/_load-inbox.ts`; pending = `{ type: 'CheckIn', checkInStatus: 'Disputed' }`.
- **Count aggregation seam:** `loadSidebarBadgeCounts(assignments)` — `src/app/(admin)/_load-badge-counts.ts` — already returns `{ leave, advance, attendance }`, each scoped by its own read-permission + branch scope. Called from `src/app/(admin)/layout.tsx`.
- **Shared review UI:** `src/components/ui/review-modal.tsx` (`ReviewModal`) powers approve/reject/void across all three, including the advance money-confirm two-step. On success it calls `router.refresh()` (pages are dynamic; no `revalidatePath`).
- **Per-type modals & actions:**
  - Leave — `LeaveReviewModal` → `approveLeaveRequest(input)` / `rejectLeaveRequest(input)` (`src/lib/leave/admin.ts`).
  - Advance — `AdvanceReviewModal` → `approveCashAdvance(input)` / `rejectCashAdvance(input)` (`src/lib/advance/admin.ts`).
  - Disputed — `DisputedClient` (master-detail + Leaflet map) → `approveDisputed(input)` / `rejectDisputed(input)` (`src/lib/attendance/admin-review.ts`). Both require a `note`.
- **Branch scoping:** `viaEmployeeBranchScope(permitted)` + `permittedBranchesFromAssignments(assignments, permission)` — `src/lib/auth/branch-scope.ts`.
- **Permissions:** `leave.read`+`leave.approve`, `advance.read`+`advance.approve`, `attendance.read`+`attendance.dispute-resolve` (`src/lib/auth/permissions.ts`).
- All three actions already emit audit entries and post-commit notifications.

## Decisions

1. **Interaction = act inline (unified action surface).** One page lists all
   pending items; the admin approves/rejects in place. The three dedicated pages
   stay.
2. **Disputed = light inline modal + escape hatch.** Leave and advance reuse
   their existing modals verbatim. Disputed gets a NEW lightweight modal (facts,
   clock-in time, geofence distance, system reason, selfie thumbnail, note) — no
   interactive map — plus a link to `/admin/attendance/disputed` for the full
   map/detail. Approves via the existing `approveDisputed`/`rejectDisputed`.
3. **Sort = newest-first**, matching the existing inboxes' `orderBy … desc`.
4. **Read-but-not-approve users see rows read-only** (facts, no action buttons),
   consistent with the dedicated pages.

## Non-goals (explicit YAGNI)

- Bulk approve/reject.
- Replacing or retiring the three dedicated pages.
- Cross-type pagination (see Volume handling — cap + filters instead).
- Realtime/streaming updates.
- A unified single modal (we reuse the existing per-type modals; only disputed
  gets a new light one).

## Architecture

### Route, gate & navigation

- **New route:** `src/app/(admin)/admin/approvals/page.tsx` (server component).
- **Gate:** accessible to holders of **any of** `leave.read`, `advance.read`,
  `attendance.read` (the existing `anyOf` sidebar/`requireAdminArea` pattern). A
  user sees only the queues they can read.
- **Sidebar:** new item **"รออนุมัติ"** at the TOP of the "งานประจำวัน"
  (Daily Work) section, above the existing leave/advance/attendance items (which
  stay), gated `anyOf: ['leave.read','advance.read','attendance.read']`, with a
  **combined pending badge** = `leave + advance + attendance` from the existing
  `loadSidebarBadgeCounts()` result. No new count query — the layout already
  computes the three; the sidebar sums them for this item's badge.

### Data layer — `loadApprovalsInbox(assignments, filters)` (slim cards)

**Confirmed at planning time:** an absent read-permission yields
`permittedBranchesFromAssignments → []` → `viaEmployeeBranchScope → { employee: { id: { in: [] } } }`
→ 0 rows/0 count. No guard task needed.

The loader produces **slim list cards only** — it does NOT build the heavy full
review VMs. This is deliberate: building a full `LeaveRowVM` requires async
per-row work (over-quota preview = 4–5 queries/row, working-day calc, signed
attachment URL) and `AdvanceRowVM` needs an async balance guard + signed receipt.
Doing that for every pending row on page load is wasteful; instead the full VM is
built **lazily on click** (see Interaction). The list stays cheap and synchronous.

New server-only function `src/lib/approvals/load-inbox.ts`:

1. Runs three pending `findMany` queries in parallel, each scoped by its own
   permission via `permittedBranchesFromAssignments(assignments, <read-perm>)` +
   `viaEmployeeBranchScope(...)`, reusing the existing `LEAVE_SELECT` /
   `ADVANCE_SELECT` / `DISPUTED_SELECT`. `take = CAP + 1` (CAP e.g. 200) per queue
   to detect truncation. A queue the user cannot read → empty scope → 0 rows.
2. Maps each raw row to a slim, type-tagged card via **pure, synchronous**
   mappers (unit-tested) — no async, no signing, no over-quota/guard:

```ts
type ApprovalCard =
  | { type: 'leave';    id; employeeName; nickname; branch; department;
      submittedAt: Date; leaveType: string; range: string }
  | { type: 'advance';  id; employeeName; nickname; branch; department;
      submittedAt: Date; amount: string }
  | { type: 'disputed'; id; employeeName; nickname; branch; department;
      submittedAt: Date; clockInLabel: string; distanceMeters: number | null;
      reason: string };
```

   - `leave`: `range` = `formatLeaveRange(startDate,endDate)`; `submittedAt` = `createdAt`.
   - `advance`: `amount` = `formatAdvanceMoney(amount)`; `submittedAt` = `requestedAt`.
   - `disputed`: `clockInLabel` = Bangkok `HH:MM` via `formatTime` (`@/lib/i18n/format`);
     `distanceMeters` = haversine(`checkInLat/Lng`, `checkInBranch.lat/lng`) via a
     shared `src/lib/geo/distance.ts` (the disputed page has a private copy — the
     new module is shared; the page's copy is left untouched to avoid changing a
     shipped file); `submittedAt` = `clockInAt`; `reason` = `disputeReason ?? 'ไม่ระบุ'`.
3. Applies pure filters (`type`, `branchId`, employee-name `q`), merges, sorts by
   `submittedAt` **descending**.
4. Returns `{ cards: ApprovalCard[]; counts: { leave; advance; disputed; total }; capped: boolean }`.

### Volume handling

Pending queues are normally small (dozens). v1 loads **all pending** across the
three scoped queries with a per-queue cap (e.g. 200 rows each); if any cap is
hit, `capped: true` drives a "refine with filters" note. No pagination.
Filters (type chips, branch, employee search) are **URL-driven** (shareable),
mirroring the audit page.

### Interaction — lazy full-VM on click, reuse existing modals

The list shows slim cards. Clicking a card **fetches the full review VM on
demand**, then opens the existing modal for that type. The single-record getters
already exist and are permission-gated + branch-scoped:

- **Leave** → `getLeaveReviewRow(id)` (EXISTING, `src/app/(admin)/admin/_calendar/actions.ts`;
  gates `leave.approve` + branch scope) → returns `LeaveRowVM` → existing
  `LeaveReviewModal` → `approveLeaveRequest`/`rejectLeaveRequest`.
- **Advance** → `getAdvanceReviewRow(id)` (EXISTING, same file; gates
  `advance.approve`) → `AdvanceRowVM` → existing `AdvanceReviewModal`
  (money-confirm two-step + receipt upload) → `approveCashAdvance`/`rejectCashAdvance`.
- **Disputed** → NEW `getDisputedReviewRow(id)` single-record action (gates
  `attendance.dispute-resolve` + branch scope; signs the selfie, computes
  distance) → NEW lightweight `DisputedReviewModalLite` (employee, clock-in time,
  distance, reason, selfie thumbnail, required note) →
  `approveDisputed`/`rejectDisputed`; plus a "ดูแผนที่ / ดูรายละเอียดเต็ม" link to
  `/admin/attendance/disputed`.

The **heavy per-row async work runs only for the opened row**, not the whole
list. Because leave/advance reuse their exact existing getters + modals + actions,
approving from the inbox is behaviorally identical to approving from the dedicated
page (same quota/cap checks, audit, notifications). Only disputed introduces new
UI + a new getter.

**Clickability by permission:** the page computes a per-type `canReview`
(`leave.approve` / `advance.approve` / `attendance.dispute-resolve`) on the server
and passes it to the client. Cards whose type the user cannot review are shown but
**not clickable** (facts only — no modal), since the getters require the approve
permission. This satisfies "read-but-not-approve sees rows read-only." (A richer
read-only detail panel is deferred — Phase 2.)

On action success the modals already call `router.refresh()`, which re-runs the
approvals page loader — the decided row drops out of the list. No extra wiring.

## Error / empty states

- No pending items (for the user's scope) → friendly empty state.
- A row action returns a domain error (e.g. `over-quota-block`, `over-cap`,
  `not-pending` after a concurrent decision) → surfaced by the existing modal's
  error handling, unchanged.
- Malformed filter params → ignored (defensive parsing, same convention as the
  audit page's `buildAuditWhere`).

## Testing

- **Unit:**
  - `haversineMeters` (known coordinate pairs → expected metres; zero distance).
  - Per-type card mappers (`range`, `amount`, `clockInLabel`, `distanceMeters`,
    `submittedAt` selection, null nickname/department, `reason` fallback).
  - `filterApprovalCards` (type/branch/`q`; blank params ignored) and
    `sortApprovalCardsDesc` (interleaving across types, newest-first).
- **Integration:** `loadApprovalsInbox` against seeded data across
  `LeaveRequest` + `CashAdvance` + `Attendance(Disputed)`:
  - Correct aggregation, counts, and `capped` flag.
  - **Per-permission scoping:** a user with only `leave.read` sees only leave
    cards; other queues yield 0.
  - Branch scoping restricts to permitted branches.
  - Only pending items appear (approved/rejected/cancelled excluded).
- Client components (page, `approvals-list`, `approvals-filters`,
  `DisputedReviewModalLite`) and the `getDisputedReviewRow` action verified via
  `tsc` + `lint` (no React render harness — node-only vitest), consistent with
  the audit-log feature.
- No new tests for the reused `getLeaveReviewRow`/`getAdvanceReviewRow` getters,
  the leave/advance modals, or the approve/reject actions — all unchanged and
  already covered.

## Files

**New**
- `src/lib/geo/distance.ts` — shared `haversineMeters(...)` (pure).
- `src/lib/approvals/cards.ts` — `ApprovalCard` union + pure per-type mappers +
  `filterApprovalCards` + `sortApprovalCardsDesc` (unit-tested).
- `src/lib/approvals/load-inbox.ts` — `loadApprovalsInbox(assignments, filters)`
  (server-only; the three scoped queries + mapping + counts).
- `src/app/(admin)/admin/approvals/disputed-review.ts` — `getDisputedReviewRow(id)`
  single-record server action + its light `DisputedReviewVM` type.
- `src/app/(admin)/admin/approvals/page.tsx` — server component.
- `src/app/(admin)/admin/approvals/approvals-list.tsx` — client list; card →
  lazy getter → modal dispatch; holds the selected full-VM state.
- `src/app/(admin)/admin/approvals/disputed-review-modal-lite.tsx` — light
  disputed modal (reuses `ReviewModal`).
- `src/app/(admin)/admin/approvals/approvals-filters.tsx` — URL-driven filter bar
  (type chips, branch, employee search).
- Tests: `src/lib/geo/distance.test.ts`, `src/lib/approvals/cards.test.ts`,
  `tests/integration/approvals-inbox.integration.test.ts`.

**Reused as-is (imported, not modified):** `getLeaveReviewRow`,
`getAdvanceReviewRow` (`src/app/(admin)/admin/_calendar/actions.ts`);
`LeaveReviewModal`, `AdvanceReviewModal`; `LEAVE_SELECT`/`ADVANCE_SELECT`/`DISPUTED_SELECT`;
`viaEmployeeBranchScope`/`permittedBranchesFromAssignments`.

**Modified**
- `src/components/admin/sidebar.tsx` — add the "รออนุมัติ" nav item (`anyOf`
  read perms) with `badgeKey: 'approvals'`; extend `SidebarBadges` with
  `approvals: number`.
- `src/app/(admin)/layout.tsx` — pass `approvals: leave + advance + attendance`
  into `badges` (reusing the existing `loadSidebarBadgeCounts` result; no new query).

## Phase 2 (deferred, no rework implied)

- Bulk approve/reject for a filtered selection.
- Embedding the full disputed map/detail inline (upgrade the light modal).
- Cross-type pagination if pending volumes ever grow large.
- Additional approvable types (e.g. overtime) if they gain a pending queue.
