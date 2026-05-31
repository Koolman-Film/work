# Soft-delete / Void for Transactional Records — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let branch-scoped Admins and Superadmins void (soft-delete) and restore wrong Attendance, LeaveRequest, and CashAdvance records without corrupting payroll or losing the audit trail.

**Architecture:** Add `deletedAt`/`deletedById`/`deleteReason` to the three models. A Postgres *partial* unique index keeps the Attendance `(employeeId, date, type)` slot free once a row is voided so the correct row can be re-entered. Reads exclude voided rows two ways: explicit `deletedAt: null` at load-bearing sites (payroll, balance, lists) plus a Prisma `$extends` backstop for top-level finds. A separate unextended `prismaRaw` client serves the void/restore/trash paths. Void actions require a reason, write audit, cascade for leave (also void generated OnLeave rows), and block when an advance is already deducted.

**Tech Stack:** Next.js 16 App Router, Prisma 6, Supabase Postgres, vitest (pure units), Playwright (DB-backed e2e), Biome.

**Spec:** `docs/superpowers/specs/2026-05-29-soft-delete-transactional-records-design.md`

---

## File Structure

**Create:**
- `prisma/migrations/0014_soft_delete_transactional/migration.sql` — columns + indexes + partial unique
- `prisma/migrations/0015_void_permissions_backfill/migration.sql` — grant new perms to existing Admin/Superadmin roles
- `src/lib/db/soft-delete-extension.ts` — the `$extends` query filter
- `src/lib/attendance/void.ts` — `voidAttendance`, `restoreAttendance`
- `src/lib/attendance/void-guards.ts` — pure voidability predicates
- `src/lib/leave/void.ts` — `voidLeaveRequest`, `restoreLeaveRequest`
- `src/lib/advance/void.ts` — `voidCashAdvance`, `restoreCashAdvance`
- `src/lib/advance/void-guards.ts` — pure `assertAdvanceVoidable`
- `src/lib/advance/void-guards.test.ts` — vitest
- `src/components/admin/void-dialog.tsx` — confirm-with-reason dialog
- `tests/e2e/admin-attendance-void.spec.ts`
- `tests/e2e/admin-leave-void.spec.ts`
- `tests/e2e/admin-advance-void.spec.ts`
- `tests/e2e/soft-delete-readpath.spec.ts` — partial index + extension + payroll/balance exclusion

**Modify:**
- `prisma/schema.prisma` — 3 models get the columns; Attendance `@@unique` removed (replaced by partial index in migration)
- `src/lib/db/prisma.ts` — export `prismaRaw` (base) + `prisma` (extended)
- `src/lib/audit/log.ts` — add 6 audit action strings
- `src/lib/auth/permissions.ts` — 3 keys + labels + groups + role defaults
- `src/lib/auth/roles.ts` — 3 keys in Admin/Superadmin defaults
- `src/lib/advance/balance-data.ts` (or the query site that builds `reservedAdvances`) — add `deletedAt: null`
- Admin list pages for attendance/leave/advance — void/restore/trash UI
- `docs/user-guide/` — Thai how-to

---

## Phase 1 — Schema + partial unique index

### Task 1: Add soft-delete columns and the Attendance partial unique index

**Files:**
- Modify: `prisma/schema.prisma` (Attendance ~360-400, LeaveRequest ~413-433, CashAdvance ~435-454)
- Create: `prisma/migrations/0014_soft_delete_transactional/migration.sql`
- Test: `tests/e2e/soft-delete-readpath.spec.ts`

- [ ] **Step 1: Edit schema — Attendance.** Remove the line `@@unique([employeeId, date, type])` and add the columns + index. The block's trailing `@@` lines become:

```prisma
  deletedAt         DateTime?
  deletedById       String?   @db.Uuid
  deleteReason      String?

  createdAt         DateTime  @default(now())
  createdById       String    @db.Uuid

  // NOTE: the (employeeId, date, type) uniqueness is enforced by a PARTIAL
  // unique index `WHERE "deletedAt" IS NULL` created in migration 0014.
  // Prisma's schema DSL cannot express partial-unique, so it lives in raw
  // SQL. Do not re-add @@unique here — it would conflict with the partial index.
  @@index([date])
  @@index([employeeId, date])
  @@index([checkInStatus])
  @@index([deletedAt])
```

- [ ] **Step 2: Edit schema — LeaveRequest.** Add before the `@@index` lines:

```prisma
  deletedAt     DateTime?
  deletedById   String?   @db.Uuid
  deleteReason  String?
  attendances   Attendance[]

  @@index([employeeId, status])
  @@index([status])
  @@index([deletedAt])
```
(Keep the existing `attendances Attendance[]` — do not duplicate it; merge the new columns above the relation if it already sits there.)

- [ ] **Step 3: Edit schema — CashAdvance.** Add before its `@@index` lines:

```prisma
  deletedAt           DateTime?
  deletedById         String?   @db.Uuid
  deleteReason        String?

  @@index([employeeId, status])
  @@index([status])
  @@index([isDeducted])
  @@index([deletedAt])
```

- [ ] **Step 4: Create the migration SQL by hand.** Create `prisma/migrations/0014_soft_delete_transactional/migration.sql`:

