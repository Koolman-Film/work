# Leave-Type Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin change the leave type on an already-approved, unpaid leave request from inside the existing review modal, showing the full over-quota money ripple before they confirm.

**Architecture:** A pure ripple core (`correct-type-core.ts`) replays over-quota for the source and target (employee, type, year) groups using the existing `replayOverQuota`, producing before/after rows and the exact DB writes. A thin server-action layer (`correct-type.ts`) loads the data, enforces the guards, and applies the writes in one audited transaction. The UI is a section added to the leave `ReviewModal`, offered only for correctable rows.

**Tech Stack:** Next.js App Router (server actions), Prisma, TypeScript, Vitest, Tailwind. Money math via `decimal.js` inside the already-tested `replayOverQuota`.

## Global Constraints

- **No schema migration.** `LeaveRequest.leaveTypeId` already exists; this feature only writes it. Copied verbatim from spec.
- **Paid = locked.** A request with `deductedInPayrollId != null` can never be corrected. The server action re-checks inside the transaction, not just in the UI.
- **DeductPay ↔ DeductPay only (v1 scope narrowing — see Handoff).** Both the current type and the target type must have `overQuotaPolicy = 'DeductPay'`. Block-policy leave (ลาพักร้อน) is not a valid source or target in v1. Rationale: zero Block-typed deducted requests exist in prod, and it keeps the over-quota math uniform. Void+refile remains the escape hatch for the Block case.
- **`chargedMinutes` never changes.** A type change keeps the same dates and unit, so the charged duration is identical. Only the over-quota split (`overQuotaMinutes` / `deductAmount`) moves. Use the stored `chargedMinutes`.
- **Reuse `replayOverQuota`** (`src/lib/leave/over-quota.ts`) — do not write new over-quota math.
- **Swept siblings keep frozen values but still consume quota** in the replay walk — mirrors `recompute.ts` exactly.
- **All admin-facing copy is Thai.** Match the surrounding strings in `leave-review-modal.tsx`.
- **Deploy freeze:** must not ship before payroll cycle `2026-07` closes (`cutoffDay = 26`).
- **Test baseline:** full suite must stay green (currently 1,414 unit + integration). Run `npx vitest run`, `npx tsc --noEmit`, `npx biome check src`.

---

## File Structure

- **Create** `src/lib/leave/correct-type-core.ts` — pure `computeCorrectionRipple` + types. No I/O, no `'use server'`.
- **Create** `src/lib/leave/correct-type-core.test.ts` — unit tests (the highest-value tests).
- **Create** `src/lib/leave/correct-type.ts` — `'use server'`: `loadCorrectionContext`, `previewLeaveTypeCorrection`, `correctLeaveType`.
- **Create** `src/lib/leave/correct-type.test.ts` — integration tests (guards, transaction, audit).
- **Modify** `src/lib/auth/permissions.ts` — add `leave.correct-type` key, grant to Admin, list in the `leave` group.
- **Modify** `src/app/(admin)/admin/leave/leave-row-vm.ts` — add `deductedInPayrollId` + `leaveType.overQuotaPolicy` to `LEAVE_SELECT`; expose `employeeId`, `leaveTypeId`, `correctable` on `LeaveRowVM`.
- **Create** `src/app/(admin)/admin/leave/correct-type-section.tsx` — client component: type picker → preview → ripple table → note → confirm.
- **Modify** `src/app/(admin)/admin/leave/leave-review-modal.tsx` — render the section for correctable rows; accept `correctionTypeOptions`.
- **Modify** `src/app/(admin)/admin/leave/leave-inbox.tsx` — pass `correctionTypeOptions` and refresh on action.
- **Modify** `src/app/(admin)/admin/leave/page.tsx` — load DeductPay leave types and pass them into the inbox.

---

### Task 1: Pure ripple core

**Files:**
- Create: `src/lib/leave/correct-type-core.ts`
- Test: `src/lib/leave/correct-type-core.test.ts`

**Interfaces:**
- Consumes: `replayOverQuota`, `ReplayEntitlement` from `src/lib/leave/over-quota.ts`.
- Produces:
  - `type RippleRequest = { id: string; chargedMinutes: number; reviewedAtMs: number; swept: boolean; curOverQuotaMinutes: number; curDeductAmount: number | null }`
  - `type RippleInput = { movedRequestId: string; oldGroup: RippleRequest[]; newGroup: RippleRequest[]; oldEnt: ReplayEntitlement; newEnt: ReplayEntitlement; ratePerMin: number }`
  - `type RippleRow = { leaveRequestId: string; group: 'moved' | 'old' | 'new'; oldOverQuotaMinutes: number; newOverQuotaMinutes: number; oldDeduct: number | null; newDeduct: number | null }`
  - `type CorrectionRipple = { moved: { leaveRequestId: string; overQuotaMinutes: number; deductAmount: number | null }; siblingWrites: Array<{ id: string; overQuotaMinutes: number; deductAmount: number | null }>; displayRows: RippleRow[]; netDeductDelta: number }`
  - `function computeCorrectionRipple(input: RippleInput): CorrectionRipple`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/leave/correct-type-core.test.ts
import { describe, expect, it } from 'vitest';
import { computeCorrectionRipple, type RippleRequest } from './correct-type-core';

// 480 min = 1 standard day. Rate 1 baht/min keeps the arithmetic readable.
const RATE = 1;
const ent = (days: number | null) => ({
  grantedMinutes: days == null ? null : days * 480,
  carryoverMinutes: 0,
  adjustmentMinutes: 0,
  penaltyMinutes: 0,
});
const req = (o: Partial<RippleRequest> & { id: string; reviewedAtMs: number }): RippleRequest => ({
  chargedMinutes: 480,
  swept: false,
  curOverQuotaMinutes: 0,
  curDeductAmount: null,
  ...o,
});

