# Leave Phase 2 — Per-employee entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every employee an editable, per-leave-type, per-year leave entitlement (seeded from the type's `annualQuota` default, adjustable for onboarding), surface the live remaining balance on the LIFF leave form, and soft-warn when a request exceeds it.

**Architecture:** A new `LeaveEntitlement` table holds `granted/carryover/adjustment` minutes per (employee, type, year). A pure helper (`balance.ts`) computes `remaining = granted + carryover + adjustment − used`, where `used` is the sum of approved leave's `chargedMinutes` (from Phase 1) for that year. The admin manages entitlements in a new section on the employee edit page (driven by a `?year=` search param); the LIFF leave form reads remaining per type and soft-warns. Builds directly on Phase 1's `units.ts` (`standardDayMinutes`, `formatDaysHours`) and `chargedMinutes`.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), Prisma 6 + PostgreSQL, Zod 4, Vitest, custom Tailwind UI. Run all commands with `/opt/homebrew/bin` on PATH (Node 24+/pnpm). Hand-authored numbered migrations applied via `pnpm db:deploy` (NOT `migrate dev`). `.env.local` already copied into this worktree.

**Spec:** `docs/superpowers/specs/2026-06-08-leave-granularity-entitlements-ot-design.md` (§ Phase 2).

**Input-unit note (refinement of the spec):** entitlement edit inputs are **decimal days** (step 0.5; e.g. `6`, `5.5`, `-3.5`), converted to minutes via `standardDayMinutes`. Every *display* (used / remaining / current values) uses the days+hours hybrid `formatDaysHours`. Decimal-days input is simpler than a days+hours pair per field and covers the realistic onboarding cases; arbitrary-minute precision on a grant is out of scope.

---

## File structure (Phase 2)

| File | Responsibility | New/Modify |
|------|----------------|-----------|
| `prisma/schema.prisma` | `LeaveEntitlement` model + back-relations on `Employee` & `LeaveType` | Modify |
| `prisma/migrations/0017_leave_entitlements/migration.sql` | DDL for the table + indexes + FKs | Create |
| `src/lib/leave/balance.ts` | pure `remainingMinutes`/`resolveGrantedMinutes` + DB `usedMinutes`/`getOrSeedEntitlements`/`remainingByTypeForEmployee` | Create |
| `src/lib/leave/balance.test.ts` | unit tests for the pure helpers | Create |
| `src/lib/audit/log.ts` | add `leaveEntitlement.update` action + `LeaveEntitlement` entity type | Modify |
| `src/lib/auth/permissions.ts` | `leave.entitlement.manage` | Modify |
| `src/lib/auth/roles.ts` | grant `leave.entitlement.manage` to Admin | Modify |
| `src/app/(admin)/admin/employees/[id]/edit/entitlements-actions.ts` | `upsertEntitlement` server action | Create |
| `src/app/(admin)/admin/employees/[id]/edit/entitlements-section.tsx` | Server Component: year selector + table + per-row edit forms | Create |
| `src/app/(admin)/admin/employees/[id]/edit/page.tsx` | read `?year`, render `EntitlementsSection` in `belowForm` | Modify |
| `src/app/(liff)/liff/leave/new/page.tsx` | fetch remaining-per-type for the employee + current year | Modify |
| `src/app/(liff)/liff/leave/new/leave-new-form.tsx` | show "คงเหลือ" + amber soft-warn when charged > remaining | Modify |

**Build order:** schema/migration → pure+DB balance helper → permission/audit plumbing → action → admin UI → LIFF balance/soft-warn → final gate. Each task ends with a commit. Verify `git log --oneline -1` is your commit after each (worktree commits must land on this branch).

---

## Task 1: Schema + migration `0017_leave_entitlements`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0017_leave_entitlements/migration.sql`

- [ ] **Step 1: Add the `LeaveEntitlement` model** to `prisma/schema.prisma` (place it right after the `LeaveConfig` model, near the other leave models):