```sql
-- ─── 0014 — Soft-delete columns for transactional records ─────────────────
--
-- Adds deletedAt/deletedById/deleteReason to Attendance, LeaveRequest,
-- CashAdvance. Replaces Attendance's plain unique with a PARTIAL unique
-- index so a voided row frees its (employeeId, date, type) slot, letting an
-- admin enter the correct row. See spec §4.1.

-- Attendance
ALTER TABLE "Attendance" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Attendance" ADD COLUMN "deletedById" UUID;
ALTER TABLE "Attendance" ADD COLUMN "deleteReason" TEXT;

DROP INDEX IF EXISTS "Attendance_employeeId_date_type_key";
CREATE UNIQUE INDEX "Attendance_employeeId_date_type_live_key"
  ON "Attendance" ("employeeId", "date", "type")
  WHERE "deletedAt" IS NULL;
CREATE INDEX "Attendance_deletedAt_idx" ON "Attendance" ("deletedAt");

-- LeaveRequest
ALTER TABLE "LeaveRequest" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "LeaveRequest" ADD COLUMN "deletedById" UUID;
ALTER TABLE "LeaveRequest" ADD COLUMN "deleteReason" TEXT;
CREATE INDEX "LeaveRequest_deletedAt_idx" ON "LeaveRequest" ("deletedAt");

-- CashAdvance
ALTER TABLE "CashAdvance" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CashAdvance" ADD COLUMN "deletedById" UUID;
ALTER TABLE "CashAdvance" ADD COLUMN "deleteReason" TEXT;
CREATE INDEX "CashAdvance_deletedAt_idx" ON "CashAdvance" ("deletedAt");
```

- [ ] **Step 5: Regenerate the client and verify migration status.**

Run: `pnpm db:generate && dotenv -e .env.local -- prisma migrate status`
Expected: client regenerates; status shows `0014_soft_delete_transactional` as the latest applied-or-pending migration with no drift errors. If it reports "schema drift" on the index name, confirm the schema comment (Step 1) has NO `@@unique` line.

- [ ] **Step 6: Write the partial-index e2e test.** Create `tests/e2e/soft-delete-readpath.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

test.describe('Soft-delete read-path semantics', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  async function seedEmployee(suffix: string) {
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${suffix}` } });
    const user = await prisma.user.create({ data: {} });
    const employee = await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: `e2e-First-${suffix}`,
        lastName: `e2e-Last-${suffix}`,
        branchId: branch.id,
        assignedBranchIds: [branch.id],
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20_000),
        status: 'Active',
        canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });
    return { employee, user, branch };
  }

  test('partial unique index frees the slot after void', async () => {
    const s = e2eId();
    const { employee, user } = await seedEmployee(s);
    const date = new Date('2026-05-20');

    const first = await prisma.attendance.create({
      data: { employeeId: employee.id, date, type: 'Late', source: 'Manual', createdById: user.id },
    });

    // While the row is live, a duplicate (employee,date,type) must fail.
    await expect(
      prisma.attendance.create({
        data: { employeeId: employee.id, date, type: 'Late', source: 'Manual', createdById: user.id },
      }),
    ).rejects.toThrow();

    // Void the first row.
    await prisma.attendance.update({ where: { id: first.id }, data: { deletedAt: new Date() } });

    // Now the same slot must accept a new live row.
    const second = await prisma.attendance.create({
      data: { employeeId: employee.id, date, type: 'Late', source: 'Manual', createdById: user.id },
    });
    expect(second.id).not.toBe(first.id);
  });
});
```

- [ ] **Step 7: Run the test.**

Run: `pnpm test:e2e -- soft-delete-readpath`
Expected: PASS (the duplicate rejects while live; the second insert succeeds after void).

- [ ] **Step 8: Commit.**

```bash
git add prisma/schema.prisma prisma/migrations/0014_soft_delete_transactional tests/e2e/soft-delete-readpath.spec.ts
git commit -m "feat(db): soft-delete columns + Attendance partial unique index (0014)"
```

---

## Phase 2 — Read-path hardening

### Task 2: Split the Prisma client into `prismaRaw` (base) + `prisma` (soft-delete-filtered)

**Files:**
- Create: `src/lib/db/soft-delete-extension.ts`
- Modify: `src/lib/db/prisma.ts`

- [ ] **Step 1: Write the extension.** Create `src/lib/db/soft-delete-extension.ts`:

```ts
import { Prisma } from '@prisma/client';

/**
 * Backstop filter: excludes voided rows from top-level reads on the three
 * soft-deletable models. This is defence-in-depth — load-bearing read sites
 * (payroll, balance, lists) ALSO add explicit `deletedAt: null`, because this
 * extension does NOT filter nested `include`d relations (a known Prisma
 * limitation). See spec §5.
 *
 * Bypass: code that must SEE voided rows (void/restore actions, trash views)
 * uses `prismaRaw` from ./prisma, which is unextended.
 */
const SOFT_DELETE_MODELS = new Set(['Attendance', 'LeaveRequest', 'CashAdvance']);
const READ_OPS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate']);

export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete-filter',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (model && SOFT_DELETE_MODELS.has(model) && READ_OPS.has(operation)) {
          const a = (args ?? {}) as { where?: Record<string, unknown> };
          a.where = { ...a.where, deletedAt: a.where?.deletedAt ?? null };
          return query(a);
        }
        return query(args);
      },
    },
  },
});
```

- [ ] **Step 2: Rewire `prisma.ts`.** Replace the contents of `src/lib/db/prisma.ts` with:

```ts
/**
 * Prisma client singletons.
 *
 * `prismaRaw` — base client, sees ALL rows including soft-deleted. Use ONLY
 *   in void/restore actions and trash views.
 * `prisma`    — base + soft-delete filter extension. Default for all reads.
 *
 * Singleton rationale (HMR pool exhaustion) unchanged — see git history.
 */
