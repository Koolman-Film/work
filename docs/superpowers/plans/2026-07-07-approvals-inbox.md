# Unified Approvals Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/admin/approvals` — a single inbox listing all pending leave, cash-advance, and disputed-check-in items, where the admin approves/rejects each inline by reusing the existing review modals.

**Architecture:** A server loader runs three permission+branch-scoped queries and maps them to cheap **slim cards**. The client list renders the merged, newest-first cards; clicking one **lazily fetches the full review VM** (via the existing `getLeaveReviewRow`/`getAdvanceReviewRow` getters, or a new `getDisputedReviewRow`) and opens the matching existing modal. No shipped approval page is modified; the heavy per-row work (over-quota preview, balance guard, URL signing) runs only for the opened row.

**Tech Stack:** Next.js App Router (server + client components), Prisma, Vitest (unit + integration), Tailwind, existing `@/components/ui/*` + `ReviewModal`.

## Global Constraints

- Do NOT modify `prisma/schema.prisma` (no schema changes).
- Do NOT modify the shipped pages `admin/leave/page.tsx`, `admin/advance/page.tsx`, `admin/attendance/disputed/page.tsx`, or the leave/advance review modals. Reuse by import only.
- Prisma import: `import { prisma } from '@/lib/db/prisma';`
- Pure modules (`src/lib/geo/distance.ts`, `src/lib/approvals/cards.ts`) must NOT import `prisma` or `server-only`. `src/lib/approvals/load-inbox.ts` is `server-only`.
- Reused getters: `getLeaveReviewRow(id)`, `getAdvanceReviewRow(id)` from `@/app/(admin)/admin/_calendar/actions` (already gate `leave.approve`/`advance.approve` + branch scope; return `LeaveRowVM | null` / `AdvanceRowVM | null`).
- Reused modals: `LeaveReviewModal` (`@/app/(admin)/admin/leave/leave-review-modal`, props `{ row: LeaveRowVM | null; onClose }`), `AdvanceReviewModal` (`@/app/(admin)/admin/advance/advance-review-modal`, props `{ row: AdvanceRowVM | null; onClose }`).
- Reused actions for disputes: `approveDisputed(input)`, `rejectDisputed(input)` from `@/lib/attendance/admin-review`, input `{ attendanceId: string; note: string }`, return `{ ok:true; nextStatus } | { ok:false; code; message }`.
- Selects: `LEAVE_SELECT` (`@/app/(admin)/admin/leave/leave-row-vm`), `ADVANCE_SELECT` (`@/app/(admin)/admin/advance/advance-row-vm`), `DISPUTED_SELECT` + `DisputedRow` (`@/app/(admin)/admin/attendance/disputed/_load-inbox`).
- Scoping: `permittedBranchesFromAssignments(assignments, permission)` + `viaEmployeeBranchScope(permitted)` from `@/lib/auth/branch-scope`; type `PermittedBranches`. Absent permission → `[]` → `{ employee: { id: { in: [] } } }` → 0 rows (verified).
- Assignments: `getUserAssignments(user.id)` from `@/lib/auth/check-permission` (same as `admin/layout.tsx`).
- Cap: `APPROVALS_CAP = 200` per queue.
- Money/date display: `formatTHB2` and `formatThaiDate` from `@/lib/format` (do NOT reach into the shipped row-vm files' private formatters).
- Thai UI strings inline, matching existing admin pages. `ReviewModal` calls `router.refresh()` on success — no extra revalidation needed.

---

### Task 1: Shared haversine distance helper

**Files:**
- Create: `src/lib/geo/distance.ts`
- Test: `src/lib/geo/distance.test.ts`

**Interfaces:**
- Produces: `haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number` (great-circle metres, rounded).

- [ ] **Step 1: Write the failing test**

Create `src/lib/geo/distance.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { haversineMeters } from './distance';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(13.7563, 100.5018, 13.7563, 100.5018)).toBe(0);
  });
  it('approximates a known short distance (~157m per 0.001° latitude near the equator-ish)', () => {
    // 0.001 degree of latitude ≈ 111 m; assert within tolerance.
    const d = haversineMeters(13.7563, 100.5018, 13.7573, 100.5018);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });
  it('returns a rounded integer', () => {
    const d = haversineMeters(13.75, 100.5, 13.76, 100.51);
    expect(Number.isInteger(d)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/geo/distance.test.ts`
Expected: FAIL — `Cannot find module './distance'`.

- [ ] **Step 3: Write the module**

Create `src/lib/geo/distance.ts`:

```typescript
/** Great-circle distance between two lat/lng points, in metres (rounded). */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/geo/distance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo/distance.ts src/lib/geo/distance.test.ts
git commit -m "feat(geo): shared haversineMeters distance helper"
```

---

### Task 2: Approval card mappers, filter, sort (pure)

**Files:**
- Create: `src/lib/approvals/cards.ts`
- Test: `src/lib/approvals/cards.test.ts`

**Interfaces:**
- Consumes: `haversineMeters` from `@/lib/geo/distance`; `formatTHB2`, `formatThaiDate` from `@/lib/format`.
- Produces:
  - `type ApprovalCard` (discriminated union below).
  - Input row types `LeaveCardInput`, `AdvanceCardInput`, `DisputedCardInput` (structural subsets of the prisma payloads — defined here so this module stays prisma-free).
  - `mapLeaveCard(r: LeaveCardInput): ApprovalCard`
  - `mapAdvanceCard(r: AdvanceCardInput): ApprovalCard`
  - `mapDisputedCard(r: DisputedCardInput): ApprovalCard`
  - `type ApprovalFilters = { type?: string; branchId?: string; q?: string }`
  - `filterApprovalCards(cards: ApprovalCard[], f: ApprovalFilters): ApprovalCard[]`
  - `sortApprovalCardsDesc(cards: ApprovalCard[]): ApprovalCard[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/approvals/cards.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  filterApprovalCards,
  mapAdvanceCard,
  mapDisputedCard,
  mapLeaveCard,
  sortApprovalCardsDesc,
} from './cards';

const emp = {
  firstName: 'สม',
  lastName: 'ชาย',
  nickname: 'หนึ่ง',
  branch: { name: 'สาขา A' },
  department: { name: 'ครัว' },
};

describe('mapLeaveCard', () => {
  it('builds a leave card with range and createdAt as submittedAt', () => {
    const c = mapLeaveCard({
      id: 'l1',
      createdAt: new Date('2026-07-01T03:00:00Z'),
      startDate: new Date('2026-07-10T00:00:00Z'),
      endDate: new Date('2026-07-11T00:00:00Z'),
      leaveType: { name: 'ลาป่วย' },
      employee: { ...emp, branchId: 'b1' },
    });
    expect(c.type).toBe('leave');
    expect(c).toMatchObject({ id: 'l1', employeeName: 'สม ชาย', branch: 'สาขา A', leaveType: 'ลาป่วย' });
    expect(c.submittedAt).toEqual(new Date('2026-07-01T03:00:00Z'));
    expect(typeof (c as { range: string }).range).toBe('string');
  });
});

describe('mapAdvanceCard', () => {
  it('formats amount and uses requestedAt as submittedAt', () => {
    const c = mapAdvanceCard({
      id: 'a1',
      amount: 2500,
      requestedAt: new Date('2026-07-02T03:00:00Z'),
      employee: { ...emp, branchId: 'b1' },
    });
    expect(c.type).toBe('advance');
    expect((c as { amount: string }).amount).toContain('2,500');
    expect(c.submittedAt).toEqual(new Date('2026-07-02T03:00:00Z'));
  });
});

describe('mapDisputedCard', () => {
  it('computes distance, clock-in label, and reason fallback', () => {
    const c = mapDisputedCard({
      id: 'd1',
      clockInAt: new Date('2026-07-03T02:30:00Z'), // 09:30 Bangkok
      checkInLat: 13.7573,
      checkInLng: 100.5018,
      disputeReason: null,
      checkInBranch: { latitude: 13.7563, longitude: 100.5018 },
      employee: { ...emp, branchId: 'b1' },
    });
    expect(c.type).toBe('disputed');
    const card = c as { distanceMeters: number | null; clockInLabel: string; reason: string };
    expect(card.distanceMeters).toBeGreaterThan(90);
    expect(card.clockInLabel).toContain('09:30');
    expect(card.reason).toBe('ไม่ระบุ');
  });
  it('is null distance when coords are missing', () => {
    const c = mapDisputedCard({
      id: 'd2',
      clockInAt: new Date('2026-07-03T02:30:00Z'),
      checkInLat: null,
      checkInLng: null,
      disputeReason: 'นอกพื้นที่',
      checkInBranch: { latitude: 13.75, longitude: 100.5 },
      employee: { ...emp, branchId: 'b1' },
    });
    expect((c as { distanceMeters: number | null }).distanceMeters).toBeNull();
    expect((c as { reason: string }).reason).toBe('นอกพื้นที่');
  });
});

describe('filterApprovalCards', () => {
  const cards = [
    mapLeaveCard({ id: 'l1', createdAt: new Date('2026-07-01'), startDate: new Date('2026-07-10'), endDate: new Date('2026-07-10'), leaveType: { name: 'ลา' }, employee: { ...emp, branchId: 'b1' } }),
    mapAdvanceCard({ id: 'a1', amount: 100, requestedAt: new Date('2026-07-02'), employee: { ...emp, firstName: 'อา', nickname: null, branchId: 'b2' } }),
  ];
  it('filters by type', () => {
    expect(filterApprovalCards(cards, { type: 'advance' }).map((c) => c.id)).toEqual(['a1']);
  });
  it('filters by branchId', () => {
    expect(filterApprovalCards(cards, { branchId: 'b2' }).map((c) => c.id)).toEqual(['a1']);
  });
  it('filters by employee-name query (case-insensitive, matches name or nickname)', () => {
    expect(filterApprovalCards(cards, { q: 'หนึ่ง' }).map((c) => c.id)).toEqual(['l1']);
  });
  it('ignores blank filters', () => {
    expect(filterApprovalCards(cards, { type: '', branchId: '  ', q: '' })).toHaveLength(2);
  });
});

describe('sortApprovalCardsDesc', () => {
  it('sorts newest submittedAt first, interleaving types', () => {
    const a = mapAdvanceCard({ id: 'a1', amount: 1, requestedAt: new Date('2026-07-05'), employee: { ...emp, branchId: 'b1' } });
    const l = mapLeaveCard({ id: 'l1', createdAt: new Date('2026-07-09'), startDate: new Date('2026-07-10'), endDate: new Date('2026-07-10'), leaveType: { name: 'ลา' }, employee: { ...emp, branchId: 'b1' } });
    expect(sortApprovalCardsDesc([a, l]).map((c) => c.id)).toEqual(['l1', 'a1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/approvals/cards.test.ts`
Expected: FAIL — `Cannot find module './cards'`.

- [ ] **Step 3: Write the module**

Create `src/lib/approvals/cards.ts`:

```typescript
import { formatTHB2, formatThaiDate } from '@/lib/format';
import { haversineMeters } from '@/lib/geo/distance';

type EmployeeShape = {
  firstName: string;
  lastName: string;
  nickname: string | null;
  branchId: string;
  branch: { name: string };
  department: { name: string } | null;
};

export type LeaveCardInput = {
  id: string;
  createdAt: Date;
  startDate: Date;
  endDate: Date;
  leaveType: { name: string };
  employee: EmployeeShape;
};

export type AdvanceCardInput = {
  id: string;
  amount: number | { toString(): string };
  requestedAt: Date;
  employee: EmployeeShape;
};

export type DisputedCardInput = {
  id: string;
  clockInAt: Date;
  checkInLat: number | { toString(): string } | null;
  checkInLng: number | { toString(): string } | null;
  disputeReason: string | null;
  checkInBranch: { latitude: number | { toString(): string }; longitude: number | { toString(): string } };
  employee: EmployeeShape;
};

type CardBase = {
  id: string;
  employeeName: string;
  nickname: string | null;
  branch: string;
  branchId: string;
  department: string | null;
  submittedAt: Date;
};

export type ApprovalCard =
  | (CardBase & { type: 'leave'; leaveType: string; range: string })
  | (CardBase & { type: 'advance'; amount: string })
  | (CardBase & { type: 'disputed'; clockInLabel: string; distanceMeters: number | null; reason: string });

export type ApprovalFilters = { type?: string; branchId?: string; q?: string };

function base(e: EmployeeShape, id: string, submittedAt: Date): CardBase {
  return {
    id,
    employeeName: `${e.firstName} ${e.lastName}`,
    nickname: e.nickname,
    branch: e.branch.name,
    branchId: e.branchId,
    department: e.department?.name ?? null,
    submittedAt,
  };
}

const num = (v: number | { toString(): string }): number =>
  typeof v === 'number' ? v : Number(v.toString());

export function mapLeaveCard(r: LeaveCardInput): ApprovalCard {
  const range =
    r.startDate.getTime() === r.endDate.getTime()
      ? formatThaiDate(r.startDate)
      : `${formatThaiDate(r.startDate)} – ${formatThaiDate(r.endDate)}`;
  return { ...base(r.employee, r.id, r.createdAt), type: 'leave', leaveType: r.leaveType.name, range };
}

export function mapAdvanceCard(r: AdvanceCardInput): ApprovalCard {
  return { ...base(r.employee, r.id, r.requestedAt), type: 'advance', amount: formatTHB2(num(r.amount)) };
}

export function mapDisputedCard(r: DisputedCardInput): ApprovalCard {
  const distanceMeters =
    r.checkInLat !== null && r.checkInLng !== null
      ? haversineMeters(
          num(r.checkInLat),
          num(r.checkInLng),
          num(r.checkInBranch.latitude),
          num(r.checkInBranch.longitude),
        )
      : null;
  const clockInLabel = r.clockInAt.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return {
    ...base(r.employee, r.id, r.clockInAt),
    type: 'disputed',
    clockInLabel,
    distanceMeters,
    reason: r.disputeReason ?? 'ไม่ระบุ',
  };
}

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export function filterApprovalCards(cards: ApprovalCard[], f: ApprovalFilters): ApprovalCard[] {
  const type = clean(f.type);
  const branchId = clean(f.branchId);
  const q = clean(f.q)?.toLowerCase();
  return cards.filter((c) => {
    if (type && c.type !== type) return false;
    if (branchId && c.branchId !== branchId) return false;
    if (q) {
      const hay = `${c.employeeName} ${c.nickname ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortApprovalCardsDesc(cards: ApprovalCard[]): ApprovalCard[] {
  return [...cards].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/approvals/cards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/approvals/cards.ts src/lib/approvals/cards.test.ts
git commit -m "feat(approvals): slim approval-card mappers, filter, sort (pure)"
```

---

### Task 3: `loadApprovalsInbox` server loader

**Files:**
- Create: `src/lib/approvals/load-inbox.ts`
- Test: `tests/integration/approvals-inbox.integration.test.ts`

**Interfaces:**
- Consumes: `prisma`; `permittedBranchesFromAssignments`, `viaEmployeeBranchScope`, `AssignmentForCheck` from `@/lib/auth/branch-scope`; `LEAVE_SELECT`, `ADVANCE_SELECT`, `DISPUTED_SELECT`; the mappers/filter/sort from `@/lib/approvals/cards`.
- Produces:
  - `const APPROVALS_CAP = 200`
  - `loadApprovalsInbox(assignments: ReadonlyArray<AssignmentForCheck>, filters: ApprovalFilters): Promise<{ cards: ApprovalCard[]; counts: { leave: number; advance: number; disputed: number; total: number }; capped: boolean }>`

- [ ] **Step 1: Write the module**

Create `src/lib/approvals/load-inbox.ts`:

```typescript
import 'server-only';
import type { AssignmentForCheck } from '@/lib/auth/branch-scope';
import { permittedBranchesFromAssignments, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';
import { ADVANCE_SELECT } from '@/app/(admin)/admin/advance/advance-row-vm';
import { DISPUTED_SELECT } from '@/app/(admin)/admin/attendance/disputed/_load-inbox';
import { LEAVE_SELECT } from '@/app/(admin)/admin/leave/leave-row-vm';
import {
  type ApprovalCard,
  type ApprovalFilters,
  filterApprovalCards,
  mapAdvanceCard,
  mapDisputedCard,
  mapLeaveCard,
  sortApprovalCardsDesc,
} from './cards';

export const APPROVALS_CAP = 200;

export async function loadApprovalsInbox(
  assignments: ReadonlyArray<AssignmentForCheck>,
  filters: ApprovalFilters,
): Promise<{
  cards: ApprovalCard[];
  counts: { leave: number; advance: number; disputed: number; total: number };
  capped: boolean;
}> {
  const leaveScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'leave.read'));
  const advScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'advance.read'));
  const attScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'attendance.read'));

  const take = APPROVALS_CAP + 1;
  const [leaveRows, advanceRows, disputedRows] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { status: 'Pending', ...leaveScope },
      orderBy: { createdAt: 'desc' },
      take,
      select: LEAVE_SELECT,
    }),
    prisma.cashAdvance.findMany({
      where: { status: 'Pending', ...advScope },
      orderBy: { requestedAt: 'desc' },
      take,
      select: ADVANCE_SELECT,
    }),
    prisma.attendance.findMany({
      where: { type: 'CheckIn', checkInStatus: 'Disputed', ...attScope },
      orderBy: { clockInAt: 'desc' },
      take,
      select: DISPUTED_SELECT,
    }),
  ]);

  const capped =
    leaveRows.length > APPROVALS_CAP ||
    advanceRows.length > APPROVALS_CAP ||
    disputedRows.length > APPROVALS_CAP;

  const leave = leaveRows.slice(0, APPROVALS_CAP);
  const advance = advanceRows.slice(0, APPROVALS_CAP);
  const disputed = disputedRows.slice(0, APPROVALS_CAP);

  const all: ApprovalCard[] = [
    ...leave.map((r) => mapLeaveCard(r as unknown as Parameters<typeof mapLeaveCard>[0])),
    ...advance.map((r) => mapAdvanceCard(r as unknown as Parameters<typeof mapAdvanceCard>[0])),
    ...disputed.map((r) => mapDisputedCard(r as unknown as Parameters<typeof mapDisputedCard>[0])),
  ];

  const cards = sortApprovalCardsDesc(filterApprovalCards(all, filters));

  return {
    cards,
    counts: {
      leave: leave.length,
      advance: advance.length,
      disputed: disputed.length,
      total: leave.length + advance.length + disputed.length,
    },
    capped,
  };
}
```

> Note on the `as unknown as` casts: the prisma payload types include extra fields (e.g. `employee.branchId` IS selected by `LEAVE_SELECT`? confirm) beyond the mappers' structural inputs. If `branchId` is NOT already in a `*_SELECT`, add it to the loader's `select` inline (spread the imported select and add `employee: { select: { ...existing, branchId: true } }`) rather than editing the shipped select constant. Verify each select includes: `employee.branchId`, and for leave `createdAt`/`startDate`/`endDate`/`leaveType.name`; for advance `amount`/`requestedAt`; for disputed `clockInAt`/`checkInLat`/`checkInLng`/`disputeReason`/`checkInBranch.latitude`/`checkInBranch.longitude`. `LEAVE_SELECT`/`ADVANCE_SELECT` select `employee` WITHOUT `branchId` today — so in this loader, override the `select` to add `employee: { select: { firstName:true, lastName:true, nickname:true, branchId:true, branch:{select:{name:true}}, department:{select:{name:true}} } }`. Keep `DISPUTED_SELECT`'s shape but likewise ensure `employee.branchId` + `checkInBranch.latitude/longitude` are present (extend inline if missing). Do NOT mutate the exported select constants.

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/approvals-inbox.integration.test.ts`:

