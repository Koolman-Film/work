# Soft-delete / void for transactional records — Design

**Date:** 2026-05-29
**Status:** Approved for planning
**Author:** Tong + Claude
**Scope:** Attendance, LeaveRequest, CashAdvance

---

## 1. Problem

Admins have no way to remove a wrong transactional record. Today:

- **Attendance** — no delete, no void. An admin can manually create a row
  (`src/lib/attendance/manual.ts`) and override a *disputed* check-in
  (`src/lib/attendance/admin-review.ts`), but a wrong manual entry (wrong
  employee / date / type) is **permanently stuck**. The
  `@@unique([employeeId, date, type])` constraint then *blocks* re-entering the
  correct row. Attendance feeds payroll directly, so a wrong row silently
  corrupts pay.
- **LeaveRequest** — employees can self-cancel while `Pending`
  (`src/lib/leave/actions.ts` `cancelLeaveRequest`, guarded by
  `status !== 'Pending'`). Once an admin **approves**, approval auto-creates
  `Attendance(OnLeave)` rows (`src/lib/leave/admin.ts`). There is **no admin
  path to undo an approved leave**.
- **CashAdvance** — same shape. Employee cancel while `Pending` only. Once
  approved, no undo. `isDeducted: true` means a published payroll already
  consumed it.

There are **zero soft-delete columns in the schema** today. Removal is a
patchwork of hard delete (Employee/User, Role, WorkSchedule, LeaveType),
archive flags (`LeaveType.archivedAt`, `EmpStatus.Archived`), and employee-only
status→`Cancelled`.

## 2. Decision summary

| Decision | Choice |
| --- | --- |
| Strategy | **Soft-delete with guard rails** (reversible, payroll-safe, audit-preserving) |
| Records in scope | **Attendance, LeaveRequest, CashAdvance** |
| Who can void | **Admin (branch-scoped) + Superadmin** |
| Out of scope | Payroll void (needs a dedicated reversal flow, not a delete); settings entities keep existing archive / hard-delete-when-unused |

## 3. Why soft, not hard

All three records are payroll-load-bearing and legally retained: Attendance →
pay calc; `CashAdvance.isDeducted` → published Payroll; approved Leave →
`Attendance(OnLeave)`. Hard-deleting a consumed record corrupts financial
history. Soft delete gives admins the "undo a mistake" they need while
preserving the audit trail Thai labor records require. This extends the
philosophy already in the codebase — `deleteEmployee` refuses to hard-delete
anyone with related records and points the admin to "พ้นสภาพ" (archive).

## 4. Schema changes

Add to **Attendance, LeaveRequest, CashAdvance**:

```prisma
deletedAt    DateTime?  // null = live; set = voided
deletedById  String?    @db.Uuid  // User.id of the admin who voided.
                                   // NOT a FK — users are soft-deleted too,
                                   // matching Attendance.createdById convention.
deleteReason String?    // mandatory free-text reason; shown in trash + audit

@@index([deletedAt])
```

### 4.1 The partial-unique-index trap (critical)

`Attendance` has `@@unique([employeeId, date, type])`. A soft-deleted row still
occupies that slot, so voiding a wrong `(employee, date, Late)` row would still
block entering the correct one — defeating the #1 use case.

**Fix:** replace the plain unique with a **partial unique index**:

```sql
-- In the migration SQL (Prisma's schema DSL cannot express partial-unique):
DROP INDEX "Attendance_employeeId_date_type_key";
CREATE UNIQUE INDEX "Attendance_employeeId_date_type_live_key"
  ON "Attendance" ("employeeId", "date", "type")
  WHERE "deletedAt" IS NULL;
```

In `schema.prisma`, the `@@unique([employeeId, date, type])` line is removed and
replaced with a comment pointing to the raw partial index in the migration, so
`prisma migrate diff` stays clean (we mark it with `@@ignore`-style doc, and the
migration is hand-edited + verified against `prisma migrate status`).

LeaveRequest and CashAdvance have no unique constraints, so they need no partial
index.

## 5. Read-path strategy — explicit + extension backstop

Pure Prisma `$extends` global filters have a known hole: they **do not filter
nested `include`d relations** (`employee.findMany({ include: { attendances } })`
would leak voided rows). Therefore a two-layer approach:

1. **Explicit `deletedAt: null`** at the load-bearing read sites:
   - Payroll calculation (all attendance/advance aggregation)
   - `src/lib/advance/balance.ts` (advance balance — must exclude voided)
   - Leave / Attendance / Advance admin list pages
   - LIFF list pages (`/liff/leave`, `/liff/advance`, attendance history)
2. **A Prisma `$extends` query filter** on the 3 models as defense-in-depth for
   top-level `findMany` / `findFirst` / `findUnique` / `count` / `aggregate`.
   The extended client is exported from `src/lib/db/prisma.ts`.
3. **A `withDeleted` escape hatch** for the void/restore actions and the trash
   view — implemented as a second unextended client export (e.g.
   `prismaRaw`) used *only* by those code paths.

### 5.1 Regression tests are mandatory here
Tests assert that a voided Attendance row never reaches payroll calc, and a
voided CashAdvance never reaches `computeAdvanceBalance`. These pin the
correctness guarantee that the silent-leak failure mode is closed.