import { PrismaClient } from '@prisma/client';
import { softDeleteExtension } from './soft-delete-extension';

const globalForPrisma = globalThis as unknown as {
  prismaRaw: PrismaClient | undefined;
};

export const prismaRaw =
  globalForPrisma.prismaRaw ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaRaw = prismaRaw;
}

export const prisma = prismaRaw.$extends(softDeleteExtension);
```

- [ ] **Step 3: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS. (Existing imports of `prisma` keep working; `$extends` returns a client with the same model methods. If any call site used a Prisma type like `Prisma.TransactionClient`, those are unaffected — transactions still use `prisma.$transaction`.)

- [ ] **Step 4: Commit.**

```bash
git add src/lib/db/prisma.ts src/lib/db/soft-delete-extension.ts
git commit -m "feat(db): soft-delete query extension + prismaRaw escape hatch"
```

### Task 3: Prove voided rows are excluded from balance and payroll

**Files:**
- Modify: the query site that builds `reservedAdvances` for `calculateAdvanceBalance` (find with: `grep -rn "reservedAdvances\|calculateAdvanceBalance" src --include=*.ts`)
- Test: `tests/e2e/soft-delete-readpath.spec.ts` (extend)

- [ ] **Step 1: Locate and read the balance query site.**

Run: `grep -rn "calculateAdvanceBalance\|status: { in: \['Pending', 'Approved'\] }" src --include=*.ts`
Read the file that loads CashAdvance rows feeding `calculateAdvanceBalance` (the LIFF advance page / a `balance-data.ts` helper).

- [ ] **Step 2: Add explicit `deletedAt: null` to that query.** In the `prisma.cashAdvance.findMany({ where: { ... } })` that builds the reserved set, add `deletedAt: null` to the `where`. Example shape:

```ts
const reserved = await prisma.cashAdvance.findMany({
  where: {
    employeeId: employee.id,
    status: { in: ['Pending', 'Approved'] },
    isDeducted: false,
    deletedAt: null, // exclude voided — defence beyond the extension backstop
  },
  select: { status: true, amount: true },
});
```

- [ ] **Step 3: Add the exclusion e2e test** to `tests/e2e/soft-delete-readpath.spec.ts` inside the same `describe`:

```ts
  test('voided advance is excluded from reserved balance query', async () => {
    const s = e2eId();
    const { employee } = await seedEmployee(s);

    const live = await prisma.cashAdvance.create({
      data: { employeeId: employee.id, amount: new Prisma.Decimal(3000), status: 'Pending' },
    });
    const voided = await prisma.cashAdvance.create({
      data: {
        employeeId: employee.id,
        amount: new Prisma.Decimal(5000),
        status: 'Pending',
        deletedAt: new Date(),
      },
    });

    // The default (extended) client must not see the voided row.
    const visible = await prisma.cashAdvance.findMany({
      where: { employeeId: employee.id, status: 'Pending' },
      select: { id: true },
    });
    const ids = visible.map((r) => r.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(voided.id);
  });
```

- [ ] **Step 4: Run the test.**

Run: `pnpm test:e2e -- soft-delete-readpath`
Expected: PASS (both tests).

- [ ] **Step 5: Audit nested includes.** Run:

`grep -rn "include:\s*{[^}]*\(attendances\|leaveRequests\|cashAdvances\|attendance\b\)" src --include=*.ts --include=*.tsx`

For each hit that renders user-facing live data, add `where: { deletedAt: null }` to that nested relation (the extension does not cover nested includes). If a hit is inside a void/restore/trash path, leave it. Note each change in the commit body.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "fix(advance): exclude voided rows from balance + nested-include audit"
```

---

## Phase 3 — Permissions

### Task 4: Add the three void permission keys

**Files:**
- Modify: `src/lib/auth/permissions.ts`, `src/lib/auth/roles.ts`, `src/lib/audit/log.ts`
- Test: `src/lib/auth/permissions.test.ts` (create if absent)

- [ ] **Step 1: Add audit actions.** In `src/lib/audit/log.ts`, in the `AuditAction` union under `// Leave & advance` and `// Attendance`, add:

```ts
  | 'attendance.void'
  | 'attendance.restore'
  | 'leave.void'
  | 'leave.restore'
  | 'advance.void'
  | 'advance.restore'
```

- [ ] **Step 2: Add permission keys + labels.** In `src/lib/auth/permissions.ts` `PERMISSIONS` object:

```ts
  'attendance.void': 'ลบ/ยกเลิกรายการลงเวลา',
  'leave.void': 'ลบ/ยกเลิกคำขอลา (รวมรายการลงเวลาที่สร้างอัตโนมัติ)',
  'advance.void': 'ลบ/ยกเลิกคำขอเบิก',
```
(Place each next to its sibling — `attendance.void` under the attendance block, etc.)

- [ ] **Step 3: Add to PERMISSION_GROUPS.** In the same file, append the new key to each matching group's `permissions` array: `'attendance.void'` to the `attendance` group, `'leave.void'` to `leave`, `'advance.void'` to `advance`.

- [ ] **Step 4: Add to role defaults.** In `src/lib/auth/roles.ts`, add `'attendance.void'`, `'leave.void'`, `'advance.void'` to BOTH the Admin and Superadmin default permission arrays (find the arrays containing `'leave.approve'`).

- [ ] **Step 5: Write the unit test.** Create/append `src/lib/auth/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from './permissions';
import { ADMIN_DEFAULT_PERMISSIONS, SUPERADMIN_DEFAULT_PERMISSIONS } from './roles';

describe('void permissions', () => {
  it('registers the three void keys with Thai labels', () => {
    expect(PERMISSIONS['attendance.void']).toBeTruthy();
    expect(PERMISSIONS['leave.void']).toBeTruthy();
    expect(PERMISSIONS['advance.void']).toBeTruthy();
  });

  it('grants void to Admin and Superadmin defaults', () => {
    for (const key of ['attendance.void', 'leave.void', 'advance.void'] as const) {
      expect(ADMIN_DEFAULT_PERMISSIONS).toContain(key);
      expect(SUPERADMIN_DEFAULT_PERMISSIONS).toContain(key);
    }
  });
});
```
(If the exported names in `roles.ts` differ, adjust the imports to the actual exported constant names — open `roles.ts` to confirm.)

- [ ] **Step 6: Run the test.**

Run: `pnpm test -- permissions`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/auth/permissions.ts src/lib/auth/roles.ts src/lib/auth/permissions.test.ts src/lib/audit/log.ts
git commit -m "feat(auth): attendance/leave/advance void permissions + audit actions"
```

### Task 5: Backfill the void permissions onto existing role rows

**Files:**
- Create: `prisma/migrations/0015_void_permissions_backfill/migration.sql`

- [ ] **Step 1: Write the migration.** Create `prisma/migrations/0015_void_permissions_backfill/migration.sql`:

```sql
-- ─── 0015 — Grant void permissions to existing Admin/Superadmin roles ──────
-- Idempotent: array_append only if the key is absent. Mirrors 0010.

UPDATE "RoleDefinition"
SET "permissions" = "permissions" || ARRAY['attendance.void','leave.void','advance.void']
WHERE "key" IN ('admin','superadmin')
  AND NOT ("permissions" @> ARRAY['attendance.void']);
```
(Confirm the column name `permissions` and the system role `key` values by reading `prisma/migrations/0010_admin_role_perms_sync/migration.sql` first; match its exact column/key spelling.)

- [ ] **Step 2: Apply and verify.**

Run: `pnpm db:deploy && dotenv -e .env.local -- prisma migrate status`
Expected: `0015` applied; status clean.

- [ ] **Step 3: Commit.**

```bash
git add prisma/migrations/0015_void_permissions_backfill
git commit -m "feat(auth): backfill void perms onto Admin/Superadmin roles (0015)"
```

---

## Phase 4 — Void / restore actions

### Task 6: Pure voidability guards (advance block, already-voided)

**Files:**
- Create: `src/lib/advance/void-guards.ts`, `src/lib/advance/void-guards.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/lib/advance/void-guards.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertAdvanceVoidable } from './void-guards';