```typescript
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { loadApprovalsInbox } from '@/lib/approvals/load-inbox';

type Assignment = { branchId: string | null; role: { isSuperadmin: boolean; permissions: string[]; archivedAt: Date | null } };
const superadmin: Assignment[] = [{ branchId: null, role: { isSuperadmin: true, permissions: [], archivedAt: null } }];
const leaveOnly: Assignment[] = [{ branchId: null, role: { isSuperadmin: false, permissions: ['leave.read'], archivedAt: null } }];

async function reset() {
  await prisma.attendance.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
}

async function seed() {
  const branch = await prisma.branch.create({ data: { name: 'HQ', latitude: 13.75, longitude: 100.5, radiusMeters: 100 } });
  const user = await prisma.user.create({ data: {} });
  const emp = await prisma.employee.create({
    data: { userId: user.id, firstName: 'สม', lastName: 'ชาย', branchId: branch.id, salaryType: 'Monthly', baseSalary: new Prisma.Decimal(20000), status: 'Active', hiredAt: new Date('2026-01-01') },
  });
  const lt = await prisma.leaveType.create({ data: { name: 'ลาป่วย', isPaid: true } });
  await prisma.leaveRequest.create({ data: { employeeId: emp.id, leaveTypeId: lt.id, startDate: new Date('2026-07-10'), endDate: new Date('2026-07-10'), unit: 'FullDay', reason: 'x', status: 'Pending', createdAt: new Date('2026-07-01') } });
  await prisma.cashAdvance.create({ data: { employeeId: emp.id, amount: new Prisma.Decimal(2500), status: 'Pending', requestedAt: new Date('2026-07-02') } });
  await prisma.leaveRequest.create({ data: { employeeId: emp.id, leaveTypeId: lt.id, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-01'), unit: 'FullDay', reason: 'old', status: 'Approved', createdAt: new Date('2026-06-01') } });
  return { branchId: branch.id };
}

beforeEach(reset);
afterAll(async () => { await prisma.$disconnect(); });

describe('loadApprovalsInbox', () => {
  it('aggregates pending leave + advance, newest first, excludes non-pending', async () => {
    await seed();
    const { cards, counts } = await loadApprovalsInbox(superadmin, {});
    expect(counts.leave).toBe(1);
    expect(counts.advance).toBe(1);
    expect(counts.total).toBe(2);
    expect(cards.map((c) => c.type)).toEqual(['advance', 'leave']); // advance 07-02 newer than leave 07-01
  });

  it('scopes by permission: leave.read only sees leave', async () => {
    await seed();
    const { cards, counts } = await loadApprovalsInbox(leaveOnly, {});
    expect(counts.advance).toBe(0);
    expect(counts.leave).toBe(1);
    expect(cards.every((c) => c.type === 'leave')).toBe(true);
  });

  it('applies the type filter', async () => {
    await seed();
    const { cards } = await loadApprovalsInbox(superadmin, { type: 'advance' });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.type).toBe('advance');
  });
});
```

