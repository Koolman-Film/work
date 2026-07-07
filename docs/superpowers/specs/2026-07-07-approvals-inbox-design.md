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

### Data layer — `loadApprovalsInbox(assignments, filters)`

New server-only function (e.g. `src/lib/approvals/load-inbox.ts`) that:

1. Runs three pending queries in parallel, each scoped by its own permission via
   `permittedBranchesFromAssignments(assignments, <read-perm>)` +
   `viaEmployeeBranchScope(...)`. A queue the user cannot read resolves to an
   empty scope → 0 rows (verify `permittedBranchesFromAssignments` returns an
   empty permitted set, not "all", when the permission is absent).
2. Maps each result to a common **type-tagged row** (pure mappers, unit-tested):

```ts
type UnifiedApprovalRow =
  | { type: 'leave';    id: string; employeeName: string; nickname: string | null;
      branch: string; department: string | null; submittedAt: Date;
      leaveType: string; range: string; durationLabel: string }
  | { type: 'advance';  id: string; employeeName: string; nickname: string | null;
      branch: string; department: string | null; submittedAt: Date;
      amount: string }
  | { type: 'disputed'; id: string; employeeName: string; nickname: string | null;
      branch: string; department: string | null; submittedAt: Date;
      clockInLabel: string; distanceMeters: number | null; reason: string;
      selfieUrl: string | null };
```

3. Applies filters (type, branchId, employee-name search `q`), merges, and sorts
   by `submittedAt` **descending** (leave `createdAt` / advance `requestedAt` /
   dispute detected-at).
4. Returns `{ rows, counts: { leave, advance, disputed, total }, capped: boolean }`.

`submittedAt` is the single cross-type sort key. The mappers reuse existing
formatting helpers (`@/lib/format`, and whatever the leave/advance row VMs use
for range/duration/amount) to keep display identical to the dedicated pages.

### Volume handling

Pending queues are normally small (dozens). v1 loads **all pending** across the
three scoped queries with a per-queue cap (e.g. 200 rows each); if any cap is
hit, `capped: true` drives a "refine with filters" note. No pagination.
Filters (type chips, branch, employee search) are **URL-driven** (shareable),
mirroring the audit page.

### Interaction — reuse existing modals

The page renders the merged list; clicking a row opens the modal for its type:

- **Leave** → existing `LeaveReviewModal` → `approveLeaveRequest`/`rejectLeaveRequest`.
- **Advance** → existing `AdvanceReviewModal` (money-confirm two-step) →
  `approveCashAdvance`/`rejectCashAdvance`.
- **Disputed** → NEW lightweight modal (`DisputedReviewModalLite`): employee,
  clock-in time, distance, system reason, selfie thumbnail, required note →
  `approveDisputed`/`rejectDisputed`; plus a "ดูแผนที่ / ดูรายละเอียดเต็ม" link to
  `/admin/attendance/disputed`.

Row action buttons are gated by the matching **approve** permission
(`leave.approve` / `advance.approve` / `attendance.dispute-resolve`) resolved on
the server and passed to the client rows; a read-only user sees facts without
buttons. On action success: `router.refresh()`.

Because leave/advance reuse their exact existing modals and actions, approving
from the inbox is behaviorally identical to approving from the dedicated page
(same quota/cap checks, audit, notifications). Only disputed introduces new UI.

## Error / empty states

- No pending items (for the user's scope) → friendly empty state.
- A row action returns a domain error (e.g. `over-quota-block`, `over-cap`,
  `not-pending` after a concurrent decision) → surfaced by the existing modal's
  error handling, unchanged.
- Malformed filter params → ignored (defensive parsing, same convention as the
  audit page's `buildAuditWhere`).

## Testing

- **Unit:**
  - Per-type row mappers (range label, duration label, amount format, distance,
    `submittedAt` selection, null nickname/department).
  - Merge + sort (interleaving across types, newest-first, cap flag).
  - Filter application (type/branch/`q`; blank params ignored).
- **Integration:** `loadApprovalsInbox` against seeded data across
  `LeaveRequest` + `CashAdvance` + `Attendance(Disputed)`:
  - Correct aggregation and counts.
  - **Per-permission scoping:** a user with only `leave.read` sees only leave
    rows; counts for other queues are 0.
  - Branch scoping restricts to permitted branches.
  - Only pending items appear (approved/rejected/cancelled excluded).
- Client components (page, unified list, `DisputedReviewModalLite`) verified via
  `tsc` + `lint` (no React render harness — node-only vitest), consistent with
  the audit-log feature.
- No new tests for the reused leave/advance/disputed actions — they are unchanged
  and already covered.

## Files

**New**
- `src/lib/approvals/load-inbox.ts` — `loadApprovalsInbox` + `UnifiedApprovalRow`.
- `src/lib/approvals/row-vm.ts` — pure per-type mappers/formatters (unit-tested).
- `src/app/(admin)/admin/approvals/page.tsx` — server component.
- `src/app/(admin)/admin/approvals/approvals-list.tsx` — client list + row →
  modal dispatch.
- `src/app/(admin)/admin/approvals/disputed-review-modal-lite.tsx` — light
  disputed modal.
- `src/app/(admin)/admin/approvals/approvals-filters.tsx` — URL-driven filter bar
  (type chips, branch, employee search).
- Tests: `src/lib/approvals/row-vm.test.ts`,
  `tests/integration/approvals-inbox.integration.test.ts`.

**Modified**
- `src/components/admin/sidebar.tsx` — add the "รออนุมัติ" item + combined badge.
- `src/app/(admin)/layout.tsx` — pass the combined/needed badge value to the
  sidebar (reusing the existing `loadSidebarBadgeCounts` result; no new query).

## Phase 2 (deferred, no rework implied)

- Bulk approve/reject for a filtered selection.
- Embedding the full disputed map/detail inline (upgrade the light modal).
- Cross-type pagination if pending volumes ever grow large.
- Additional approvable types (e.g. overtime) if they gain a pending queue.