## 6. Void + restore actions and guard rules

New server actions (in the existing `lib/attendance`, `lib/leave`,
`lib/advance` modules):

| Action | Permission (+ ctx) | Guards |
| --- | --- | --- |
| `voidAttendance(id, reason)` | `attendance.void`, `{ branchId: emp.branchId }` | reason required; cannot void an already-voided row |
| `voidLeaveRequest(id, reason)` | `leave.void`, `{ branchId: emp.branchId }` | **cascade**: also soft-deletes the generated `Attendance(OnLeave)` rows in the same transaction |
| `voidCashAdvance(id, reason)` | `advance.void`, `{ branchId: emp.branchId }` | **block** if `isDeducted: true` → refuse with "reverse the payroll first" |
| `restore*(id)` | same void perm | re-checks the Attendance partial-unique slot is still free before restoring; leave restore recreates the OnLeave rows |

Every action:
- requires a non-empty `deleteReason` (trimmed, max length validated)
- writes `deletedAt = now()`, `deletedById = user.id`, `deleteReason`
- writes an audit entry via `auditLogTx` with `before` = full row snapshot,
  `after` = `{ deletedAt, deletedById, deleteReason }` — so the row's full
  contents are recoverable from the audit log even without a restore
- runs inside `prisma.$transaction` when cascading (leave)

### 6.1 Branch-scoping note
Existing admin actions call `requirePermission('leave.approve')` **without** a
branch context, i.e. they currently grant any-branch. The new void actions pass
`{ branchId: emp.branchId }` so an Admin can only void records for employees in
their own branch; Superadmin (global assignment) passes any branch check. This
is the Phase 3.7 "Admin acts within their branch" model already wired into
`canDo()`.

## 7. Permissions — 3 new keys

Add to `src/lib/auth/permissions.ts` (label map) and grant in the Admin +
Superadmin defaults there and in `src/lib/auth/roles.ts`:

```
'attendance.void' : 'ลบ/ยกเลิกรายการลงเวลา'
'leave.void'      : 'ลบ/ยกเลิกคำขอลา (รวมรายการลงเวลาที่สร้างอัตโนมัติ)'
'advance.void'    : 'ลบ/ยกเลิกคำขอเบิก'
```

A data migration grants the three new keys to existing Admin + Superadmin role
definitions (mirrors the Phase-3 backfill migrations like 0010).

## 8. UI (Sapphire Editorial design system)

- **Row action** "ลบ" behind a **confirm dialog with a required reason field**
  (the danger-zone pattern from the Team-edit mockup — escalating severity,
  amber→danger).
- **"ถังขยะ / Recently deleted"** filter tab on each admin list (Attendance,
  Leave, Advance) → per-row **restore** button.
- **Void banner** on detail/audit views: who voided, when, and why.
- Voided rows are **excluded from all default lists, KPIs, and exports** (read
  strategy §5).

## 9. Migration plan (phased)

1. **Schema + partial index** — add columns, `@@index([deletedAt])`, hand-edit
   the Attendance partial-unique migration. Verify `prisma migrate status`.
2. **Read-path hardening** — add explicit `deletedAt: null` to payroll, balance,
   admin lists, LIFF lists; add the `$extends` backstop; add `prismaRaw`. Land
   regression tests first (TDD).
3. **Permissions** — new keys + defaults + backfill data migration.
4. **Void/restore actions** — `lib/*` actions + guards + audit + cascade/block.
   Unit + integration tests mirroring the existing approval specs.
5. **Admin UI** — confirm-with-reason dialogs, trash tabs, restore, void banner.
6. **Docs** — update `docs/user-guide/` (Thai) with the void/restore flow.

## 10. Risks & open questions

- **Partial unique index drift.** Prisma can't model partial-unique, so the
  hand-edited migration must be guarded by a test that inserts a voided + a live
  row with the same `(employeeId, date, type)` and asserts the live one is still
  unique-protected.
- **Nested include leaks.** Any `include: { attendances | leaveRequests |
  cashAdvances }` site must add a relation-level `where: { deletedAt: null }`.
  An audit grep is part of step 2's definition of done.
- **Restore conflicts.** If, between void and restore, a *new* correct row was
  entered for the same Attendance slot, restore must fail gracefully with a
  clear message rather than throwing a raw unique violation.
- **Leave restore fidelity.** Recreating the OnLeave attendance rows on restore
  must reproduce the exact `durationMinutes` / holiday-substitution outcome the
  original approval produced. Safer to snapshot the generated rows in the audit
  `before` and recreate from that snapshot than to re-run the generator.

## 11. Definition of done

- Voided Attendance/Advance never appear in payroll, balance, KPIs, exports
  (tests prove it).
- Admin can void a wrong Attendance row and immediately enter the correct one
  (partial-unique test proves it).
- Voiding an approved leave removes its OnLeave attendance; restore brings both
  back.
- Voiding a deducted advance is refused with a clear message.
- Admin is branch-scoped; Superadmin is global.
- Every void/restore writes an audit entry with a full before-snapshot.