> If `Branch`/`Employee`/`LeaveType` creation fails on required fields, mirror the fuller helpers in `tests/integration/reports.integration.test.ts`. The `Assignment` shape must match `AssignmentForCheck` — adjust field names to the real type if tsc complains.

- [ ] **Step 3: Run the integration test**

Run: `npm run test:integration -- approvals-inbox`
Expected: PASS. (Local test DB per `vitest.integration.config.ts`; if a migration is pending run `npm run db:test:deploy` first. If the DB is unreachable, report DONE_WITH_CONCERNS with the exact error — do not fake it.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/approvals/load-inbox.ts tests/integration/approvals-inbox.integration.test.ts
git commit -m "feat(approvals): loadApprovalsInbox — scoped aggregation of pending queues"
```

---

### Task 4: `getDisputedReviewRow` single-record action

**Files:**
- Create: `src/app/(admin)/admin/approvals/disputed-review.ts`

**Interfaces:**
- Consumes: `prisma`; `requirePermission`, `getPermittedBranches` (from `@/lib/auth/check-permission` / `@/lib/auth/branch-scope` — match how `_calendar/actions.ts` imports them); `viaEmployeeBranchScope`; `DISPUTED_SELECT`; `resolveStoredImageUrl` from `@/lib/storage/signed-urls`; `haversineMeters`.
- Produces:
  - `type DisputedReviewVM = { id: string; name: string; nickname: string | null; branch: string; clockInLabel: string; distanceMeters: number | null; reason: string; selfieUrl: string | null }`
  - `getDisputedReviewRow(attendanceId: string): Promise<DisputedReviewVM | null>`

- [ ] **Step 1: Create the action**

Create `src/app/(admin)/admin/approvals/disputed-review.ts`:

```typescript
'use server';

import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { haversineMeters } from '@/lib/geo/distance';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { DISPUTED_SELECT } from '@/app/(admin)/admin/attendance/disputed/_load-inbox';

export type DisputedReviewVM = {
  id: string;
  name: string;
  nickname: string | null;
  branch: string;
  clockInLabel: string;
  distanceMeters: number | null;
  reason: string;
  selfieUrl: string | null;
};

export async function getDisputedReviewRow(attendanceId: string): Promise<DisputedReviewVM | null> {
  const { user } = await requirePermission('attendance.dispute-resolve');
  const permitted = await getPermittedBranches(user, 'attendance.dispute-resolve');
  const r = await prisma.attendance.findFirst({
    where: {
      id: attendanceId,
      type: 'CheckIn',
      checkInStatus: 'Disputed',
      ...viaEmployeeBranchScope(permitted),
    },
    select: DISPUTED_SELECT,
  });
  if (!r) return null;

  const distanceMeters =
    r.checkInLat !== null && r.checkInLng !== null
      ? haversineMeters(
          Number(r.checkInLat),
          Number(r.checkInLng),
          Number(r.checkInBranch.latitude),
          Number(r.checkInBranch.longitude),
        )
      : null;

  return {
    id: r.id,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
    nickname: r.employee.nickname,
    branch: r.employee.branch.name,
    clockInLabel: r.clockInAt.toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    }),
    distanceMeters,
    reason: r.disputeReason ?? 'ไม่ระบุ',
    selfieUrl: await resolveStoredImageUrl(r.checkInSelfieUrl),
  };
}
```

> Verify import paths against `_calendar/actions.ts`: `getPermittedBranches`/`requirePermission` may both come from different modules than guessed — copy that file's import lines. Confirm `DISPUTED_SELECT` includes `checkInBranch.latitude`/`longitude` (it does per the disputed loader) and `checkInSelfieUrl`.

- [ ] **Step 2: Typecheck & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/approvals/disputed-review.ts"
git commit -m "feat(approvals): getDisputedReviewRow single-record VM getter"
```