describe('assertAdvanceVoidable', () => {
  it('allows voiding a non-deducted, live advance', () => {
    expect(assertAdvanceVoidable({ isDeducted: false, deletedAt: null })).toEqual({ ok: true });
  });

  it('blocks voiding an already-deducted advance', () => {
    const r = assertAdvanceVoidable({ isDeducted: true, deletedAt: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('already-deducted');
  });

  it('blocks voiding an already-voided advance', () => {
    const r = assertAdvanceVoidable({ isDeducted: false, deletedAt: new Date() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('already-voided');
  });
});
```

- [ ] **Step 2: Run it — verify it fails.**

Run: `pnpm test -- void-guards`
Expected: FAIL ("Cannot find module './void-guards'").

- [ ] **Step 3: Implement.** Create `src/lib/advance/void-guards.ts`:

```ts
export type VoidGuardResult =
  | { ok: true }
  | { ok: false; code: 'already-deducted' | 'already-voided'; message: string };

export function assertAdvanceVoidable(a: {
  isDeducted: boolean;
  deletedAt: Date | null;
}): VoidGuardResult {
  if (a.deletedAt) {
    return { ok: false, code: 'already-voided', message: 'รายการนี้ถูกลบไปแล้ว' };
  }
  if (a.isDeducted) {
    return {
      ok: false,
      code: 'already-deducted',
      message: 'ไม่สามารถลบได้ — คำขอนี้ถูกหักในรอบเงินเดือนแล้ว กรุณายกเลิกรอบเงินเดือนก่อน',
    };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run it — verify it passes.**

Run: `pnpm test -- void-guards`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/advance/void-guards.ts src/lib/advance/void-guards.test.ts
git commit -m "feat(advance): pure voidability guard"
```

### Task 7: `voidAttendance` + `restoreAttendance`

**Files:**
- Create: `src/lib/attendance/void.ts`
- Test: `tests/e2e/admin-attendance-void.spec.ts`

- [ ] **Step 1: Implement the actions.** Create `src/lib/attendance/void.ts`:

```ts
'use server';

import { headers } from 'next/headers';
import { requirePermission } from '@/lib/auth/check-permission';
import { auditLogTx, Prisma } from '@/lib/audit/log';
import { prisma, prismaRaw } from '@/lib/db/prisma';

export type VoidResult =
  | { ok: true }
  | { ok: false; code: 'not-found' | 'forbidden' | 'already-voided' | 'reason-required' | 'error'; message: string };

async function reqMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

export async function voidAttendance(id: string, reason: string): Promise<VoidResult> {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) return { ok: false, code: 'reason-required', message: 'กรุณาระบุเหตุผล' };

  // prismaRaw: we must SEE the row even if (defensively) already voided.
  const row = await prismaRaw.attendance.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, employee: { select: { branchId: true } } },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบรายการลงเวลา' };
  if (row.deletedAt) return { ok: false, code: 'already-voided', message: 'รายการนี้ถูกลบไปแล้ว' };

  // Branch-scoped: Admin must hold attendance.void for THIS employee's branch.
  const { user } = await requirePermission('attendance.void', { branchId: row.employee.branchId });
  const meta = await reqMeta();

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.attendance.findUnique({ where: { id } });
      await tx.attendance.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: user.id, deleteReason: trimmed },
      });
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'attendance.void',
        entityType: 'Attendance',
        entityId: id,
        before: before as unknown as Prisma.JsonValue,
        after: { deletedById: user.id, deleteReason: trimmed },
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true };
  } catch (err) {
    console.error('[voidAttendance] failed', err);
    return { ok: false, code: 'error', message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}

export async function restoreAttendance(id: string): Promise<VoidResult> {
  const row = await prismaRaw.attendance.findUnique({
    where: { id },
    select: {
      id: true, deletedAt: true, employeeId: true, date: true, type: true,
      employee: { select: { branchId: true } },
    },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบรายการลงเวลา' };
  if (!row.deletedAt) return { ok: true }; // already live — idempotent

  const { user } = await requirePermission('attendance.void', { branchId: row.employee.branchId });

  // The slot may have been re-filled while this row was voided.
  const live = await prismaRaw.attendance.findFirst({
    where: { employeeId: row.employeeId, date: row.date, type: row.type, deletedAt: null },
    select: { id: true },
  });
  if (live) {
    return {
      ok: false,
      code: 'error',
      message: 'กู้คืนไม่ได้ — มีรายการที่ถูกต้องสำหรับวันและประเภทนี้อยู่แล้ว',
    };
  }

  const meta = await reqMeta();
  await prisma.$transaction(async (tx) => {
    await tx.attendance.update({
      where: { id },
      data: { deletedAt: null, deletedById: null, deleteReason: null },
    });
    await auditLogTx(tx, {
      actorId: user.id,
      action: 'attendance.restore',
      entityType: 'Attendance',
      entityId: id,
      metadata: { ...meta, source: 'admin-ui' },
    });
  });
  return { ok: true };
}
```

- [ ] **Step 2: Write the e2e test.** Create `tests/e2e/admin-attendance-void.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';
import { voidAttendance, restoreAttendance } from '@/lib/attendance/void';

// NOTE: these call the server actions directly (no browser) to test the
// data contract. requirePermission resolves the session via cookies; for
// direct-call tests we seed a Superadmin context using the existing
// helper. If the repo lacks a session-injecting helper for server actions,
// convert this to a UI-driven spec using loginAsAdmin + page clicks.

test.describe('voidAttendance / restoreAttendance', () => {
  test.afterAll(async () => { await cleanupE2eRecords(); });

  test('void frees the unique slot; restore is blocked if slot re-filled', async () => {
    const s = e2eId();
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${s}` } });
    const user = await prisma.user.create({ data: {} });
    const employee = await prisma.employee.create({
      data: {
        userId: user.id, firstName: `e2e-${s}`, lastName: 'V', branchId: branch.id,
        assignedBranchIds: [branch.id], salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20000), status: 'Active', canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });
    const date = new Date('2026-05-21');
    const wrong = await prisma.attendance.create({
      data: { employeeId: employee.id, date, type: 'Late', source: 'Manual', createdById: user.id },
    });

    const v = await voidAttendance(wrong.id, 'ใส่ผิดวัน');
    expect(v.ok).toBe(true);

    // Slot is free — enter the correct row.
    const correct = await prisma.attendance.create({
      data: { employeeId: employee.id, date, type: 'Late', source: 'Manual', createdById: user.id },
    });
    expect(correct.id).not.toBe(wrong.id);

    // Restoring the wrong row must now fail (slot occupied).
    const r = await restoreAttendance(wrong.id);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run it.**

Run: `pnpm test:e2e -- admin-attendance-void`
Expected: PASS. If `requirePermission` rejects because the direct-call test has no session, follow the NOTE in the spec and switch to the UI-driven form (Task 11 wires the button) or add a session helper; commit the seam either way.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/attendance/void.ts tests/e2e/admin-attendance-void.spec.ts
git commit -m "feat(attendance): voidAttendance + restoreAttendance with slot-reclaim guard"
```

### Task 8: `voidLeaveRequest` (cascade) + `restoreLeaveRequest` (snapshot)

**Files:**
- Create: `src/lib/leave/void.ts`
- Test: `tests/e2e/admin-leave-void.spec.ts`

- [ ] **Step 1: Implement.** Create `src/lib/leave/void.ts`:

```ts
'use server';

import { headers } from 'next/headers';
import { requirePermission } from '@/lib/auth/check-permission';
import { auditLogTx, Prisma } from '@/lib/audit/log';
import { prisma, prismaRaw } from '@/lib/db/prisma';

export type VoidResult =
  | { ok: true; voidedAttendanceCount?: number }
  | { ok: false; code: 'not-found' | 'forbidden' | 'already-voided' | 'reason-required' | 'error'; message: string };

async function reqMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

export async function voidLeaveRequest(id: string, reason: string): Promise<VoidResult> {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) return { ok: false, code: 'reason-required', message: 'กรุณาระบุเหตุผล' };

  const row = await prismaRaw.leaveRequest.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, status: true, employee: { select: { branchId: true } } },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอลา' };
  if (row.deletedAt) return { ok: false, code: 'already-voided', message: 'คำขอนี้ถูกลบไปแล้ว' };

  const { user } = await requirePermission('leave.void', { branchId: row.employee.branchId });
  const meta = await reqMeta();
  const now = new Date();

  try {
    let voidedAttendanceCount = 0;
    await prisma.$transaction(async (tx) => {
      // Cascade: void the generated OnLeave attendance rows. Snapshot them
      // into the audit `before` so restore can recreate exactly (spec §10).
      const generated = await tx.attendance.findMany({
        where: { leaveRequestId: id, deletedAt: null },
      });
      if (generated.length > 0) {
        await tx.attendance.updateMany({
          where: { leaveRequestId: id, deletedAt: null },
          data: { deletedAt: now, deletedById: user.id, deleteReason: `leave.void:${id}` },
        });
        voidedAttendanceCount = generated.length;
      }
      await tx.leaveRequest.update({
        where: { id },
        data: { deletedAt: now, deletedById: user.id, deleteReason: trimmed },
      });
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'leave.void',
        entityType: 'LeaveRequest',
        entityId: id,
        before: { status: row.status, generatedAttendance: generated } as unknown as Prisma.JsonValue,
        after: { deletedById: user.id, deleteReason: trimmed, voidedAttendanceCount },
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true, voidedAttendanceCount };
  } catch (err) {
    console.error('[voidLeaveRequest] failed', err);
    return { ok: false, code: 'error', message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}

export async function restoreLeaveRequest(id: string): Promise<VoidResult> {
  const row = await prismaRaw.leaveRequest.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, employee: { select: { branchId: true } } },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอลา' };
  if (!row.deletedAt) return { ok: true };

  const { user } = await requirePermission('leave.void', { branchId: row.employee.branchId });
  const meta = await reqMeta();

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id },
      data: { deletedAt: null, deletedById: null, deleteReason: null },
    });
    // Restore the cascade-voided attendance rows tagged with this leave id.
    await tx.attendance.updateMany({
      where: { leaveRequestId: id, deleteReason: `leave.void:${id}` },
      data: { deletedAt: null, deletedById: null, deleteReason: null },
    });
    await auditLogTx(tx, {
      actorId: user.id,
      action: 'leave.restore',
      entityType: 'LeaveRequest',
      entityId: id,
      metadata: { ...meta, source: 'admin-ui' },
    });
  });
  return { ok: true };
}
```

- [ ] **Step 2: Write the e2e test.** Create `tests/e2e/admin-leave-void.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';
import { voidLeaveRequest, restoreLeaveRequest } from '@/lib/leave/void';

test.describe('voidLeaveRequest cascade', () => {
  test.afterAll(async () => { await cleanupE2eRecords(); });

  test('voiding approved leave also voids its OnLeave attendance; restore brings both back', async () => {
    const s = e2eId();
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${s}` } });
    const u = await prisma.user.create({ data: {} });
    const emp = await prisma.employee.create({
      data: {
        userId: u.id, firstName: `e2e-${s}`, lastName: 'L', branchId: branch.id,
        assignedBranchIds: [branch.id], salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20000), status: 'Active', canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });
    const lt = await prisma.leaveType.create({ data: { name: `e2e-LT-${s}`, isPaid: true } });
    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id, leaveTypeId: lt.id, startDate: new Date('2026-05-25'),
        endDate: new Date('2026-05-25'), reason: 'x', status: 'Approved',
      },
    });
    await prisma.attendance.create({
      data: {
        employeeId: emp.id, date: new Date('2026-05-25'), type: 'OnLeave',
        source: 'Manual', leaveRequestId: leave.id, createdById: u.id,
      },
    });

    const v = await voidLeaveRequest(leave.id, 'อนุมัติผิดคน');
    expect(v.ok).toBe(true);

    // Default client must not see the leave nor its OnLeave attendance.
    expect(await prisma.leaveRequest.findUnique({ where: { id: leave.id } })).toBeNull();
    const liveOnLeave = await prisma.attendance.findMany({ where: { leaveRequestId: leave.id } });
    expect(liveOnLeave).toHaveLength(0);

    const r = await restoreLeaveRequest(leave.id);
    expect(r.ok).toBe(true);
    const back = await prisma.attendance.findMany({ where: { leaveRequestId: leave.id } });
    expect(back).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run it.**

Run: `pnpm test:e2e -- admin-leave-void`
Expected: PASS. (Same session NOTE as Task 7 applies.)

- [ ] **Step 4: Commit.**

```bash
git add src/lib/leave/void.ts tests/e2e/admin-leave-void.spec.ts
git commit -m "feat(leave): voidLeaveRequest cascade + snapshot restore"
```

### Task 9: `voidCashAdvance` (isDeducted block) + `restoreCashAdvance`

**Files:**
- Create: `src/lib/advance/void.ts`
- Test: `tests/e2e/admin-advance-void.spec.ts`

- [ ] **Step 1: Implement.** Create `src/lib/advance/void.ts`:

```ts
'use server';

import { headers } from 'next/headers';
import { requirePermission } from '@/lib/auth/check-permission';
import { auditLogTx, Prisma } from '@/lib/audit/log';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { assertAdvanceVoidable } from './void-guards';

export type VoidResult =
  | { ok: true }
  | { ok: false; code: 'not-found' | 'forbidden' | 'already-voided' | 'already-deducted' | 'reason-required' | 'error'; message: string };

async function reqMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

export async function voidCashAdvance(id: string, reason: string): Promise<VoidResult> {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) return { ok: false, code: 'reason-required', message: 'กรุณาระบุเหตุผล' };

  const row = await prismaRaw.cashAdvance.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, isDeducted: true, status: true, employee: { select: { branchId: true } } },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };

  const guard = assertAdvanceVoidable({ isDeducted: row.isDeducted, deletedAt: row.deletedAt });
  if (!guard.ok) return { ok: false, code: guard.code, message: guard.message };

  const { user } = await requirePermission('advance.void', { branchId: row.employee.branchId });
  const meta = await reqMeta();

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.cashAdvance.findUnique({ where: { id } });
      await tx.cashAdvance.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: user.id, deleteReason: trimmed },
      });
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'advance.void',
        entityType: 'CashAdvance',
        entityId: id,
        before: before as unknown as Prisma.JsonValue,
        after: { deletedById: user.id, deleteReason: trimmed },
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true };
  } catch (err) {
    console.error('[voidCashAdvance] failed', err);
    return { ok: false, code: 'error', message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}

export async function restoreCashAdvance(id: string): Promise<VoidResult> {
  const row = await prismaRaw.cashAdvance.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, employee: { select: { branchId: true } } },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };
  if (!row.deletedAt) return { ok: true };

  const { user } = await requirePermission('advance.void', { branchId: row.employee.branchId });
  const meta = await reqMeta();
  await prisma.$transaction(async (tx) => {
    await tx.cashAdvance.update({
      where: { id },
      data: { deletedAt: null, deletedById: null, deleteReason: null },
    });
    await auditLogTx(tx, {
      actorId: user.id,
      action: 'advance.restore',
      entityType: 'CashAdvance',
      entityId: id,
      metadata: { ...meta, source: 'admin-ui' },
    });
  });
  return { ok: true };
}
```

- [ ] **Step 2: Write the e2e test.** Create `tests/e2e/admin-advance-void.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';
import { voidCashAdvance } from '@/lib/advance/void';

test.describe('voidCashAdvance', () => {
  test.afterAll(async () => { await cleanupE2eRecords(); });

  async function seedAdvance(s: string, isDeducted: boolean) {
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${s}` } });
    const u = await prisma.user.create({ data: {} });
    const emp = await prisma.employee.create({
      data: {
        userId: u.id, firstName: `e2e-${s}`, lastName: 'A', branchId: branch.id,
        assignedBranchIds: [branch.id], salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20000), status: 'Active', canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });
    return prisma.cashAdvance.create({
      data: { employeeId: emp.id, amount: new Prisma.Decimal(2000), status: 'Approved', isDeducted },
    });
  }

  test('voids a non-deducted advance', async () => {
    const adv = await seedAdvance(e2eId(), false);
    const v = await voidCashAdvance(adv.id, 'อนุมัติผิด');
    expect(v.ok).toBe(true);
    expect(await prisma.cashAdvance.findUnique({ where: { id: adv.id } })).toBeNull();
  });

  test('refuses to void a deducted advance', async () => {
    const adv = await seedAdvance(e2eId(), true);
    const v = await voidCashAdvance(adv.id, 'อนุมัติผิด');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('already-deducted');
  });
});
```

- [ ] **Step 3: Run it.**

Run: `pnpm test:e2e -- admin-advance-void`
Expected: PASS (2 tests). (Session NOTE from Task 7 applies.)

- [ ] **Step 4: Commit.**

```bash
git add src/lib/advance/void.ts tests/e2e/admin-advance-void.spec.ts
git commit -m "feat(advance): voidCashAdvance with isDeducted block + restore"
```

---

## Phase 5 — Admin UI (Sapphire Editorial)

> UI uses existing components/patterns. The design tokens from the UI-redesign
> spec are NOT a prerequisite — wire behavior now with current styling; the
> token migration is a separate effort.

### Task 10: Confirm-with-reason dialog

**Files:**
- Create: `src/components/admin/void-dialog.tsx`

- [ ] **Step 1: Implement the client component.** Create `src/components/admin/void-dialog.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