```prisma
/// Per-employee, per-year leave allowance for one leave type. Seeded from
/// LeaveType.annualQuota × standardDayMinutes but individually editable for
/// onboarding. Remaining = granted + carryover + adjustment − used (used =
/// Σ chargedMinutes of approved leave that year). See spec §Phase 2.
model LeaveEntitlement {
  id                String    @id @default(uuid()) @db.Uuid
  employeeId        String    @db.Uuid
  employee          Employee  @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  leaveTypeId       String    @db.Uuid
  leaveType         LeaveType @relation(fields: [leaveTypeId], references: [id], onDelete: Restrict)
  periodYear        Int       // calendar year
  grantedMinutes    Int?      // null = unlimited (mirrors annualQuota = null)
  carryoverMinutes  Int       @default(0)
  adjustmentMinutes Int       @default(0) // signed; opening balance / corrections
  note              String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([employeeId, leaveTypeId, periodYear])
  @@index([employeeId, periodYear])
}
```

- [ ] **Step 2: Add the back-relations.** In `model Employee`, add to the relations block (next to `leaveRequests`):

```prisma
  leaveEntitlements   LeaveEntitlement[]
```

In `model LeaveType`, add (next to `requests`):

```prisma
  entitlements LeaveEntitlement[]
```

- [ ] **Step 3: Write the migration SQL** at `prisma/migrations/0017_leave_entitlements/migration.sql`:

```sql
-- ─── 0017 — Per-employee leave entitlements ───────────────────────────────
-- One row per (employee, leave type, year). grantedMinutes NULL = unlimited.
-- See spec §Phase 2.

CREATE TABLE "LeaveEntitlement" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "grantedMinutes" INTEGER,
    "carryoverMinutes" INTEGER NOT NULL DEFAULT 0,
    "adjustmentMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveEntitlement_employeeId_leaveTypeId_periodYear_key"
  ON "LeaveEntitlement" ("employeeId", "leaveTypeId", "periodYear");
CREATE INDEX "LeaveEntitlement_employeeId_periodYear_idx"
  ON "LeaveEntitlement" ("employeeId", "periodYear");

ALTER TABLE "LeaveEntitlement"
  ADD CONSTRAINT "LeaveEntitlement_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveEntitlement"
  ADD CONSTRAINT "LeaveEntitlement_leaveTypeId_fkey"
  FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply + regenerate** (hand-authored migration → `migrate deploy`, NOT `migrate dev`):

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm db:deploy && PATH="/opt/homebrew/bin:$PATH" pnpm db:generate`
Expected: "Applying migration `0017_leave_entitlements`" → "All migrations have been successfully applied"; client regenerated. Then `PATH="/opt/homebrew/bin:$PATH" pnpm dotenv -e .env.local -- prisma migrate status` → "Database schema is up to date!".

- [ ] **Step 5: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0017_leave_entitlements
git commit -m "feat(leave): LeaveEntitlement schema (0017)"
```

---

## Task 2: `balance.ts` — pure math + DB helpers

**Files:**
- Create: `src/lib/leave/balance.ts`
- Test: `src/lib/leave/balance.test.ts`

- [ ] **Step 1: Write the failing test** (pure helpers only):

```ts
// src/lib/leave/balance.test.ts
import { describe, expect, it } from 'vitest';
import { remainingMinutes, resolveGrantedMinutes } from './balance';

describe('remainingMinutes', () => {
  it('granted + carryover + adjustment − used', () => {
    expect(
      remainingMinutes({ grantedMinutes: 2520, carryoverMinutes: 420, adjustmentMinutes: -420 }, 840),
    ).toBe(1680); // 2520 + 420 − 420 − 840
  });

  it('can go negative (over-used)', () => {
    expect(
      remainingMinutes({ grantedMinutes: 420, carryoverMinutes: 0, adjustmentMinutes: 0 }, 840),
    ).toBe(-420);
  });

  it('null granted (unlimited) → null', () => {
    expect(
      remainingMinutes({ grantedMinutes: null, carryoverMinutes: 0, adjustmentMinutes: 0 }, 999),
    ).toBeNull();
  });
});