---

### Task 5: `DisputedReviewModalLite` client component

**Files:**
- Create: `src/app/(admin)/admin/approvals/disputed-review-modal-lite.tsx`

**Interfaces:**
- Consumes: `ReviewModal` from `@/components/ui/review-modal`; `approveDisputed`, `rejectDisputed` from `@/lib/attendance/admin-review`; `DisputedReviewVM` from `./disputed-review`.
- Produces: `DisputedReviewModalLite({ row, onClose }: { row: DisputedReviewVM | null; onClose: () => void })`.

- [ ] **Step 1: Create the component**

Create `src/app/(admin)/admin/approvals/disputed-review-modal-lite.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { ReviewModal } from '@/components/ui/review-modal';
import { approveDisputed, rejectDisputed } from '@/lib/attendance/admin-review';
import type { DisputedReviewVM } from './disputed-review';

export function DisputedReviewModalLite({
  row,
  onClose,
}: {
  row: DisputedReviewVM | null;
  onClose: () => void;
}) {
  return (
    <ReviewModal
      open={row !== null}
      onClose={onClose}
      title="ตรวจสอบการลงเวลา"
      note={{ required: true, placeholder: 'เช่น: อยู่นอกพื้นที่แต่มีเหตุจำเป็น — อนุมัติ' }}
      onApprove={row ? (n) => approveDisputed({ attendanceId: row.id, note: n }) : undefined}
      onReject={row ? (n) => rejectDisputed({ attendanceId: row.id, note: n }) : undefined}
    >
      {row && (
        <div className="space-y-2 text-sm">
          <div className="font-medium text-ink-1">
            {row.name}
            {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
          </div>
          <div className="text-ink-3">สาขา: {row.branch}</div>
          <div className="text-ink-3">เวลาเข้างาน: {row.clockInLabel}</div>
          <div className="text-ink-3">
            ระยะห่างจากสาขา: {row.distanceMeters === null ? '—' : `${row.distanceMeters} ม.`}
          </div>
          <div className="text-ink-3">เหตุผลระบบ: {row.reason}</div>
          {row.selfieUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.selfieUrl} alt="selfie" className="mt-2 max-h-48 rounded-lg" />
          )}
          <Link
            href="/admin/attendance/disputed"
            className="inline-block pt-1 text-primary-700 hover:text-primary-800"
          >
            ดูแผนที่ / ดูรายละเอียดเต็ม →
          </Link>
        </div>
      )}
    </ReviewModal>
  );
}
```