type VoidActionResult = { ok: true } | { ok: false; message: string };

export function VoidDialog({
  triggerLabel,
  triggerClassName = 'text-xs font-semibold text-red-700 hover:text-red-900',
  title,
  description,
  confirmLabel = 'ลบรายการ',
  action,
  onDone,
}: {
  triggerLabel: string;
  triggerClassName?: string;
  title: string;
  description: string;
  confirmLabel?: string;
  action: (reason: string) => Promise<VoidActionResult>;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError('กรุณาระบุเหตุผล');
      return;
    }
    start(async () => {
      const r = await action(reason.trim());
      if (r.ok) {
        setOpen(false);
        setReason('');
        onDone?.();
      } else {
        setError(r.message);
      }
    });
  }

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-600">{description}</p>
            <label className="mt-4 block text-xs font-semibold text-slate-700">
              เหตุผล (จำเป็น)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
              placeholder="เช่น บันทึกผิดวัน / อนุมัติผิดคน"
            />
            {error && <p className="mt-2 text-xs font-medium text-red-700">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? 'กำลังลบ…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint.**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add src/components/admin/void-dialog.tsx
git commit -m "feat(ui): reusable confirm-with-reason void dialog"
```

### Task 11: Wire void + restore + "trash" tab into the three admin lists

**Files:**
- Modify: `src/app/(admin)/admin/attendance/*` (list/records page), `src/app/(admin)/admin/leave/page.tsx`, `src/app/(admin)/admin/advance/page.tsx`

- [ ] **Step 1: Find the three list pages.**

Run: `ls "src/app/(admin)/admin/attendance" "src/app/(admin)/admin/leave" "src/app/(admin)/admin/advance"`
Read each page to locate where rows render and what `searchParams` it already parses.

- [ ] **Step 2: Add a `?trash=1` filter to each page.** In each list page's data query, branch on `searchParams.trash`:
  - default (live): the page keeps using `prisma` (extension hides voided rows) — no change needed to see only live rows.
  - trash view: import `prismaRaw` and query `where: { ...filters, deletedAt: { not: null } }`.

Example for the advance page query block:

```tsx
import { prisma, prismaRaw } from '@/lib/db/prisma';
// ...
const isTrash = searchParams.trash === '1';
const rows = isTrash
  ? await prismaRaw.cashAdvance.findMany({
      where: { deletedAt: { not: null } /* + existing branch/status filters */ },
      include: { employee: true },
      orderBy: { deletedAt: 'desc' },
    })
  : await prisma.cashAdvance.findMany({
      where: { /* existing filters */ },
      include: { employee: true },
      orderBy: { requestedAt: 'desc' },
    });