describe('resolveGrantedMinutes', () => {
  const STD = 420; // 7h day
  it('uses the entitlement grant when an entitlement row exists', () => {
    expect(resolveGrantedMinutes(6, { grantedMinutes: 2520 }, STD)).toBe(2520);
  });
  it('entitlement with null grant stays unlimited even if the type has a quota', () => {
    expect(resolveGrantedMinutes(6, { grantedMinutes: null }, STD)).toBeNull();
  });
  it('no entitlement → falls back to annualQuota × std', () => {
    expect(resolveGrantedMinutes(6, null, STD)).toBe(2520); // 6 × 420
  });
  it('no entitlement + null quota → unlimited', () => {
    expect(resolveGrantedMinutes(null, null, STD)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test balance -- --run`
Expected: FAIL — `Cannot find module './balance'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/leave/balance.ts
import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from './leave-config';
import { standardDayMinutes } from './units';

export type EntitlementForBalance = {
  grantedMinutes: number | null;
  carryoverMinutes: number;
  adjustmentMinutes: number;
};

/** Remaining minutes = (granted) + carryover + adjustment − used. Returns null
 *  when granted is null (unlimited — no cap, no warning). May be negative. */
export function remainingMinutes(ent: EntitlementForBalance, used: number): number | null {
  if (ent.grantedMinutes == null) return null;
  return ent.grantedMinutes + ent.carryoverMinutes + ent.adjustmentMinutes - used;
}

/** The effective grant for a type: the entitlement's grant if a row exists
 *  (which may itself be null = unlimited), else the type's annualQuota × std
 *  (null quota = unlimited). Pure. */
export function resolveGrantedMinutes(
  annualQuota: number | null,
  entitlement: { grantedMinutes: number | null } | null,
  std: number,
): number | null {
  if (entitlement) return entitlement.grantedMinutes;
  return annualQuota == null ? null : annualQuota * std;
}

/** Σ chargedMinutes of an employee's Approved, non-deleted leave of one type,
 *  bucketed by the request's startDate year. (Year-spanning multi-day leave
 *  counts wholly in its start year — documented limitation.) */
export async function usedMinutes(
  employeeId: string,
  leaveTypeId: string,
  year: number,
): Promise<number> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const rows = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      leaveTypeId,
      status: 'Approved',
      deletedAt: null,
      startDate: { gte: start, lt: end },
    },
    select: { chargedMinutes: true },
  });
  return rows.reduce((sum, r) => sum + (r.chargedMinutes ?? 0), 0);
}

export type EntitlementRow = {
  leaveTypeId: string;
  leaveTypeName: string;
  grantedMinutes: number | null;
  carryoverMinutes: number;
  adjustmentMinutes: number;
  note: string | null;
  usedMinutes: number;
  remainingMinutes: number | null;
};

/** Ensure an entitlement row exists for every active leave type for this
 *  employee/year (seeded from annualQuota × std), then return the rows
 *  enriched with used + remaining. Idempotent; NOT audit-logged (seeding the
 *  policy default is not a manual change — only edits via upsertEntitlement
 *  are audited). */
export async function getOrSeedEntitlements(
  employeeId: string,
  year: number,
): Promise<EntitlementRow[]> {
  const std = standardDayMinutes(await getLeaveConfig());
  const types = await prisma.leaveType.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, annualQuota: true },
  });
  const existing = await prisma.leaveEntitlement.findMany({
    where: { employeeId, periodYear: year },
    select: { leaveTypeId: true },
  });
  const have = new Set(existing.map((e) => e.leaveTypeId));
  const toCreate = types
    .filter((t) => !have.has(t.id))
    .map((t) => ({
      employeeId,
      leaveTypeId: t.id,
      periodYear: year,
      grantedMinutes: t.annualQuota == null ? null : t.annualQuota * std,
    }));
  if (toCreate.length > 0) {
    await prisma.leaveEntitlement.createMany({ data: toCreate, skipDuplicates: true });
  }

  const ents = await prisma.leaveEntitlement.findMany({
    where: { employeeId, periodYear: year, leaveType: { archivedAt: null } },
    orderBy: { leaveType: { name: 'asc' } },
    select: {
      leaveTypeId: true,
      grantedMinutes: true,
      carryoverMinutes: true,
      adjustmentMinutes: true,
      note: true,
      leaveType: { select: { name: true } },
    },
  });

  const rows: EntitlementRow[] = [];
  for (const e of ents) {
    const used = await usedMinutes(employeeId, e.leaveTypeId, year);
    rows.push({
      leaveTypeId: e.leaveTypeId,
      leaveTypeName: e.leaveType.name,
      grantedMinutes: e.grantedMinutes,
      carryoverMinutes: e.carryoverMinutes,
      adjustmentMinutes: e.adjustmentMinutes,
      note: e.note,
      usedMinutes: used,
      remainingMinutes: remainingMinutes(e, used),
    });
  }
  return rows;
}