describe('computeCorrectionRipple', () => {
  it('moves the corrected request to an unused target type → its deduction disappears', () => {
    // Old type ลากิจ: quota 0 left, so this 1-day request was fully over (480 min, ฿480).
    // New type ลาป่วย: 30 days free.
    const moved = req({ id: 'M', reviewedAtMs: 100, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'M',
      oldGroup: [moved],
      newGroup: [],
      oldEnt: ent(0),
      newEnt: ent(30),
      ratePerMin: RATE,
    });
    expect(r.moved).toEqual({ leaveRequestId: 'M', overQuotaMinutes: 0, deductAmount: null });
    expect(r.netDeductDelta).toBe(-480);
  });

  it('removing a mid-group request frees a LATER same-type request', () => {
    // ลากิจ quota = 1 day (480). Three 1-day requests in approval order A,B,C.
    // Before: A within quota (0 over), B over (480, ฿480), C over (480, ฿480).
    // Move B to a free type. After: A within quota, C now takes B's old slot → C within? No:
    // used after A = 480 (quota exhausted), C over by 480. So C stays over.
    // Instead free A's successor: move A out. Then B takes the first slot (within quota),
    // C over. B goes from ฿480 → ฿0.
    const A = req({ id: 'A', reviewedAtMs: 100, curOverQuotaMinutes: 0, curDeductAmount: null });
    const B = req({ id: 'B', reviewedAtMs: 200, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const C = req({ id: 'C', reviewedAtMs: 300, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'A',
      oldGroup: [A, B, C],
      newGroup: [],
      oldEnt: ent(1),
      newEnt: ent(30),
      ratePerMin: RATE,
    });
    const byId = new Map(r.displayRows.map((x) => [x.leaveRequestId, x]));
    expect(byId.get('B')?.newDeduct).toBeNull(); // B freed
    expect(byId.get('C')?.newDeduct).toBe(480);  // C still over
    expect(r.siblingWrites.find((w) => w.id === 'B')?.deductAmount).toBeNull();
  });

  it('inserting into a full target type pushes a LATER target request over quota', () => {
    // New type ลาป่วย quota = 1 day. It already has request X (reviewed at 300, within quota).
    // Move Y (reviewed at 200) into it. Y is earlier → Y takes the quota, X becomes over.
    const X = req({ id: 'X', reviewedAtMs: 300, curOverQuotaMinutes: 0, curDeductAmount: null });
    const Y = req({ id: 'Y', reviewedAtMs: 200, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'Y',
      oldGroup: [Y],
      newGroup: [X],
      oldEnt: ent(0),
      newEnt: ent(1),
      ratePerMin: RATE,
    });
    const byId = new Map(r.displayRows.map((x) => [x.leaveRequestId, x]));
    expect(byId.get('Y')?.newDeduct).toBeNull(); // Y now within quota
    expect(byId.get('X')?.newDeduct).toBe(480);  // X pushed over
  });

  it('a swept sibling keeps its frozen value but still consumes quota', () => {
    // ลากิจ quota = 1 day. Swept request S (480 min, frozen ฿0 within quota) reviewed first,
    // then moved request M (over, ฿480). Move M out. S must NOT be rewritten, and S still
    // consumed the quota so nothing about S changes.
    const S = req({ id: 'S', reviewedAtMs: 100, swept: true, curOverQuotaMinutes: 0, curDeductAmount: null });
    const M = req({ id: 'M', reviewedAtMs: 200, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'M',
      oldGroup: [S, M],
      newGroup: [],
      oldEnt: ent(1),
      newEnt: ent(30),
      ratePerMin: RATE,
    });
    expect(r.siblingWrites.some((w) => w.id === 'S')).toBe(false); // never rewrite swept
    expect(r.moved.deductAmount).toBeNull();
  });

  it('an unlimited target type never deducts', () => {
    const M = req({ id: 'M', reviewedAtMs: 100, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'M',
      oldGroup: [M],
      newGroup: [],
      oldEnt: ent(0),
      newEnt: ent(null),
      ratePerMin: RATE,
    });
    expect(r.moved.deductAmount).toBeNull();
  });

  it('a target type with zero entitlement (EMP-C case) still deducts — never silently zero', () => {
    const M = req({ id: 'M', reviewedAtMs: 100, curOverQuotaMinutes: 480, curDeductAmount: 480 });
    const r = computeCorrectionRipple({
      movedRequestId: 'M',
      oldGroup: [M],
      newGroup: [],
      oldEnt: ent(0),
      newEnt: ent(0),
      ratePerMin: RATE,
    });
    expect(r.moved.deductAmount).toBe(480); // moved from one 0-quota type to another
    expect(r.netDeductDelta).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/leave/correct-type-core.test.ts`
Expected: FAIL — "Cannot find module './correct-type-core'".

- [ ] **Step 3: Implement the core**

```ts
// src/lib/leave/correct-type-core.ts
import { replayOverQuota, type ReplayEntitlement, type ReplayResult } from './over-quota';

export type RippleRequest = {
  id: string;
  /** Frozen at approval; a type change does not alter it. */
  chargedMinutes: number;
  /** reviewedAt ?? createdAt, in ms — the replay ordering key. */
  reviewedAtMs: number;
  /** Swept into a published payroll → frozen, never rewritten. */
  swept: boolean;
  curOverQuotaMinutes: number;
  curDeductAmount: number | null;
};

export type RippleInput = {
  movedRequestId: string;
  /** All current requests of (employee, OLD type, year), INCLUDING the moved one. */
  oldGroup: RippleRequest[];
  /** All current requests of (employee, NEW type, year), EXCLUDING the moved one. */
  newGroup: RippleRequest[];
  oldEnt: ReplayEntitlement;
  newEnt: ReplayEntitlement;
  ratePerMin: number;
};

export type RippleRow = {
  leaveRequestId: string;
  group: 'moved' | 'old' | 'new';
  oldOverQuotaMinutes: number;
  newOverQuotaMinutes: number;
  oldDeduct: number | null;
  newDeduct: number | null;
};

export type CorrectionRipple = {
  /** The corrected request's new values — ALWAYS applied (its type changes even if money doesn't). */
  moved: { leaveRequestId: string; overQuotaMinutes: number; deductAmount: number | null };
  /** Unswept siblings in either group whose value changed — to persist. */
  siblingWrites: Array<{ id: string; overQuotaMinutes: number; deductAmount: number | null }>;
  /** Moved + every changed sibling, for the admin preview. */
  displayRows: RippleRow[];
  /** Sum of (newDeduct − oldDeduct) over the moved request and all rewritten siblings. */
  netDeductDelta: number;
};

/** Replay a group, then override swept rows back to their frozen value (they
 *  still consumed quota in the walk, but their stored value must not move). */
function replayKeepingSwept(
  ent: ReplayEntitlement,
  group: RippleRequest[],
  ratePerMin: number,
): Map<string, { over: number; deduct: number | null }> {
  const ordered = [...group].sort((a, b) => a.reviewedAtMs - b.reviewedAtMs);
  const replayed: ReplayResult[] = replayOverQuota(
    ent,
    ordered.map((r) => ({ id: r.id, chargedMinutes: r.chargedMinutes })),
    ratePerMin,
  );
  const out = new Map<string, { over: number; deduct: number | null }>();
  const sweptById = new Map(group.map((r) => [r.id, r]));
  for (const r of replayed) {
    const src = sweptById.get(r.id);
    if (src?.swept) {
      out.set(r.id, { over: src.curOverQuotaMinutes, deduct: src.curDeductAmount });
    } else {
      out.set(r.id, { over: r.overQuotaMinutes, deduct: r.deductAmount });
    }
  }
  return out;
}

export function computeCorrectionRipple(input: RippleInput): CorrectionRipple {
  const { movedRequestId, oldGroup, newGroup, oldEnt, newEnt, ratePerMin } = input;
  const moved = oldGroup.find((r) => r.id === movedRequestId);
  if (!moved) throw new Error(`moved request ${movedRequestId} not in oldGroup`);

  const oldAfter = replayKeepingSwept(oldEnt, oldGroup.filter((r) => r.id !== movedRequestId), ratePerMin);
  const newAfter = replayKeepingSwept(newEnt, [...newGroup, moved], ratePerMin);

  const movedNew = newAfter.get(movedRequestId)!;
  const displayRows: RippleRow[] = [];
  const siblingWrites: CorrectionRipple['siblingWrites'] = [];
  let netDeductDelta = 0;

  // Moved row — always in the write set (its type changes regardless of money).
  displayRows.push({
    leaveRequestId: movedRequestId,
    group: 'moved',
    oldOverQuotaMinutes: moved.curOverQuotaMinutes,
    newOverQuotaMinutes: movedNew.over,
    oldDeduct: moved.curDeductAmount,
    newDeduct: movedNew.deduct,
  });
  netDeductDelta += (movedNew.deduct ?? 0) - (moved.curDeductAmount ?? 0);

  const collect = (group: RippleRequest[], after: Map<string, { over: number; deduct: number | null }>, tag: 'old' | 'new') => {
    for (const r of group) {
      if (r.id === movedRequestId) continue;
      const a = after.get(r.id)!;
      const changed = a.over !== r.curOverQuotaMinutes || a.deduct !== r.curDeductAmount;
      if (!changed) continue;
      displayRows.push({
        leaveRequestId: r.id,
        group: tag,
        oldOverQuotaMinutes: r.curOverQuotaMinutes,
        newOverQuotaMinutes: a.over,
        oldDeduct: r.curDeductAmount,
        newDeduct: a.deduct,
      });
      if (!r.swept) {
        siblingWrites.push({ id: r.id, overQuotaMinutes: a.over, deductAmount: a.deduct });
        netDeductDelta += (a.deduct ?? 0) - (r.curDeductAmount ?? 0);
      }
    }
  };
  collect(oldGroup, oldAfter, 'old');
  collect(newGroup, newAfter, 'new');

  return {
    moved: { leaveRequestId: movedRequestId, overQuotaMinutes: movedNew.over, deductAmount: movedNew.deduct },
    siblingWrites,
    displayRows,
    netDeductDelta,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/leave/correct-type-core.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx biome check src/lib/leave/correct-type-core.ts src/lib/leave/correct-type-core.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/leave/correct-type-core.ts src/lib/leave/correct-type-core.test.ts
git commit -m "feat(leave): pure over-quota ripple core for type correction"
```

---

### Task 2: Server actions — load, preview, correct

**Files:**
- Create: `src/lib/leave/correct-type.ts`
- Test: `src/lib/leave/correct-type.test.ts`
- Modify: `src/lib/auth/permissions.ts` (add the permission the action requires)

**Interfaces:**
- Consumes: `computeCorrectionRipple`, `RippleRequest`, `CorrectionRipple` (Task 1); `replayOverQuota`'s `ReplayEntitlement`; `perMinuteRate` from `over-quota.ts`; `penaltyMinutesBy` from `penalty-minutes.ts`; `standardDayMinutes` from `units.ts`; `getLeaveConfig` from `leave-config.ts`; `requirePermission` from `@/lib/auth/check-permission`; `getPermittedBranches`, `canActOnEmployeeBranches` from `@/lib/auth/branch-scope`; `auditLogTx` from `@/lib/audit/log`; `prisma`, `prismaRaw` from `@/lib/db/prisma`.
- Produces:
  - `type CorrectionPreview = { ok: true; ripple: CorrectionRipple; oldTypeName: string; newTypeName: string } | { ok: false; message: string }`
  - `async function previewLeaveTypeCorrection(leaveRequestId: string, newLeaveTypeId: string): Promise<CorrectionPreview>`
  - `async function correctLeaveType(input: { leaveRequestId: string; newLeaveTypeId: string; note: string }): Promise<{ ok: true } | { ok: false; message: string }>`

- [ ] **Step 1: Add the permission key**

In `src/lib/auth/permissions.ts`, in the Leave block of the permission catalog (after `'leave.void'`):

```ts
  'leave.correct-type': 'แก้ประเภทของคำขอลาที่อนุมัติแล้ว (คำนวณการหักเงินใหม่)',
```

In the Admin role's permission list where the other `leave.*` keys are granted (the array containing `'leave.void'`), add `'leave.correct-type'`.

In the `leave` permission-group `permissions` array, add `'leave.correct-type'`:

```ts
    permissions: ['leave.read', 'leave.approve', 'leave.void', 'leave.correct-type', 'leave.entitlement.manage'],
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/leave/correct-type.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));

const auditLogTx = vi.fn();
vi.mock('@/lib/audit/log', () => ({ auditLogTx: (...a: unknown[]) => auditLogTx(...a) }));

const requirePermission = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
}));
vi.mock('@/lib/auth/branch-scope', () => ({
  getPermittedBranches: vi.fn().mockResolvedValue({ kind: 'all' }),
  canActOnEmployeeBranches: vi.fn().mockReturnValue(true),
}));

const leaveRequestFindUnique = vi.fn();
const leaveRequestFindMany = vi.fn();
const leaveTypeFindUnique = vi.fn();
const leaveEntitlementFindUnique = vi.fn();
const leaveRequestUpdate = vi.fn();
vi.mock('@/lib/db/prisma', () => {
  const client = {
    leaveRequest: {
      findUnique: (...a: unknown[]) => leaveRequestFindUnique(...a),
      findMany: (...a: unknown[]) => leaveRequestFindMany(...a),
      update: (...a: unknown[]) => leaveRequestUpdate(...a),
    },
    leaveType: { findUnique: (...a: unknown[]) => leaveTypeFindUnique(...a) },
    leaveEntitlement: { findUnique: (...a: unknown[]) => leaveEntitlementFindUnique(...a) },
    leaveConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    payrollConfig: { findFirstOrThrow: vi.fn().mockResolvedValue({ workingDaysPerMonth: 26 }) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ leaveRequest: { update: (...a: unknown[]) => leaveRequestUpdate(...a) } }),
  };
  return { prisma: client, prismaRaw: client };
});
vi.mock('./penalty-minutes', () => ({ penaltyMinutesBy: vi.fn().mockResolvedValue(new Map()) }));

import { correctLeaveType, previewLeaveTypeCorrection } from './correct-type';

const OLD_TYPE = 'type-personal';
const NEW_TYPE = 'type-sick';
function baseRequest(over: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    employeeId: 'emp-1',
    leaveTypeId: OLD_TYPE,
    startDate: new Date('2026-07-10'),
    status: 'Approved',
    deletedAt: null,
    deductedInPayrollId: null,
    reviewedAt: new Date('2026-07-10'),
    createdAt: new Date('2026-07-10'),
    chargedMinutes: 480,
    overQuotaMinutes: 480,
    deductAmount: 480,
    leaveType: { name: 'ลากิจ', overQuotaPolicy: 'DeductPay' },
    employee: { salaryType: 'Monthly', baseSalary: 15000, branchId: 'b1', assignedBranchIds: [] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { id: 'admin-1' } });
  leaveTypeFindUnique.mockResolvedValue({ id: NEW_TYPE, name: 'ลาป่วย', overQuotaPolicy: 'DeductPay', annualQuota: 30 });
  leaveEntitlementFindUnique.mockResolvedValue(null); // fall back to annualQuota
  leaveRequestFindMany.mockResolvedValue([]); // no siblings by default
});