```

- [ ] **Step 3: Add the trash toggle + per-row actions.** In each list's header add two links — `?` (live) and `?trash=1` (ถังขยะ). In each live row add the void trigger; in each trash row add a restore button. Example row action cell for advance:

```tsx
import { VoidDialog } from '@/components/admin/void-dialog';
import { voidCashAdvance, restoreCashAdvance } from '@/lib/advance/void';
// live row:
<VoidDialog
  triggerLabel="ลบ"
  title="ลบคำขอเบิก"
  description="คำขอนี้จะถูกย้ายไปถังขยะ และกู้คืนได้ภายหลัง"
  action={(reason) => voidCashAdvance(row.id, reason)}
/>
// trash row:
<form action={async () => { 'use server'; await restoreCashAdvance(row.id); }}>
  <button className="text-xs font-semibold text-brand-700">กู้คืน</button>
</form>
```
Repeat the analogous wiring for leave (`voidLeaveRequest`/`restoreLeaveRequest`) and attendance (`voidAttendance`/`restoreAttendance`). For leave, the description must warn: `"คำขอลานี้และรายการลงเวลา (OnLeave) ที่สร้างขึ้นจะถูกลบทั้งหมด"`.

- [ ] **Step 4: Revalidate after mutations.** Confirm each void/restore action calls `revalidatePath` for its list (add to the action files if missing): `revalidatePath('/admin/advance')`, `'/admin/leave'`, `'/admin/attendance'`.

- [ ] **Step 5: Typecheck + lint + build.**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 6: Manual smoke (optional but recommended).** `pnpm dev`, log in as Admin, void a row, confirm it leaves the live list and appears under ถังขยะ, restore it.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "feat(admin): void/restore actions + trash tab on attendance/leave/advance lists"
```