/** Read-only remaining-per-type for the LIFF form. Does NOT seed rows (an
 *  employee viewing the form shouldn't write). Falls back to the type's
 *  annualQuota default when no entitlement row exists. Returns a record
 *  leaveTypeId → remaining minutes (null = unlimited). */
export async function remainingByTypeForEmployee(
  employeeId: string,
  year: number,
): Promise<Record<string, number | null>> {
  const std = standardDayMinutes(await getLeaveConfig());
  const types = await prisma.leaveType.findMany({
    where: { archivedAt: null },
    select: { id: true, annualQuota: true },
  });
  const ents = await prisma.leaveEntitlement.findMany({
    where: { employeeId, periodYear: year },
    select: { leaveTypeId: true, grantedMinutes: true, carryoverMinutes: true, adjustmentMinutes: true },
  });
  const entByType = new Map(ents.map((e) => [e.leaveTypeId, e]));

  const out: Record<string, number | null> = {};
  for (const t of types) {
    const ent = entByType.get(t.id) ?? null;
    const granted = resolveGrantedMinutes(t.annualQuota, ent, std);
    const used = await usedMinutes(employeeId, t.id, year);
    out[t.id] = remainingMinutes(
      {
        grantedMinutes: granted,
        carryoverMinutes: ent?.carryoverMinutes ?? 0,
        adjustmentMinutes: ent?.adjustmentMinutes ?? 0,
      },
      used,
    );
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test balance -- --run`
Expected: PASS (7 cases).

- [ ] **Step 5: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/leave/balance.ts src/lib/leave/balance.test.ts
git commit -m "feat(leave): balance helpers (remaining, seed, remaining-by-type)"
```

---

## Task 3: Permission + audit types

**Files:**
- Modify: `src/lib/auth/permissions.ts`
- Modify: `src/lib/auth/roles.ts`
- Modify: `src/lib/audit/log.ts`

- [ ] **Step 1: Add the permission** — in `permissions.ts`, in the Leave block (after `'leave.void': ...`), add:

```ts
  'leave.entitlement.manage': 'จัดการสิทธิวันลาของพนักงาน',
```

And add `'leave.entitlement.manage'` to the `PERMISSION_GROUPS` `leave` group's `permissions` array (after `'leave.void'`).

- [ ] **Step 2: Grant it to Admin** — in `roles.ts`, in `SYSTEM_ROLES.admin.permissions`, add `'leave.entitlement.manage',` after the existing `'leave.void',`.

- [ ] **Step 3: Add audit types** — in `src/lib/audit/log.ts`, add `'leaveEntitlement.update'` to the `AuditAction` union and `'LeaveEntitlement'` to the `AuditEntityType` union (match the existing formatting of those unions; read the file to see them).

- [ ] **Step 4: Run the perm-coverage guard + typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test perm-coverage -- --run && PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/permissions.ts src/lib/auth/roles.ts src/lib/audit/log.ts
git commit -m "feat(auth): leave.entitlement.manage permission + audit types"
```

---

## Task 4: `upsertEntitlement` server action

**Files:**
- Create: `src/app/(admin)/admin/employees/[id]/edit/entitlements-actions.ts`

- [ ] **Step 1: Write the action** (NOT a route file — co-located server action; this folder's only route is `page.tsx`):

```ts
// src/app/(admin)/admin/employees/[id]/edit/entitlements-actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { standardDayMinutes } from '@/lib/leave/units';

// Inputs are DECIMAL DAYS; converted to minutes via standardDayMinutes.
const Schema = z.object({
  granted: z
    .union([
      z.string().trim().length(0).transform(() => null),
      z.coerce.number().min(0).max(366),
    ])
    .nullable(),
  carryover: z.coerce.number().min(0).max(366),
  adjustment: z.coerce.number().min(-366).max(366),
  note: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export async function upsertEntitlement(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  formData: FormData,
) {
  const { user } = await requirePermission('leave.entitlement.manage');

  const path = `/admin/employees/${employeeId}/edit`;
  const back = `${path}?year=${year}`;

  const parsed = Schema.safeParse({
    granted: formData.get('granted') ?? '',
    carryover: formData.get('carryover') ?? 0,
    adjustment: formData.get('adjustment') ?? 0,
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) {
    redirect(`${back}&error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`);
  }

  const std = standardDayMinutes(await getLeaveConfig());
  const toMin = (days: number) => Math.round(days * std);
  const data = {
    grantedMinutes: parsed.data.granted == null ? null : toMin(parsed.data.granted),
    carryoverMinutes: toMin(parsed.data.carryover),
    adjustmentMinutes: toMin(parsed.data.adjustment),
    note: parsed.data.note,
  };

  const key = { employeeId_leaveTypeId_periodYear: { employeeId, leaveTypeId, periodYear: year } };
  const before = await prisma.leaveEntitlement.findUnique({ where: key });
  const row = await prisma.leaveEntitlement.upsert({
    where: key,
    create: { employeeId, leaveTypeId, periodYear: year, ...data },
    update: data,
  });

  auditLog({
    actorId: user.id,
    action: 'leaveEntitlement.update',
    entityType: 'LeaveEntitlement',
    entityId: row.id,
    before: before
      ? {
          grantedMinutes: before.grantedMinutes,
          carryoverMinutes: before.carryoverMinutes,
          adjustmentMinutes: before.adjustmentMinutes,
          note: before.note,
        }
      : undefined,
    after: data,
    metadata: { source: 'admin-ui', leaveTypeId, periodYear: year },
  });

  revalidatePath(path);
  redirect(`${back}&ok=1`);
}
```

NOTE: confirm `requirePermission` returns `{ user }` and `auditLog`'s signature (compare to `src/app/(admin)/admin/settings/leave-config/actions.ts` from Phase 1). Adapt `before: undefined` handling if `auditLog` forbids it (Phase 1's leave-config action already established the pattern — match it).

- [ ] **Step 2: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS (this proves `prisma.leaveEntitlement` + the compound-key name `employeeId_leaveTypeId_periodYear` exist on the generated client).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/employees/[id]/edit/entitlements-actions.ts"
git commit -m "feat(leave): upsertEntitlement server action"
```

---

## Task 5: Entitlements section on the employee edit page

**Files:**
- Create: `src/app/(admin)/admin/employees/[id]/edit/entitlements-section.tsx`
- Modify: `src/app/(admin)/admin/employees/[id]/edit/page.tsx`

- [ ] **Step 1: Write the section component** (Server Component; per-row `<form>` posts to the action):

```tsx
// src/app/(admin)/admin/employees/[id]/edit/entitlements-section.tsx
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { getOrSeedEntitlements } from '@/lib/leave/balance';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { formatDaysHours, standardDayMinutes } from '@/lib/leave/units';
import { upsertEntitlement } from './entitlements-actions';

export async function EntitlementsSection({
  employeeId,
  year,
}: {
  employeeId: string;
  year: number;
}) {
  const [rows, cfg] = await Promise.all([getOrSeedEntitlements(employeeId, year), getLeaveConfig()]);
  const std = standardDayMinutes(cfg);
  // minutes → a clean decimal-days string for input defaultValue (420 → "1", 630 → "1.5")
  const days = (min: number) => String(Number((min / std).toFixed(2)));

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>สิทธิวันลา</CardTitle>
        <div className="flex items-center gap-2 text-sm">
          <a href={`/admin/employees/${employeeId}/edit?year=${year - 1}`} className="text-primary-600 hover:underline">
            ← {year - 1}
          </a>
          <span className="font-medium tabular-nums">ปี {year}</span>
          <a href={`/admin/employees/${employeeId}/edit?year=${year + 1}`} className="text-primary-600 hover:underline">
            {year + 1} →
          </a>
        </div>
      </CardHeader>
      <CardBody>
        <p className="mb-3 text-xs text-ink-4">
          กรอกเป็น “วัน” (เช่น 6, 5.5). ปรับปรุง (Adjustment) ใส่ค่าติดลบได้ เช่น −3.5
          สำหรับวันลาที่ใช้ไปก่อนเริ่มใช้ระบบ. แสดงผลเป็น วัน/ชม. (1 วัน = {std / 60} ชม.).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-ink-4">
                <th className="py-2 pr-3">ประเภท</th>
                <th className="px-2">สิทธิ (วัน)</th>
                <th className="px-2">ยกมา (วัน)</th>
                <th className="px-2">ปรับปรุง (วัน)</th>
                <th className="px-2">ใช้ไป</th>
                <th className="px-2">คงเหลือ</th>
                <th className="px-2">หมายเหตุ</th>
                <th className="px-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.leaveTypeId} className="border-b align-middle">
                  <td className="py-2 pr-3 font-medium text-ink-1">{r.leaveTypeName}</td>
                  <td className="px-2">
                    <form
                      id={`ent-${r.leaveTypeId}`}
                      action={upsertEntitlement.bind(null, employeeId, r.leaveTypeId, year)}
                    >
                      <input
                        name="granted"
                        type="number"
                        step="0.5"
                        min="0"
                        max="366"
                        defaultValue={r.grantedMinutes == null ? '' : days(r.grantedMinutes)}
                        placeholder="ไม่จำกัด"
                        className="w-20 rounded-md border border-gray-300 px-2 py-1"
                      />
                    </form>
                  </td>
                  <td className="px-2">
                    <input
                      form={`ent-${r.leaveTypeId}`}
                      name="carryover"
                      type="number"
                      step="0.5"
                      min="0"
                      max="366"
                      defaultValue={days(r.carryoverMinutes)}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-2">
                    <input
                      form={`ent-${r.leaveTypeId}`}
                      name="adjustment"
                      type="number"
                      step="0.5"
                      min="-366"
                      max="366"
                      defaultValue={days(r.adjustmentMinutes)}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-2 tabular-nums text-ink-3">{formatDaysHours(r.usedMinutes, cfg)}</td>
                  <td className="px-2 font-medium tabular-nums">
                    {r.remainingMinutes == null ? 'ไม่จำกัด' : formatDaysHours(r.remainingMinutes, cfg)}
                  </td>
                  <td className="px-2">
                    <input
                      form={`ent-${r.leaveTypeId}`}
                      name="note"
                      type="text"
                      maxLength={200}
                      defaultValue={r.note ?? ''}
                      className="w-40 rounded-md border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-2">
                    <Button form={`ent-${r.leaveTypeId}`} type="submit" variant="secondary">
                      บันทึก
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
```

NOTE: the inputs for carryover/adjustment/note use the HTML `form="ent-<id>"` attribute to associate with the per-row `<form>` that wraps only the `granted` input — this keeps one form per row without nesting. Verify `Button` forwards a `form` prop to its underlying `<button>` (read `src/components/ui/button.tsx`; if it doesn't spread arbitrary props, use a plain `<button type="submit" form={...}>` instead). Verify `CardHeader` accepts `className` (Phase 1's leave-config page used these same components — match that usage).

- [ ] **Step 2: Wire into the edit page** — in `page.tsx`:
  - Add `year` to the `SearchParams` type and read it with a default of the current Bangkok year:

```ts
type SearchParams = Promise<{ error?: string; ok?: string; year?: string }>;
```
and in the body, after `const { error, ok } = await searchParams;` becomes:
```ts
  const { error, ok, year: yearParam } = await searchParams;
  const currentYear = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4));
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : currentYear;
```
  - Add the import: `import { EntitlementsSection } from './entitlements-section';`
  - Change the `belowForm` prop to render both the pairing card and the entitlements section:

```tsx
        belowForm={
          <>
            <PairingCard
              employeeId={id}
              employeeName={`${emp.firstName} ${emp.lastName}`.trim()}
              inviteToken={emp.inviteToken}
              inviteExpiresAt={emp.inviteExpiresAt}
              lineUserId={emp.user.lineUserId}
              baseUrl={baseUrl}
            />
            <EntitlementsSection employeeId={id} year={year} />
          </>
        }
```

- [ ] **Step 3: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Manual verification**

`PATH="/opt/homebrew/bin:$PATH" pnpm dev`, open `/admin/employees/<id>/edit` as admin. The "สิทธิวันลา" card lists each active leave type with seeded grant (e.g. ลาป่วย shows 30 วัน). Change ลากิจ granted to `3`, adjustment to `-1`, Save → row shows remaining "2 วัน"; the year arrows switch the period.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/employees/[id]/edit/entitlements-section.tsx" "src/app/(admin)/admin/employees/[id]/edit/page.tsx"
git commit -m "feat(leave): per-employee entitlements section on the edit page"
```

---

## Task 6: LIFF balance display + soft-warn

**Files:**
- Modify: `src/app/(liff)/liff/leave/new/page.tsx`
- Modify: `src/app/(liff)/liff/leave/new/leave-new-form.tsx`

- [ ] **Step 1: Fetch remaining-per-type in the page** — `leave/new/page.tsx`. `requireRole(['Staff'])` returns the employee; pass `remainingByType` to the form:

```ts
import { remainingByTypeForEmployee } from '@/lib/leave/balance';
// ...
export default async function NewLeavePage() {
  const { employee } = await requireRole(['Staff']);
  // ... existing leaveTypes + leaveConfig fetch ...

  if (leaveTypes.length === 0) {
    redirect('/liff/leave?error=no-leave-types');
  }

  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const currentYear = Number(todayYmd.slice(0, 4));
  const remainingByType = employee
    ? await remainingByTypeForEmployee(employee.id, currentYear)
    : {};

  return (
    <LeaveNewForm
      leaveTypes={leaveTypes}
      minDate={todayYmd}
      leaveConfig={leaveConfig}
      remainingByType={remainingByType}
    />
  );
}
```
(Confirm `requireRole` returns an object with `employee` — Phase 1's `submitLeaveRequest` destructures `{ user, employee, authUserId }` from `requireRole(['Staff'])`, so `employee` is available. If `employee` can be null, the `? :` guard already handles it.)

- [ ] **Step 2: Accept the prop + show balance/soft-warn in the form** — `leave-new-form.tsx`:
  - Add to `Props`: `remainingByType: Record<string, number | null>;`
  - Destructure it in the component signature.
  - Compute the selected type's remaining and whether the preview exceeds it:

```ts
  const remaining = remainingByType[leaveTypeId] ?? null;
  const exceeds =
    remaining != null && chargePreview != null && chargePreview > remaining;
```
  - Under the charged-amount preview block, add the balance line + soft-warn:

```tsx
        {remaining != null && (
          <p className="text-xs text-ink-3">
            คงเหลือปีนี้: <strong>{formatDaysHours(remaining, leaveConfig)}</strong>
          </p>
        )}
        {exceeds && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠️ คำขอนี้เกินสิทธิคงเหลือ — แอดมินจะพิจารณาอีกครั้งเมื่ออนุมัติ
          </p>
        )}
```
  - Do NOT change `submitDisabled` — soft-warn only (the request must still be submittable per the spec).

- [ ] **Step 3: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Manual verification**

With `pnpm dev` + a paired Staff LINE session (or the LIFF dev harness): open `/liff/leave/new`; the selected type shows "คงเหลือปีนี้: …"; picking a duration larger than remaining shows the amber warning but the submit button stays enabled.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(liff)/liff/leave/new/page.tsx" "src/app/(liff)/liff/leave/new/leave-new-form.tsx"
git commit -m "feat(leave): LIFF remaining-balance display + over-balance soft-warn"
```

---

## Task 7: Final gate

- [ ] **Step 1: Full gate**

Run:
```bash
PATH="/opt/homebrew/bin:$PATH" pnpm typecheck && \
PATH="/opt/homebrew/bin:$PATH" pnpm test -- --run
```
Expected: typecheck clean; tests pass (341 baseline + the new `balance` cases ≈ 348). `pnpm lint` has pre-existing `noConsole` warnings in untouched seed helper files — ignore those; confirm no NEW lint errors in Phase 2 files via `pnpm exec biome check src/lib/leave "src/app/(admin)/admin/employees/[id]/edit" "src/app/(liff)/liff/leave/new"`.

- [ ] **Step 2: Verify entitlement round-trips on the live DB** (optional sanity):

```bash
PATH="/opt/homebrew/bin:$PATH" pnpm dotenv -e .env.local -- tsx -e "
import { PrismaClient } from '@prisma/client';
(async () => {
  const p = new PrismaClient();
  const cnt = await p.leaveEntitlement.count();
  console.log('LeaveEntitlement rows:', cnt);
  await p.\$disconnect();
})();
"
```
Expected: runs without error (count ≥ 0).

- [ ] **Step 3: Commit anything outstanding** (if Step 1 auto-formatted files):

```bash
git add -A && git commit -m "chore(leave): phase 2 gate" || echo "nothing to commit"
```

---

## Self-review notes (coverage map)

- **`LeaveEntitlement` table (granted/carryover/adjustment/year, null=unlimited)** → Task 1.
- **Remaining = granted + carryover + adjustment − used; used = Σ chargedMinutes by year** → Task 2 (`remainingMinutes`, `usedMinutes`).
- **Seed from annualQuota default, editable** → Task 2 (`getOrSeedEntitlements`), Task 4/5 (edit).
- **Onboarding signed adjustment** → Task 4 (negative `adjustment` accepted), Task 5 (input allows negative).
- **Admin edit on employee edit page, per-year** → Task 5 (`?year=` + section).
- **Permission + audit** → Task 3, Task 4.
- **LIFF balance display + soft-warn (allow submit)** → Task 6.

**Refinements vs spec (intentional):** entitlement inputs are decimal-days (not a days+hours pair) — display stays days+hours. `remainingByTypeForEmployee` falls back to `annualQuota` when no entitlement row exists, so the LIFF balance works before an admin ever opens the employee's page.

**Not in Phase 2:** carryover automation (manual only); hard enforcement (soft-warn only); OT (Phase 3). Year-spanning multi-day leave counts in its start year (documented limitation).