describe('correctLeaveType — guards', () => {
  it('refuses a paid (swept) request even if the UI submits it', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest({ deductedInPayrollId: 'pay-1' }));
    const r = await correctLeaveType({ leaveRequestId: 'req-1', newLeaveTypeId: NEW_TYPE, note: 'ผิดประเภท' });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('จ่ายแล้ว') });
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the note is blank', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    const r = await correctLeaveType({ leaveRequestId: 'req-1', newLeaveTypeId: NEW_TYPE, note: '  ' });
    expect(r.ok).toBe(false);
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the target type is the same as the current type', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    leaveTypeFindUnique.mockResolvedValue({ id: OLD_TYPE, name: 'ลากิจ', overQuotaPolicy: 'DeductPay', annualQuota: 3 });
    const r = await correctLeaveType({ leaveRequestId: 'req-1', newLeaveTypeId: OLD_TYPE, note: 'x' });
    expect(r.ok).toBe(false);
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
  });

  it('refuses a Block-policy target type', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    leaveTypeFindUnique.mockResolvedValue({ id: 'type-vac', name: 'ลาพักร้อน', overQuotaPolicy: 'Block', annualQuota: 6 });
    const r = await correctLeaveType({ leaveRequestId: 'req-1', newLeaveTypeId: 'type-vac', note: 'x' });
    expect(r.ok).toBe(false);
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
  });
});