### Task 12: Void banner on detail views

**Files:**
- Modify: the detail/edit views for a voided record (attendance day view, leave `[id]`, advance `[id]` admin views if present)

- [ ] **Step 1: Add a banner when `deletedAt` is set.** In each detail view that can load a voided row (use `prismaRaw` to load it), render at top when `row.deletedAt`:

```tsx
{row.deletedAt && (
  <div className="mb-4 rounded-lg border-l-4 border-red-400 bg-red-50 p-3 text-sm text-red-800">
    รายการนี้ถูกลบเมื่อ {row.deletedAt.toLocaleString('th-TH')} · เหตุผล: {row.deleteReason ?? '—'}
  </div>
)}
```

- [ ] **Step 2: Typecheck + lint.**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add -A
git commit -m "feat(admin): void banner on voided record detail views"
```

---

## Phase 6 — Docs

### Task 13: Thai user-guide for void/restore

**Files:**
- Modify/Create: `docs/user-guide/` (match existing structure — run `ls docs/user-guide`)

- [ ] **Step 1: Write the section.** Add a "การลบและกู้คืนรายการ (Void/Restore)" page covering: what can be voided (attendance/leave/advance), that it requires a reason, that voiding approved leave also removes its OnLeave attendance, that a deducted advance can't be voided until payroll is reversed, and how to restore from ถังขยะ.

- [ ] **Step 2: Commit.**

```bash
git add docs/user-guide
git commit -m "docs(user-guide): void/restore for attendance, leave, advance"
```

---

## Final verification

- [ ] **Run the full unit suite.** `pnpm test` — Expected: PASS (includes void-guards, permissions).
- [ ] **Run the soft-delete e2e suite.** `pnpm test:e2e -- soft-delete-readpath admin-attendance-void admin-leave-void admin-advance-void` — Expected: PASS.
- [ ] **Typecheck + lint + build.** `pnpm typecheck && pnpm lint && pnpm build` — Expected: PASS.
- [ ] **Confirm against spec §11 Definition of Done:** voided rows excluded from balance/payroll (Task 3), Attendance slot reclaim works (Task 1/7), leave cascade + restore (Task 8), deducted-advance block (Task 9), branch-scoping (Tasks 7-9 via `requirePermission` ctx), audit on every void/restore (Tasks 7-9).