> Confirm `text-ink-*` / `text-primary-*` tokens exist (they do — used across admin). If the repo forbids `<img>` via lint, use the same escape the codebase uses for signed selfies elsewhere (the disputed page renders a selfie — match its approach).

- [ ] **Step 2: Typecheck & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/approvals/disputed-review-modal-lite.tsx"
git commit -m "feat(approvals): light disputed review modal"
```

---

### Task 6: `ApprovalsList` client component (card → lazy VM → modal)

**Files:**
- Create: `src/app/(admin)/admin/approvals/approvals-list.tsx`

**Interfaces:**
- Consumes: `ApprovalCard` from `@/lib/approvals/cards`; `getLeaveReviewRow`, `getAdvanceReviewRow` from `@/app/(admin)/admin/_calendar/actions`; `LeaveReviewModal`, `AdvanceReviewModal`; `DisputedReviewModalLite` + `getDisputedReviewRow` from `./disputed-review*`; `StatusBadge`.
- Produces: `ApprovalsList({ cards, canReview }: { cards: ApprovalCard[]; canReview: { leave: boolean; advance: boolean; disputed: boolean } })`.

- [ ] **Step 1: Create the component**

Create `src/app/(admin)/admin/approvals/approvals-list.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { AdvanceRowVM } from '@/app/(admin)/admin/advance/advance-review-modal';
import { AdvanceReviewModal } from '@/app/(admin)/admin/advance/advance-review-modal';
import { getAdvanceReviewRow, getLeaveReviewRow } from '@/app/(admin)/admin/_calendar/actions';
import type { LeaveRowVM } from '@/app/(admin)/admin/leave/leave-review-modal';
import { LeaveReviewModal } from '@/app/(admin)/admin/leave/leave-review-modal';
import type { ApprovalCard } from '@/lib/approvals/cards';
import { StatusBadge } from '@/components/ui/status-badge';
import { getDisputedReviewRow, type DisputedReviewVM } from './disputed-review';
import { DisputedReviewModalLite } from './disputed-review-modal-lite';