describe('correctLeaveType — apply', () => {
  it('changes the type, zeroes the deduction, and writes one audit entry', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    leaveRequestUpdate.mockResolvedValue({});
    const r = await correctLeaveType({ leaveRequestId: 'req-1', newLeaveTypeId: NEW_TYPE, note: 'พนักงานป่วยจริง' });
    expect(r).toEqual({ ok: true });
    // Moved request updated to the new type with a zeroed deduction (ลาป่วย 30 days free).
    const movedCall = leaveRequestUpdate.mock.calls.find((c) => c[0].where.id === 'req-1');
    expect(movedCall![0].data.leaveTypeId).toBe(NEW_TYPE);
    expect(movedCall![0].data.deductAmount).toBeNull();
    expect(movedCall![0].data.overQuotaMinutes).toBe(0);
    expect(auditLogTx).toHaveBeenCalledTimes(1);
    expect(auditLogTx.mock.calls[0][1].action).toBe('leave.correct-type');
  });
});

describe('previewLeaveTypeCorrection', () => {
  it('returns the ripple without writing anything', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    const r = await previewLeaveTypeCorrection('req-1', NEW_TYPE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ripple.moved.deductAmount).toBeNull();
    expect(r.ripple.netDeductDelta).toBe(-480);
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/leave/correct-type.test.ts`
Expected: FAIL — "Cannot find module './correct-type'".

- [ ] **Step 4: Implement the server actions**

```ts
// src/lib/leave/correct-type.ts
'use server';

import { headers } from 'next/headers';
import { auditLogTx, type Prisma } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { computeCorrectionRipple, type CorrectionRipple, type RippleRequest } from './correct-type-core';
import { getLeaveConfig } from './leave-config';
import { perMinuteRate, type ReplayEntitlement } from './over-quota';
import { penaltyMinutesBy } from './penalty-minutes';
import { standardDayMinutes } from './units';

export type CorrectionPreview =
  | { ok: true; ripple: CorrectionRipple; oldTypeName: string; newTypeName: string }
  | { ok: false; message: string };

type Ctx = {
  ripple: CorrectionRipple;
  oldTypeName: string;
  newTypeName: string;
  employeeBranchIds: string[];
};

async function reqMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

const YEAR_MS = (y: number) => ({
  gte: new Date(Date.UTC(y, 0, 1)),
  lt: new Date(Date.UTC(y + 1, 0, 1)),
});

const REQ_SELECT = {
  id: true,
  chargedMinutes: true,
  overQuotaMinutes: true,
  deductAmount: true,
  reviewedAt: true,
  createdAt: true,
  deductedInPayrollId: true,
} as const;

/** Shared loader for both preview and apply. Returns a machine-readable error
 *  code as a string in the `error` field, or the fully-computed context. */
async function loadCorrectionContext(
  leaveRequestId: string,
  newLeaveTypeId: string,
): Promise<{ error: string } | Ctx> {
  const req = await prismaRaw.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    select: {
      id: true,
      employeeId: true,
      leaveTypeId: true,
      startDate: true,
      status: true,
      deletedAt: true,
      deductedInPayrollId: true,
      reviewedAt: true,
      createdAt: true,
      chargedMinutes: true,
      overQuotaMinutes: true,
      deductAmount: true,
      leaveType: { select: { name: true, overQuotaPolicy: true, annualQuota: true } },
      employee: { select: { salaryType: true, baseSalary: true, branchId: true, assignedBranchIds: true } },
    },
  });
  if (!req || req.deletedAt) return { error: 'ไม่พบคำขอลา' };
  if (req.status !== 'Approved') return { error: 'แก้ประเภทได้เฉพาะคำขอที่อนุมัติแล้ว' };
  if (req.deductedInPayrollId != null) return { error: 'จ่ายแล้ว — แก้ไขไม่ได้' };
  if (req.leaveType.overQuotaPolicy !== 'DeductPay') return { error: 'ประเภทเดิมไม่รองรับการแก้' };
  if (newLeaveTypeId === req.leaveTypeId) return { error: 'ประเภทใหม่ต้องต่างจากเดิม' };

  const newType = await prisma.leaveType.findUnique({
    where: { id: newLeaveTypeId },
    select: { name: true, overQuotaPolicy: true, annualQuota: true },
  });
  if (!newType) return { error: 'ไม่พบประเภทที่เลือก' };
  if (newType.overQuotaPolicy !== 'DeductPay') return { error: 'ประเภทที่เลือกไม่รองรับการแก้' };

  const cfg = await getLeaveConfig();
  const std = standardDayMinutes(cfg);
  const payCfg = await prisma.payrollConfig.findFirstOrThrow({ select: { workingDaysPerMonth: true } });
  const year = req.startDate.getUTCFullYear();

  const [oldRows, newRows, oldEntRow, newEntRow, penalties] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, status: 'Approved', deletedAt: null, startDate: YEAR_MS(year) },
      select: REQ_SELECT,
    }),
    prisma.leaveRequest.findMany({
      where: { employeeId: req.employeeId, leaveTypeId: newLeaveTypeId, status: 'Approved', deletedAt: null, startDate: YEAR_MS(year) },
      select: REQ_SELECT,
    }),
    prisma.leaveEntitlement.findUnique({
      where: { employeeId_leaveTypeId_periodYear: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, periodYear: year } },
      select: { grantedMinutes: true, carryoverMinutes: true, adjustmentMinutes: true },
    }),
    prisma.leaveEntitlement.findUnique({
      where: { employeeId_leaveTypeId_periodYear: { employeeId: req.employeeId, leaveTypeId: newLeaveTypeId, periodYear: year } },
      select: { grantedMinutes: true, carryoverMinutes: true, adjustmentMinutes: true },
    }),
    penaltyMinutesBy([req.employeeId], year),
  ]);

  const toRipple = (r: (typeof oldRows)[number]): RippleRequest => ({
    id: r.id,
    chargedMinutes: r.chargedMinutes ?? 0,
    reviewedAtMs: (r.reviewedAt ?? r.createdAt).getTime(),
    swept: r.deductedInPayrollId != null,
    curOverQuotaMinutes: r.overQuotaMinutes ?? 0,
    curDeductAmount: r.deductAmount == null ? null : Number(r.deductAmount),
  });

  const grantedFallback = (entRow: { grantedMinutes: number | null } | null, quota: number | null) =>
    entRow ? entRow.grantedMinutes : quota == null ? null : quota * std;
  const oldEnt: ReplayEntitlement = {
    grantedMinutes: grantedFallback(oldEntRow, req.leaveType.annualQuota),
    carryoverMinutes: oldEntRow?.carryoverMinutes ?? 0,
    adjustmentMinutes: oldEntRow?.adjustmentMinutes ?? 0,
    penaltyMinutes: penalties.get(`${req.employeeId}:${req.leaveTypeId}`) ?? 0,
  };
  const newEnt: ReplayEntitlement = {
    grantedMinutes: grantedFallback(newEntRow, newType.annualQuota),
    carryoverMinutes: newEntRow?.carryoverMinutes ?? 0,
    adjustmentMinutes: newEntRow?.adjustmentMinutes ?? 0,
    penaltyMinutes: penalties.get(`${req.employeeId}:${newLeaveTypeId}`) ?? 0,
  };

  const rate = perMinuteRate(req.employee.salaryType, Number(req.employee.baseSalary), payCfg.workingDaysPerMonth, std);
  const ripple = computeCorrectionRipple({
    movedRequestId: req.id,
    oldGroup: oldRows.map(toRipple),
    newGroup: newRows.filter((r) => r.id !== req.id).map(toRipple),
    oldEnt,
    newEnt,
    ratePerMin: rate,
  });

  return {
    ripple,
    oldTypeName: req.leaveType.name,
    newTypeName: newType.name,
    employeeBranchIds: [req.employee.branchId, ...req.employee.assignedBranchIds],
  };
}

export async function previewLeaveTypeCorrection(
  leaveRequestId: string,
  newLeaveTypeId: string,
): Promise<CorrectionPreview> {
  const { user } = await requirePermission('leave.correct-type');
  const ctx = await loadCorrectionContext(leaveRequestId, newLeaveTypeId);
  if ('error' in ctx) return { ok: false, message: ctx.error };
  const permitted = await getPermittedBranches(user, 'leave.correct-type');
  if (!canActOnEmployeeBranches(permitted, ctx.employeeBranchIds)) return { ok: false, message: 'ไม่พบคำขอลา' };
  return { ok: true, ripple: ctx.ripple, oldTypeName: ctx.oldTypeName, newTypeName: ctx.newTypeName };
}

export async function correctLeaveType(input: {
  leaveRequestId: string;
  newLeaveTypeId: string;
  note: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const note = input.note?.trim() ?? '';
  if (!note) return { ok: false, message: 'กรุณาระบุเหตุผล' };

  const { user } = await requirePermission('leave.correct-type');
  const ctx = await loadCorrectionContext(input.leaveRequestId, input.newLeaveTypeId);
  if ('error' in ctx) return { ok: false, message: ctx.error };
  const permitted = await getPermittedBranches(user, 'leave.correct-type');
  if (!canActOnEmployeeBranches(permitted, ctx.employeeBranchIds)) return { ok: false, message: 'ไม่พบคำขอลา' };

  const meta = await reqMeta();
  const { ripple, oldTypeName, newTypeName } = ctx;
  try {
    await prisma.$transaction(async (tx) => {
      // Re-check paid state INSIDE the transaction (UI/state may be stale).
      const fresh = await tx.leaveRequest.findUnique({
        where: { id: input.leaveRequestId },
        select: { deductedInPayrollId: true, deletedAt: true, leaveTypeId: true },
      });
      if (!fresh || fresh.deletedAt || fresh.deductedInPayrollId != null) {
        throw new Error('STALE');
      }
      // Moved request: change the type + apply its recomputed over-quota.
      await tx.leaveRequest.update({
        where: { id: input.leaveRequestId },
        data: {
          leaveTypeId: input.newLeaveTypeId,
          overQuotaMinutes: ripple.moved.overQuotaMinutes,
          deductAmount: ripple.moved.deductAmount,
        },
      });
      // Unswept siblings whose split shifted.
      for (const w of ripple.siblingWrites) {
        await tx.leaveRequest.update({
          where: { id: w.id },
          data: { overQuotaMinutes: w.overQuotaMinutes, deductAmount: w.deductAmount },
        });
      }
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'leave.correct-type',
        entityType: 'LeaveRequest',
        entityId: input.leaveRequestId,
        before: { leaveType: oldTypeName } as unknown as Prisma.JsonValue,
        after: {
          leaveType: newTypeName,
          note,
          netDeductDelta: ripple.netDeductDelta,
          rows: ripple.displayRows,
        } as unknown as Prisma.JsonValue,
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'STALE') {
      return { ok: false, message: 'สถานะเปลี่ยนไประหว่างดำเนินการ — กรุณาเปิดใหม่' };
    }
    console.error('[correctLeaveType] failed', err);
    return { ok: false, message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/leave/correct-type.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck + lint + full suite**

Run: `npx tsc --noEmit && npx biome check src && npx vitest run`
Expected: clean; suite green, count ≥ baseline.

- [ ] **Step 7: Commit**

```bash
git add src/lib/leave/correct-type.ts src/lib/leave/correct-type.test.ts src/lib/auth/permissions.ts
git commit -m "feat(leave): server actions to preview + apply leave-type correction"
```

---

### Task 3: Expose correctability on the row VM

**Files:**
- Modify: `src/app/(admin)/admin/leave/leave-row-vm.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `LeaveRowVM` gains `employeeId: string`, `leaveTypeId: string`, `correctable: boolean`. `LEAVE_SELECT` gains `deductedInPayrollId: true` and `leaveType: { select: { ..., overQuotaPolicy: true } }`.

- [ ] **Step 1: Extend `LEAVE_SELECT` and `LeaveRecord`**

In `src/app/(admin)/admin/leave/leave-row-vm.ts`, add to the `LEAVE_SELECT` object:

```ts
  deductedInPayrollId: true,
```

and change its `leaveType` select from `{ select: { name: true, isPaid: true } }` to:

```ts
  leaveType: { select: { name: true, isPaid: true, overQuotaPolicy: true } },
```

The `LeaveRecord` type is hand-maintained (it does NOT currently declare `deletedAt`). Add these fields to it: `deletedAt: Date | null;`, `deductedInPayrollId: string | null;`, and change `leaveType` to `{ name: string; isPaid: boolean; overQuotaPolicy: 'Block' | 'DeductPay' }`.

- [ ] **Step 2: Add the VM fields**

In the `LeaveRowVM` type add:

```ts
  employeeId: string;
  leaveTypeId: string;
  /** Approved, not deleted, not yet paid, and a DeductPay type → an admin may
   *  correct the type. Drives whether the correction UI renders. */
  correctable: boolean;
```

In the `buildLeaveRowVM` function (the synchronous builder), populate them:

```ts
    employeeId: record.employeeId,
    leaveTypeId: record.leaveTypeId,
    correctable:
      record.status === 'Approved' &&
      record.deletedAt == null &&
      record.deductedInPayrollId == null &&
      record.leaveType.overQuotaPolicy === 'DeductPay',
```

(If `buildLeaveRowVM` does not currently receive `deletedAt`, it is already in `LeaveRecord` via the trash list; confirm the field is selected — `LEAVE_SELECT` already includes `deletedAt: true`.)

- [ ] **Step 3: Write a focused test for `correctable`**

Add to the existing VM test file if present (`src/app/(admin)/admin/leave/leave-row-vm.test.ts`); create it if absent:

```ts
import { describe, expect, it } from 'vitest';
import { buildLeaveRowVM, type LeaveRecord } from './leave-row-vm';

const rec = (o: Partial<LeaveRecord>): LeaveRecord => ({
  id: 'r', employeeId: 'e', leaveTypeId: 't',
  startDate: new Date('2026-07-10'), endDate: new Date('2026-07-10'),
  unit: 'FullDay', startTime: null, endTime: null, reason: 'x',
  status: 'Approved', reviewNote: null, reviewedAt: new Date(), createdAt: new Date(),
  attachmentUrl: null, deletedAt: null, deductedInPayrollId: null,
  leaveType: { name: 'ลากิจ', isPaid: true, overQuotaPolicy: 'DeductPay' },
  employee: { firstName: 'A', lastName: 'B', nickname: null, branch: { name: 'X' }, department: null },
  ...o,
});

const CFG = { morningStart: '09:00', morningEnd: '12:00', afternoonStart: '13:00', afternoonEnd: '17:00' };

describe('buildLeaveRowVM correctable', () => {
  const build = (r: LeaveRecord) =>
    buildLeaveRowVM(r, { attachmentUrl: null, workingDays: 1, cfg: CFG, overQuota: null });
  it('true for an approved, unpaid, DeductPay request', () => {
    expect(build(rec({})).correctable).toBe(true);
  });
  it('false once paid', () => {
    expect(build(rec({ deductedInPayrollId: 'pay-1' })).correctable).toBe(false);
  });
  it('false for a Block-policy type', () => {
    expect(build(rec({ leaveType: { name: 'ลาพักร้อน', isPaid: true, overQuotaPolicy: 'Block' } })).correctable).toBe(false);
  });
  it('false while still Pending', () => {
    expect(build(rec({ status: 'Pending' })).correctable).toBe(false);
  });
});
```

Adjust the `build` call's second argument to match `buildLeaveRowVM`'s real signature (inspect the function; the plan assumes `(record, { attachmentUrl, workingDays })`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/\(admin\)/admin/leave/leave-row-vm.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npx biome check "src/app/(admin)/admin/leave/leave-row-vm.ts"
git add "src/app/(admin)/admin/leave/leave-row-vm.ts" "src/app/(admin)/admin/leave/leave-row-vm.test.ts"
git commit -m "feat(leave): expose correctable flag on the leave row VM"
```

---

### Task 4: Correction UI in the review modal

**Files:**
- Create: `src/app/(admin)/admin/leave/correct-type-section.tsx`
- Modify: `src/app/(admin)/admin/leave/leave-review-modal.tsx`
- Modify: `src/app/(admin)/admin/leave/leave-inbox.tsx`
- Modify: `src/app/(admin)/admin/leave/page.tsx`

**Interfaces:**
- Consumes: `previewLeaveTypeCorrection`, `correctLeaveType` (Task 2); `LeaveRowVM.correctable/employeeId/leaveTypeId` (Task 3).
- Produces: `CorrectTypeSection` component; `LeaveReviewModal` gains optional prop `correctionTypeOptions?: Array<{ id: string; name: string }>`.

- [ ] **Step 1: Build the section component**

```tsx
// src/app/(admin)/admin/leave/correct-type-section.tsx
'use client';

import { useState, useTransition } from 'react';
import { correctLeaveType, type CorrectionPreview, previewLeaveTypeCorrection } from '@/lib/leave/correct-type';

type TypeOption = { id: string; name: string };

export function CorrectTypeSection({
  leaveRequestId,
  currentTypeId,
  options,
  onDone,
}: {
  leaveRequestId: string;
  currentTypeId: string;
  options: TypeOption[];
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const targets = options.filter((o) => o.id !== currentTypeId);

  function choose(id: string) {
    setTargetId(id);
    setPreview(null);
    setError(null);
    start(async () => setPreview(await previewLeaveTypeCorrection(leaveRequestId, id)));
  }

  function confirm() {
    if (!targetId) return;
    start(async () => {
      const r = await correctLeaveType({ leaveRequestId, newLeaveTypeId: targetId, note });
      if (r.ok) {
        setOpen(false);
        onDone?.();
      } else {
        setError(r.message);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-primary-600 hover:text-primary-700"
      >
        เปลี่ยนประเภทการลา
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3">
      <p className="text-xs font-medium text-ink-4">เปลี่ยนเป็นประเภท</p>
      <div className="flex flex-wrap gap-2">
        {targets.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => choose(o.id)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              targetId === o.id ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-300 text-ink-2'
            }`}
          >
            {o.name}
          </button>
        ))}
      </div>

      {pending && !preview && <p className="text-sm text-ink-4">กำลังคำนวณ…</p>}

      {preview?.ok && (
        <div className="space-y-2 rounded-md bg-gray-50 p-3 text-sm">
          <p className="font-medium text-ink-1">
            {preview.oldTypeName} → {preview.newTypeName}
          </p>
          <ul className="space-y-1">
            {preview.ripple.displayRows.map((row) => (
              <li key={row.leaveRequestId} className="flex justify-between text-ink-2">
                <span>
                  {row.group === 'moved' ? 'ใบนี้' : 'ใบเกี่ยวเนื่อง'}
                </span>
                <span>
                  ฿{(row.oldDeduct ?? 0).toLocaleString('th-TH')} → ฿{(row.newDeduct ?? 0).toLocaleString('th-TH')}
                </span>
              </li>
            ))}
          </ul>
          <p className={`font-medium ${preview.ripple.netDeductDelta <= 0 ? 'text-green-700' : 'text-red-700'}`}>
            รวมการหักเงินเปลี่ยน: ฿{preview.ripple.netDeductDelta.toLocaleString('th-TH')}
          </p>
        </div>
      )}

      {preview && !preview.ok && <p className="text-sm text-red-700">{preview.message}</p>}

      {preview?.ok && (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เหตุผลการแก้ประเภท (บังคับ)"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            rows={2}
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-ink-2"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending || note.trim() === ''}
              className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              ยืนยันการแก้ประเภท
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render the section in the modal**

In `src/app/(admin)/admin/leave/leave-review-modal.tsx`:

- Add the import: `import { CorrectTypeSection } from './correct-type-section';`
- Add `correctionTypeOptions?: Array<{ id: string; name: string }>;` to the `LeaveReviewModal` props, and thread it to `LeaveBody`.
- In `LeaveBody`, after the reason/attachment block and before/after the over-quota block, render:

```tsx
{row.correctable && correctionTypeOptions && (
  <CorrectTypeSection
    leaveRequestId={row.id}
    currentTypeId={row.leaveTypeId}
    options={correctionTypeOptions}
    onDone={onActioned}
  />
)}
```

`onActioned` must be passed down into `LeaveBody` (add it as a prop). If `LeaveBody` currently takes only `{ row }`, widen it to `{ row, correctionTypeOptions, onActioned }`.

- [ ] **Step 3: Pass options + refresh from the inbox**

In `src/app/(admin)/admin/leave/leave-inbox.tsx` (the component is `export function LeaveInbox({ rows }: { rows: LeaveRowVM[] })`):

- Widen its props to `{ rows, correctionTypeOptions }: { rows: LeaveRowVM[]; correctionTypeOptions: Array<{ id: string; name: string }> }`.
- Import `useRouter` from `next/navigation`; create `const router = useRouter();`.
- The modal is currently `<LeaveReviewModal row={open} onClose={() => setOpen(null)} />`. Change it to also pass `correctionTypeOptions={correctionTypeOptions}` and `onActioned={() => { setOpen(null); router.refresh(); }}`.

- [ ] **Step 4: Load DeductPay types in the page**

In `src/app/(admin)/admin/leave/page.tsx`, load the correction targets and pass them into the inbox:

```ts
const correctionTypeOptions = await prisma.leaveType.findMany({
  where: { archivedAt: null, overQuotaPolicy: 'DeductPay' },
  select: { id: true, name: true },
  orderBy: { name: 'asc' },
});
```

The page currently renders `<LeaveInbox rows={vm} />` (around line 294). Change it to `<LeaveInbox rows={vm} correctionTypeOptions={correctionTypeOptions} />`.

- [ ] **Step 5: Typecheck + lint + full suite**

Run: `npx tsc --noEmit && npx biome check src && npx vitest run`
Expected: clean; suite green.

- [ ] **Step 6: Verify in the browser**

Follow the preview verification workflow:
1. `preview_start` the dev server.
2. Log in as an admin, open `/admin/leave?status=Approved`.
3. Open a deducted ลากิจ request → click "เปลี่ยนประเภทการลา" → pick ลาป่วย.
4. Confirm the ripple shows `฿… → ฿0` for this row and a green net delta.
5. Confirm, then verify the row's type is now ลาป่วย and the deduction is gone in the reports view.
6. Open a request from an already-published month → the "เปลี่ยนประเภท" control must be absent (row not correctable).
7. `computer {action: "screenshot"}` the ripple preview as proof.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/admin/leave/correct-type-section.tsx" "src/app/(admin)/admin/leave/leave-review-modal.tsx" "src/app/(admin)/admin/leave/leave-inbox.tsx" "src/app/(admin)/admin/leave/page.tsx"
git commit -m "feat(leave): admin UI to correct leave type with money-ripple preview"
```

---

## Verification before merge

- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check src` clean
- [ ] `npx vitest run` — full suite green, count ≥ baseline (1,414 unit + integration)
- [ ] Manual browser walkthrough (Task 4, Step 6) done, screenshot captured
- [ ] Confirm no schema migration was added (`git status` shows nothing under `prisma/migrations/`)
- [ ] Deploy held until payroll `2026-07` closes (cutoffDay = 26)

## Spec coverage self-check

- Decision 1 (paid locked) → Task 2 guard + in-transaction re-check; Task 3 `correctable=false` when swept.
- Decision 2 (guard conditions) → Task 2 `loadCorrectionContext`.
- Decision 3 (two-replay preview) → Task 1 `computeCorrectionRipple`; Task 2 `previewLeaveTypeCorrection`.
- Decision 4 (atomic both-group transaction) → Task 2 `correctLeaveType`.
- Decision 5 (UI in existing modal) → Task 4.
- Decision 6 (new permission) → Task 2 Step 1.
- Ripple across both types → Task 1 tests 2 & 3.
- `chargedMinutes` unchanged → Task 1 uses stored `chargedMinutes` as an immutable input; never written.
- Zero-entitlement not silently zero → Task 1 test 6.