const TYPE_LABEL: Record<ApprovalCard['type'], string> = {
  leave: 'ลา',
  advance: 'เบิก',
  disputed: 'ลงเวลา',
};

export function ApprovalsList({
  cards,
  canReview,
}: {
  cards: ApprovalCard[];
  canReview: { leave: boolean; advance: boolean; disputed: boolean };
}) {
  const [leaveRow, setLeaveRow] = useState<LeaveRowVM | null>(null);
  const [advanceRow, setAdvanceRow] = useState<AdvanceRowVM | null>(null);
  const [disputedRow, setDisputedRow] = useState<DisputedReviewVM | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function open(card: ApprovalCard) {
    if (!canReview[card.type]) return;
    setLoadingId(card.id);
    try {
      if (card.type === 'leave') setLeaveRow(await getLeaveReviewRow(card.id));
      else if (card.type === 'advance') setAdvanceRow(await getAdvanceReviewRow(card.id));
      else setDisputedRow(await getDisputedReviewRow(card.id));
    } finally {
      setLoadingId(null);
    }
  }

  function summary(card: ApprovalCard): string {
    if (card.type === 'leave') return `${card.leaveType} · ${card.range}`;
    if (card.type === 'advance') return card.amount;
    return `${card.clockInLabel}${card.distanceMeters === null ? '' : ` · ${card.distanceMeters} ม.`} · ${card.reason}`;
  }

  return (
    <>
      <ul className="space-y-2">
        {cards.map((card) => {
          const clickable = canReview[card.type];
          return (
            <li key={`${card.type}:${card.id}`} className="surface px-4 py-3">
              <button
                type="button"
                onClick={() => open(card)}
                disabled={!clickable || loadingId === card.id}
                className="flex w-full items-center justify-between gap-3 text-left disabled:cursor-default"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status="neutral">{TYPE_LABEL[card.type]}</StatusBadge>
                  <span className="font-medium text-ink-1">
                    {card.employeeName}
                    {card.nickname && <span className="text-ink-3"> ({card.nickname})</span>}
                  </span>
                  <span className="text-ink-3">· {summary(card)}</span>
                  <span className="text-xs text-ink-4">· {card.branch}</span>
                </span>
                {loadingId === card.id && <span className="text-xs text-ink-4">กำลังโหลด…</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <LeaveReviewModal row={leaveRow} onClose={() => setLeaveRow(null)} />
      <AdvanceReviewModal row={advanceRow} onClose={() => setAdvanceRow(null)} />
      <DisputedReviewModalLite row={disputedRow} onClose={() => setDisputedRow(null)} />
    </>
  );
}
```

> Confirm `StatusBadge` accepts a `'neutral'` key (it's referenced in the existing row VMs as a default `StatusKey`). If not, use any existing muted key. Confirm `LeaveRowVM`/`AdvanceRowVM` are exported from the modal files (they are, per the row-vm map).

- [ ] **Step 2: Typecheck & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/approvals/approvals-list.tsx"
git commit -m "feat(approvals): list with lazy VM fetch + modal dispatch"
```

---

### Task 7: `ApprovalsFilters` client component

**Files:**
- Create: `src/app/(admin)/admin/approvals/approvals-filters.tsx`

**Interfaces:**
- Consumes: `useRouter` from `next/navigation`.
- Produces: `ApprovalsFilters({ initial, branches }: { initial: { type?: string; branchId?: string; q?: string }; branches: { id: string; name: string }[] })`.

- [ ] **Step 1: Create the component**

Create `src/app/(admin)/admin/approvals/approvals-filters.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

const TYPES = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'leave', label: 'ลา' },
  { value: 'advance', label: 'เบิก' },
  { value: 'disputed', label: 'ลงเวลา' },
];

export function ApprovalsFilters({
  initial,
  branches,
}: {
  initial: { type?: string; branchId?: string; q?: string };
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      const value = typeof v === 'string' ? v.trim() : '';
      if (value) params.set(k, value);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/approvals?${qs}` : '/admin/approvals');
  }

  const hasAny = !!(initial.type || initial.branchId || initial.q);

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <select
          name="type"
          defaultValue={initial.type ?? ''}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          name="branchId"
          defaultValue={initial.branchId ?? ''}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <input
          type="search"
          name="q"
          defaultValue={initial.q ?? ''}
          placeholder="ค้นหาชื่อพนักงาน"
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
        />

        <button
          type="submit"
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          กรอง
        </button>

        {hasAny && (
          <Link href="/admin/approvals" className="text-sm text-ink-4 hover:text-ink-2">
            ล้างทั้งหมด
          </Link>
        )}
      </div>
    </form>
  );
}
```

> Match the exact input/select/button classes to `src/app/(admin)/admin/employees/employee-filters.tsx` if they differ — that file is the canonical filter styling. Adjust the submit button to the shared `Button` component if that's what employee-filters uses.

- [ ] **Step 2: Typecheck & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/approvals/approvals-filters.tsx"
git commit -m "feat(approvals): URL-driven filter bar (type/branch/search)"
```

---

### Task 8: Approvals page (server component)

**Files:**
- Create: `src/app/(admin)/admin/approvals/page.tsx`

**Interfaces:**
- Consumes: `requireAdminArea` from `@/lib/auth/admin-area`; `getUserAssignments` from `@/lib/auth/check-permission`; `loadApprovalsInbox` from `@/lib/approvals/load-inbox`; `prisma`; `ApprovalsList`, `ApprovalsFilters`; `PageHeader`; `notFound` from `next/navigation`.

- [ ] **Step 1: Create the page**

Create `src/app/(admin)/admin/approvals/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requireAdminArea } from '@/lib/auth/admin-area';
import { getUserAssignments } from '@/lib/auth/check-permission';
import { loadApprovalsInbox } from '@/lib/approvals/load-inbox';
import { prisma } from '@/lib/db/prisma';
import { PageHeader } from '@/components/ui/page-header';
import { ApprovalsFilters } from './approvals-filters';
import { ApprovalsList } from './approvals-list';

type SearchParams = Promise<{ type?: string; branchId?: string; q?: string }>;

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, permissions } = await requireAdminArea();
  const canRead =
    permissions.has('leave.read') || permissions.has('advance.read') || permissions.has('attendance.read');
  if (!canRead) notFound();

  const sp = await searchParams;
  const assignments = await getUserAssignments(user.id);
  const { cards, counts, capped } = await loadApprovalsInbox(assignments, sp);

  const branches = await prisma.branch.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const canReview = {
    leave: permissions.has('leave.approve'),
    advance: permissions.has('advance.approve'),
    disputed: permissions.has('attendance.dispute-resolve'),
  };

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={`รออนุมัติ${counts.total > 0 ? ` (${counts.total})` : ''}`} />

      <ApprovalsFilters initial={sp} branches={branches} />

      {capped && (
        <p className="mb-3 text-xs text-ink-4">แสดงรายการล่าสุดบางส่วน — ใช้ตัวกรองเพื่อจำกัดผลลัพธ์</p>
      )}

      {cards.length === 0 ? (
        <div className="surface p-8 text-center text-ink-4">ไม่มีรายการรออนุมัติ</div>
      ) : (
        <ApprovalsList cards={cards} canReview={canReview} />
      )}
    </div>
  );
}
```

> Match `PageHeader` props and the outer container classes to `admin/employees/page.tsx`.

- [ ] **Step 2: Typecheck & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Manual smoke (dev server)**

Sign in as an admin, visit `/admin/approvals`. Verify: pending leave/advance/disputes appear newest-first; clicking a leave row opens the leave modal and approving refreshes the list (row drops out); a filter narrows results and updates the URL; a disputed row opens the light modal with distance + selfie + the "full detail" link.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/approvals/page.tsx"
git commit -m "feat(approvals): /admin/approvals page — gated aggregated inbox"
```

---

### Task 9: Sidebar item + combined badge

**Files:**
- Modify: `src/components/admin/sidebar.tsx`
- Modify: `src/app/(admin)/layout.tsx`

- [ ] **Step 1: Extend `SidebarBadges` and add the nav item**

In `src/components/admin/sidebar.tsx`:

Add `approvals` to the `SidebarBadges` type (after `attendance`):

```tsx
export type SidebarBadges = {
  /** LeaveRequest rows with status=Pending. */
  leave: number;
  /** CashAdvance rows with status=Pending. */
  advance: number;
  /** Attendance check-ins with checkInStatus=Disputed. */
  attendance: number;
  /** Combined pending across leave+advance+attendance. */
  approvals: number;
};
```

In the `SECTIONS` array, add this as the FIRST item of the `งานประจำวัน` (Daily Work) section, before the existing attendance item:

```tsx
{
  href: '/admin/approvals',
  label: 'รออนุมัติ',
  Icon: Inbox,
  enabled: true,
  badgeKey: 'approvals',
  anyOf: ['leave.read', 'advance.read', 'attendance.read'],
},
```

Add `Inbox` to the existing `lucide-react` import (alphabetically). Do not change any other item.

- [ ] **Step 2: Pass the combined badge from the layout**

In `src/app/(admin)/layout.tsx`, extend the badges object passed to `<Sidebar>`:

```tsx
const { leave, advance, attendance } = await loadSidebarBadgeCounts(assignments);

return (
  <div className="flex min-h-dvh bg-canvas">
    <Sidebar
      badges={{ leave, advance, attendance, approvals: leave + advance + attendance }}
      allowedPermissions={[...permissions]}
    />
```

- [ ] **Step 3: Verify typecheck, lint, and full unit suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all green.

- [ ] **Step 4: Manual check**

Reload the admin app: "รออนุมัติ" appears at the top of งานประจำวัน with a badge equal to the sum of the leave/advance/disputed counts; clicking opens the inbox.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/sidebar.tsx "src/app/(admin)/layout.tsx"
git commit -m "feat(approvals): sidebar entry with combined pending badge"
```

---

## Self-Review

**Spec coverage** (against `2026-07-07-approvals-inbox-design.md`):

- Route + `anyOf` read gate → Task 8. ✅
- Sidebar item + combined badge (`SidebarBadges.approvals`) → Task 9. ✅
- Slim-card data layer (`loadApprovalsInbox`, 3 scoped queries, cap, counts) → Task 3. ✅
- Pure card mappers + filter + sort → Task 2; shared haversine → Task 1. ✅
- Lazy full-VM on click via existing `getLeaveReviewRow`/`getAdvanceReviewRow` + reused modals → Task 6. ✅
- New `getDisputedReviewRow` + light modal → Tasks 4, 5. ✅
- Clickability gated per approve-permission (`canReview`) → Tasks 6, 8. ✅
- URL-driven filters (type/branch/q) → Tasks 7, 2. ✅
- Testing: unit (distance, mappers, filter/sort) + integration (scoping, aggregation, pending-only) → Tasks 1–3. ✅
- Non-goals (bulk, replacing pages, cross-type pagination, realtime) → not implemented. ✅

**Known-unknowns flagged for the implementer** (not placeholders — real reconciliations against shipped code):
- `LEAVE_SELECT`/`ADVANCE_SELECT` do not currently select `employee.branchId`; Task 3 overrides the `select` inline (without mutating the exported constant) to add it. The integration test will fail loudly if a field is missing.
- Exact import modules for `requirePermission`/`getPermittedBranches` (Task 4) and `PageHeader` props (Task 8) must be copied from `_calendar/actions.ts` and `employees/page.tsx` respectively.
- Filter-control and submit-button classes (Tasks 7) matched to `employee-filters.tsx`.
- `StatusBadge` `'neutral'` key existence (Task 6).

**Placeholder scan:** No TBD/TODO in steps. Design-token/import reconciliations are called out explicitly with the file to copy from.

**Type consistency:** `ApprovalCard` (Task 2) consumed by Tasks 3 & 6 — field names match. `loadApprovalsInbox` return shape (Task 3) matches the page's destructure (Task 8). `DisputedReviewVM` (Task 4) consumed by Tasks 5 & 6. `canReview: { leave; advance; disputed }` produced in Task 8 matches `ApprovalsList` prop (Task 6). `SidebarBadges.approvals` (Task 9 sidebar) matches the layout's badges object (Task 9 layout).
