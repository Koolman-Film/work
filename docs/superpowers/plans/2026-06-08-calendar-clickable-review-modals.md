# Calendar: reimbursements + clickable review modals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/admin/calendar`, surface cash-advance (เบิก) requests on the grid and make every right-panel day-detail row clickable to open the matching review modal (`ตรวจสอบคำขอลา` / `ตรวจสอบคำขอเบิก`) for approve/reject/void — without changing the shared employee LIFF calendar.

**Architecture:** Extend the calendar data shape with an admin-only `advances` array (anchored to `CashAdvance.requestedAt`). `CalendarGrid` gains optional `advances` + `onLeaveClick`/`onAdvanceClick`/`busyId` props; when callbacks are present (admin only) the right-panel rows become buttons. Clicking fetches the full review VM via a permission-checked server action and opens the existing review modal, which we extract from the inbox pages into reusable client components. VM-building logic is extracted into server-only modules shared by the inbox pages and the new actions.

**Tech Stack:** Next.js App Router (RSC + server actions), TypeScript, Prisma, Tailwind, Vitest (pure-helper unit tests), Playwright (e2e). Node 24+/pnpm (prepend `/opt/homebrew/bin` to PATH; worktree already has `pnpm install` + `.env.local`).

---

## Environment note (read first)

This is a git worktree. Before running any command that touches Node:

```bash
export PATH="/opt/homebrew/bin:$PATH"   # Node 24+ — repo refuses v22
```

`node_modules` and `.env.local` are already set up in this worktree. Commit hooks run `lint-staged` (biome); keep changes lint-clean.

Commands used throughout:
- Unit tests: `pnpm test` (or `pnpm vitest run src/lib/leave/team-calendar.test.ts`)
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- E2e: `pnpm test:e2e -- <spec>`

---

## File structure

**Modify:**
- `src/lib/leave/team-calendar-shape.ts` — add `TeamCalendarAdvance`, `advances` on `TeamCalendarData`, `indexAdvancesByDate`.
- `src/lib/leave/team-calendar.ts` — `loadEntriesAndHolidays` returns `advances: []`; `getOrgCalendarData` loads + merges advances.
- `src/lib/leave/team-calendar.test.ts` — unit tests for `indexAdvancesByDate`.
- `src/app/(liff)/liff/calendar/calendar-grid.tsx` — render advance chips + clickable rows + new props.
- `src/app/(admin)/admin/_calendar/actions.ts` — `getLeaveReviewRow` / `getAdvanceReviewRow`.
- `src/app/(admin)/admin/_calendar/admin-calendar-card.tsx` — wire clicks → fetch → modals.
- `src/app/(admin)/admin/leave/leave-inbox.tsx` — slim down to list + `<LeaveReviewModal>`.
- `src/app/(admin)/admin/advance/advance-inbox.tsx` — slim down to list + `<AdvanceReviewModal>`.
- `src/app/(admin)/admin/leave/page.tsx` — use shared `buildLeaveRowVM`.
- `src/app/(admin)/admin/advance/page.tsx` — use shared `buildAdvanceRowVM`.

**Create:**
- `src/app/(admin)/admin/leave/leave-review-modal.tsx` (client) — `LeaveReviewModal` + `LeaveRowVM` type.
- `src/app/(admin)/admin/advance/advance-review-modal.tsx` (client) — `AdvanceReviewModal` + `AdvanceRowVM` type.
- `src/app/(admin)/admin/leave/leave-row-vm.ts` (server-only) — `LEAVE_SELECT`, `buildLeaveRowVM`, helpers.
- `src/app/(admin)/admin/advance/advance-row-vm.ts` (server-only) — `ADVANCE_SELECT`, `buildAdvanceRowVM`, helpers.
- `tests/e2e/calendar-review.spec.ts` — e2e for calendar → click → approve.

---

## Task 1: Add `TeamCalendarAdvance` type, `advances` field, and `indexAdvancesByDate` helper

**Files:**
- Modify: `src/lib/leave/team-calendar-shape.ts`
- Modify: `src/lib/leave/team-calendar.ts` (keep typecheck green: return `advances: []`)
- Test: `src/lib/leave/team-calendar.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/leave/team-calendar.test.ts`. First extend the imports at the top of the file:

```ts
import {
  buildMonthGrid,
  formatThaiMonthLabel,
  indexAdvancesByDate,
  indexEntriesByDate,
  parseMonth,
  shiftMonth,
  type TeamCalendarAdvance,
  type TeamCalendarEntry,
} from './team-calendar-shape';
```

Then append this describe block at the end of the file:

```ts
describe('indexAdvancesByDate', () => {
  const base: Omit<TeamCalendarAdvance, 'cashAdvanceId' | 'date'> = {
    employeeId: 'emp-1',
    employeeName: 'Alice Smith',
    shortLabel: 'Alice',
    amountLabel: '฿1,500.00',
    status: 'Pending',
  };

  it('keys an advance on its single anchor day', () => {
    const idx = indexAdvancesByDate([{ ...base, cashAdvanceId: 'a1', date: '2026-06-08' }]);
    expect(idx.size).toBe(1);
    expect(idx.get('2026-06-08')?.length).toBe(1);
  });

  it('groups multiple advances on the same day', () => {
    const idx = indexAdvancesByDate([
      { ...base, cashAdvanceId: 'a1', date: '2026-06-08' },
      { ...base, cashAdvanceId: 'a2', employeeId: 'emp-2', date: '2026-06-08' },
    ]);
    expect(idx.get('2026-06-08')?.length).toBe(2);
  });

  it('returns an empty map for no advances', () => {
    expect(indexAdvancesByDate([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm vitest run src/lib/leave/team-calendar.test.ts`
Expected: FAIL — `indexAdvancesByDate` / `TeamCalendarAdvance` are not exported.

- [ ] **Step 3: Implement the type, field, and helper**

In `src/lib/leave/team-calendar-shape.ts`, add the type after `TeamCalendarEntry` (around line 30):

```ts
export type TeamCalendarAdvance = {
  cashAdvanceId: string;
  employeeId: string;
  employeeName: string;
  /** Short label — nickname if present, else first name. Compact for grid chips. */
  shortLabel: string;
  /** Pre-formatted THB amount, e.g. "฿1,500.00". */
  amountLabel: string;
  status: 'Pending' | 'Approved';
  /** Single anchor day = requestedAt as a Bangkok-calendar YYYY-MM-DD. */
  date: string;
};
```

Change `TeamCalendarData` to include advances:

```ts
export type TeamCalendarData = {
  entries: TeamCalendarEntry[];
  holidays: TeamCalendarHoliday[];
  advances: TeamCalendarAdvance[];
};
```

Add the helper next to `indexEntriesByDate` (after it, around line 132):

```ts
/** Group advances by their single anchor day (YYYY-MM-DD). */
export function indexAdvancesByDate(
  advances: TeamCalendarAdvance[],
): Map<string, TeamCalendarAdvance[]> {
  const idx = new Map<string, TeamCalendarAdvance[]>();
  for (const a of advances) {
    const arr = idx.get(a.date);
    if (arr) arr.push(a);
    else idx.set(a.date, [a]);
  }
  return idx;
}
```

In `src/lib/leave/team-calendar.ts`, keep typecheck green by adding `advances: []` to BOTH return statements in `loadEntriesAndHolidays`. The early empty-employees return (around line 61):

```ts
  if (employees.length === 0) {
    const holidays = await holidaysPromise;
    return {
      entries: [],
      holidays: holidays.map((h) => ({ date: ymd(h.date), name: h.name })),
      advances: [],
    };
  }
```

And the main return (around line 112):

```ts
  return {
    entries,
    holidays: holidays.map((h) => ({ date: ymd(h.date), name: h.name })),
    advances: [],
  };
```

Also update the import on line 27 to include the new type (used in Task 2):

```ts
import {
  type TeamCalendarAdvance,
  type TeamCalendarData,
  type TeamCalendarEntry,
  ymd,
} from './team-calendar-shape';
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm vitest run src/lib/leave/team-calendar.test.ts && pnpm typecheck`
Expected: PASS — 3 new tests green; typecheck clean (every `TeamCalendarData` construction now has `advances`). `getTeamCalendarData`'s `if (!me) return { entries: [], holidays: [] }` early-return will fail typecheck — fix it to `return { entries: [], holidays: [], advances: [] }` (around line 136).

- [ ] **Step 5: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add src/lib/leave/team-calendar-shape.ts src/lib/leave/team-calendar.ts src/lib/leave/team-calendar.test.ts
git commit -m "feat(calendar): add TeamCalendarAdvance shape + indexAdvancesByDate"
```

---

## Task 2: Load advances in `getOrgCalendarData` (admin-only)

**Files:**
- Modify: `src/lib/leave/team-calendar.ts`

- [ ] **Step 1: Implement advance loading + merge**

Replace the body of `getOrgCalendarData` (currently ends with `return loadEntriesAndHolidays({...})`, around lines 157-178) so it merges advances:

```ts
export async function getOrgCalendarData(args: {
  monthStart: Date;
  monthEnd: Date;
  branchId?: string | null;
}): Promise<TeamCalendarData> {
  const { monthStart, monthEnd, branchId } = args;

  const where: Prisma.EmployeeWhereInput = {
    archivedAt: null,
    status: { not: 'Archived' },
  };
  if (branchId) {
    where.OR = [{ branchId }, { assignedBranchIds: { hasSome: [branchId] } }];
  }

  const employees = await prisma.employee.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });

  const base = await loadEntriesAndHolidays({
    employees,
    monthStart,
    monthEnd,
    viewerEmployeeId: null,
  });
  if (employees.length === 0) return base; // base.advances already []

  // Cash advances are point-in-time: anchor each to its requestedAt day. Window
  // is [monthStart, firstOfNextMonth) so the whole last day of the month is
  // included. `prisma` (not prismaRaw) already excludes soft-deleted rows.
  const nextMonthStart = new Date(monthEnd.getTime() + 86_400_000);
  const advanceRows = await prisma.cashAdvance.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      status: { in: ['Pending', 'Approved'] },
      requestedAt: { gte: monthStart, lt: nextMonthStart },
    },
    select: { id: true, employeeId: true, amount: true, status: true, requestedAt: true },
    orderBy: { requestedAt: 'asc' },
  });

  const empMap = new Map(employees.map((e) => [e.id, e]));
  const thb = new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  });

  const advances: TeamCalendarAdvance[] = advanceRows
    .map((a): TeamCalendarAdvance | null => {
      const emp = empMap.get(a.employeeId);
      if (!emp) return null; // shouldn't happen given the IN clause
      return {
        cashAdvanceId: a.id,
        employeeId: a.employeeId,
        employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
        shortLabel: emp.nickname?.trim() || emp.firstName,
        amountLabel: thb.format(Number(a.amount)),
        status: a.status as 'Pending' | 'Approved',
        // Bangkok-calendar day so the anchor matches the grid's day cells.
        date: a.requestedAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }),
      };
    })
    .filter((x): x is TeamCalendarAdvance => x !== null);

  return { ...base, advances };
}
```

- [ ] **Step 2: Typecheck + existing tests**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm typecheck && pnpm vitest run src/lib/leave/team-calendar.test.ts`
Expected: PASS — clean typecheck; existing helper tests still green. (`getTeamCalendarData` still returns `advances: []` via `loadEntriesAndHolidays`, so employees never see advances — admin-only by construction.)

- [ ] **Step 3: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add src/lib/leave/team-calendar.ts
git commit -m "feat(calendar): load Pending+Approved advances in org calendar loader"
```

---

## Task 3: Extract `LeaveReviewModal` + `LeaveRowVM` from `leave-inbox.tsx`

**Files:**
- Create: `src/app/(admin)/admin/leave/leave-review-modal.tsx`
- Modify: `src/app/(admin)/admin/leave/leave-inbox.tsx`

- [ ] **Step 1: Create `leave-review-modal.tsx`**

Move the `LeaveRowVM` type, `Badge`, `LeaveBody`, and the `<ReviewModal>` wiring out of `leave-inbox.tsx` into a standalone, reusable modal component:

```tsx
'use client';

import { ReviewModal } from '@/components/ui/review-modal';
import { STATUS_ICON, StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { approveLeaveRequest, rejectLeaveRequest } from '@/lib/leave/admin';
import { voidLeaveRequest } from '@/lib/leave/void';

export type LeaveRowVM = {
  id: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  statusKey: StatusKey;
  statusLabel: string;
  name: string;
  nickname: string | null;
  branch: string;
  department: string | null;
  leaveType: string;
  isPaid: boolean;
  range: string;
  workingDays: number;
  submitted: string;
  reason: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  attachmentUrl: string | null;
};

function Badge({ row }: { row: LeaveRowVM }) {
  return (
    <StatusBadge status={row.statusKey}>
      {STATUS_ICON[row.statusKey] ?? ''} {row.statusLabel}
    </StatusBadge>
  );
}

/**
 * Review modal for a single leave request. `row === null` keeps it closed.
 * Shared by the leave inbox list and the admin calendar's day-detail panel.
 */
export function LeaveReviewModal({ row, onClose }: { row: LeaveRowVM | null; onClose: () => void }) {
  const isPending = row?.status === 'Pending';
  return (
    <ReviewModal
      open={row !== null}
      onClose={onClose}
      title="ตรวจสอบคำขอลา"
      note={
        isPending
          ? { required: true, placeholder: 'เช่น: อนุมัติตามขอ / ปฏิเสธ — ไม่มีเอกสารแนบ' }
          : undefined
      }
      onApprove={
        isPending && row ? (n) => approveLeaveRequest({ leaveRequestId: row.id, note: n }) : undefined
      }
      onReject={
        isPending && row ? (n) => rejectLeaveRequest({ leaveRequestId: row.id, note: n }) : undefined
      }
      onVoid={row ? (reason) => voidLeaveRequest(row.id, reason) : undefined}
    >
      {row && <LeaveBody row={row} />}
    </ReviewModal>
  );
}

function LeaveBody({ row }: { row: LeaveRowVM }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge row={row} />
        <span className="text-sm font-medium text-ink-1">
          {row.name}
          {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-gray-50 p-4 text-sm">
        <div>
          <dt className="text-xs text-ink-4">ประเภท</dt>
          <dd className="font-medium text-ink-1">
            {row.leaveType}
            {row.isPaid ? '' : ' (ไม่จ่าย)'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-4">สังกัด</dt>
          <dd className="text-ink-2">
            {row.branch}
            {row.department ? ` • ${row.department}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-4">ช่วงวันที่</dt>
          <dd className="text-ink-2">{row.range}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-4">วันทำงานที่จะบันทึก</dt>
          <dd className="font-medium text-ink-1">{row.workingDays} วัน</dd>
        </div>
      </dl>
      {row.status === 'Pending' && row.workingDays === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ ไม่มีวันทำงานในช่วงที่ขอ (วันอาทิตย์/วันหยุดทั้งหมด) — การอนุมัติจะไม่สร้างรายการลงเวลา
        </p>
      )}
      <div>
        <p className="text-xs font-medium text-ink-4">เหตุผลของพนักงาน</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{row.reason}</p>
      </div>
      {row.attachmentUrl && (
        <div>
          <p className="text-xs font-medium text-ink-4">ไฟล์แนบ (ใบรับรองแพทย์ ฯลฯ)</p>
          <a
            href={row.attachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
          >
            {/* biome-ignore lint/performance/noImgElement: signed-URL preview */}
            <img
              src={row.attachmentUrl}
              alt="ไฟล์แนบ"
              className="block h-28 w-28 object-cover"
              loading="lazy"
            />
          </a>
        </div>
      )}
      {row.status !== 'Pending' && row.reviewNote && (
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-ink-2">
          <strong className="text-ink-1">หมายเหตุ:</strong> {row.reviewNote}
          {row.reviewedAt && <span className="ml-2 text-ink-4">({row.reviewedAt})</span>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Slim down `leave-inbox.tsx` to list + modal**

Replace the entire contents of `src/app/(admin)/admin/leave/leave-inbox.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import { STATUS_ICON, StatusBadge, statusRail } from '@/components/ui/status-badge';
import { LeaveReviewModal, type LeaveRowVM } from './leave-review-modal';

export type { LeaveRowVM };

function Badge({ row }: { row: LeaveRowVM }) {
  return (
    <StatusBadge status={row.statusKey}>
      {STATUS_ICON[row.statusKey] ?? ''} {row.statusLabel}
    </StatusBadge>
  );
}

export function LeaveInbox({ rows }: { rows: LeaveRowVM[] }) {
  const [open, setOpen] = useState<LeaveRowVM | null>(null);

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => setOpen(row)}
              aria-label={`ตรวจสอบคำขอลาของ ${row.name}`}
              className={`block w-full border-l-4 ${statusRail(row.statusKey)} px-5 py-4 text-left transition hover:bg-gray-50/70`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge row={row} />
                    <span className="truncate text-sm font-medium text-ink-1">
                      {row.name}
                      {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    {row.branch}
                    {row.department ? ` • ${row.department}` : ''}
                  </p>
                  <p className="mt-0.5 text-[10px] text-ink-4">ส่งเมื่อ {row.submitted}</p>
                </div>
                <div className="text-left text-xs text-ink-2 sm:max-w-[300px] sm:text-right">
                  <p>
                    <strong>{row.leaveType}</strong>{' '}
                    {row.isPaid ? '' : <span className="text-ink-3">(ไม่จ่าย)</span>}
                  </p>
                  <p className="mt-0.5 text-ink-3">
                    {row.range} • {row.workingDays} วันทำงาน
                  </p>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <LeaveReviewModal row={open} onClose={() => setOpen(null)} />
    </>
  );
}
```

Note: `export type { LeaveRowVM }` re-export keeps `leave/page.tsx`'s existing `import { LeaveInbox, type LeaveRowVM } from './leave-inbox'` working unchanged.

- [ ] **Step 3: Typecheck + lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Regression e2e (leave approval still works)**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm test:e2e -- tests/e2e/admin-leave-approval.spec.ts tests/e2e/review-modal.spec.ts`
Expected: PASS — behavior is identical, just relocated.

- [ ] **Step 5: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add "src/app/(admin)/admin/leave/leave-review-modal.tsx" "src/app/(admin)/admin/leave/leave-inbox.tsx"
git commit -m "refactor(leave): extract LeaveReviewModal for reuse"
```

---

## Task 4: Extract `AdvanceReviewModal` + `AdvanceRowVM` from `advance-inbox.tsx`

**Files:**
- Create: `src/app/(admin)/admin/advance/advance-review-modal.tsx`
- Modify: `src/app/(admin)/admin/advance/advance-inbox.tsx`

- [ ] **Step 1: Create `advance-review-modal.tsx`**

Move `AdvanceRowVM`, the receipt-upload state, money-confirm approve, reject/void wiring, and the modal body out of `advance-inbox.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { ActionResult } from '@/components/ui/confirm-dialog';
import { Dropzone } from '@/components/ui/dropzone';
import { ReviewModal } from '@/components/ui/review-modal';
import { STATUS_ICON, StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { approveCashAdvance, rejectCashAdvance } from '@/lib/advance/admin';
import { voidCashAdvance } from '@/lib/advance/void';
import { compressToJpeg, uploadAdvanceReceipt } from '@/lib/storage/upload-selfie';
import { createClient } from '@/lib/supabase/browser';

export type AdvanceRowVM = {
  id: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  statusKey: StatusKey;
  statusLabel: string;
  name: string;
  nickname: string | null;
  branch: string;
  department: string | null;
  amount: string;
  submitted: string;
  decidedAt: string | null;
  receiptUrl: string | null;
};

function Badge({ row }: { row: AdvanceRowVM }) {
  return (
    <StatusBadge status={row.statusKey}>
      {STATUS_ICON[row.statusKey] ?? ''} {row.statusLabel}
    </StatusBadge>
  );
}

/** Map a structured upload error (thrown with a `kind`) to a Thai message. */
function uploadErrorMessage(e: { kind: string; message?: string }): string {
  switch (e.kind) {
    case 'decode-failed':
      return 'อ่านไฟล์รูปไม่ได้';
    case 'upload-failed':
      return `อัปโหลดไม่สำเร็จ: ${e.message ?? ''}`;
    case 'too-large-after-compress':
      return 'รูปใหญ่เกินไป กรุณาลองใหม่';
    default:
      return 'เกิดข้อผิดพลาด';
  }
}

/**
 * Review modal for a single cash advance. `row === null` keeps it closed.
 * Owns the optional receipt-upload flow. Shared by the advance inbox list and
 * the admin calendar's day-detail panel.
 */
export function AdvanceReviewModal({
  row,
  onClose,
}: {
  row: AdvanceRowVM | null;
  onClose: () => void;
}) {
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isPending = row?.status === 'Pending';

  function pickFile(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setReceiptFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }
  function clearReceipt() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setReceiptFile(null);
    setPreviewUrl(null);
  }
  function closeModal() {
    clearReceipt();
    onClose();
  }

  /** Upload the receipt (if any) then approve — runs as ReviewModal's onApprove. */
  async function doApprove(): Promise<ActionResult> {
    if (!row) return { ok: false, message: 'ไม่พบรายการ' };
    try {
      let storageKey: string | undefined;
      if (receiptFile) {
        const supabase = createClient();
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) return { ok: false, message: 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่' };
        const compressed = await compressToJpeg(receiptFile);
        const uploaded = await uploadAdvanceReceipt(supabase, compressed, authData.user.id, row.id);
        storageKey = uploaded.key;
      }
      return await approveCashAdvance({ cashAdvanceId: row.id, receiptUrl: storageKey });
    } catch (err) {
      const message =
        typeof err === 'object' && err !== null && 'kind' in err
          ? uploadErrorMessage(err as { kind: string; message?: string })
          : err instanceof Error
            ? err.message
            : 'เกิดข้อผิดพลาด';
      return { ok: false, message };
    }
  }

  return (
    <ReviewModal
      open={row !== null}
      onClose={closeModal}
      title="ตรวจสอบคำขอเบิก"
      moneyConfirm={isPending && row ? { amountLabel: row.amount } : undefined}
      approveLabel={row ? `อนุมัติ ${row.amount}` : 'อนุมัติ'}
      onApprove={isPending ? doApprove : undefined}
      onReject={isPending && row ? () => rejectCashAdvance({ cashAdvanceId: row.id }) : undefined}
      onVoid={row ? (reason) => voidCashAdvance(row.id, reason) : undefined}
    >
      {row && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge row={row} />
              <span className="text-sm font-medium text-ink-1">
                {row.name}
                {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
              </span>
            </div>
            <p className="display text-2xl font-semibold tabular-nums text-ink-1">{row.amount}</p>
          </div>
          <p className="text-xs text-ink-3">
            {row.branch}
            {row.department ? ` • ${row.department}` : ''} — ส่งเมื่อ {row.submitted}
            {row.decidedAt && ` • ตัดสินใจเมื่อ ${row.decidedAt}`}
          </p>

          {isPending ? (
            <div>
              <p className="text-xs font-medium text-ink-2">
                ใบเสร็จ <span className="text-ink-4">(ไม่บังคับ — แนะนำให้แนบ)</span>
              </p>
              {!previewUrl ? (
                <Dropzone
                  className="mt-1"
                  label="เลือกรูปใบเสร็จ"
                  hint="JPG / PNG / WEBP, สูงสุด ~5MB"
                  accept="image/jpeg,image/png,image/webp"
                  onFile={pickFile}
                />
              ) : (
                <div className="mt-1 flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
                  {/* biome-ignore lint/performance/noImgElement: object-URL preview */}
                  <img
                    src={previewUrl}
                    alt="ตัวอย่างใบเสร็จ"
                    className="h-20 w-20 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink-1">{receiptFile?.name}</p>
                    <p className="mt-0.5 text-[10px] text-ink-3">
                      {receiptFile ? `${Math.round(receiptFile.size / 1024)} KB ก่อนบีบอัด` : ''}
                    </p>
                    <button
                      type="button"
                      onClick={clearReceipt}
                      className="mt-1 text-[11px] text-danger hover:text-danger-deep"
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            row.receiptUrl && (
              <a
                href={row.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs font-medium text-primary-700 underline hover:text-primary-800"
              >
                ดูใบเสร็จ →
              </a>
            )
          )}
        </div>
      )}
    </ReviewModal>
  );
}
```

- [ ] **Step 2: Slim down `advance-inbox.tsx` to list + modal**

Replace the entire contents of `src/app/(admin)/admin/advance/advance-inbox.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import { STATUS_ICON, StatusBadge, statusRail } from '@/components/ui/status-badge';
import { AdvanceReviewModal, type AdvanceRowVM } from './advance-review-modal';

export type { AdvanceRowVM };

function Badge({ row }: { row: AdvanceRowVM }) {
  return (
    <StatusBadge status={row.statusKey}>
      {STATUS_ICON[row.statusKey] ?? ''} {row.statusLabel}
    </StatusBadge>
  );
}

export function AdvanceInbox({ rows }: { rows: AdvanceRowVM[] }) {
  const [open, setOpen] = useState<AdvanceRowVM | null>(null);

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => setOpen(row)}
              aria-label={`ตรวจสอบคำขอเบิกของ ${row.name}`}
              className={`block w-full border-l-4 ${statusRail(row.statusKey)} px-5 py-4 text-left transition hover:bg-gray-50/70`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge row={row} />
                    <span className="truncate text-sm font-medium text-ink-1">
                      {row.name}
                      {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    {row.branch}
                    {row.department ? ` • ${row.department}` : ''}
                  </p>
                  <p className="mt-0.5 text-[10px] text-ink-4">
                    ส่งเมื่อ {row.submitted}
                    {row.decidedAt && ` • ตัดสินใจเมื่อ ${row.decidedAt}`}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="display text-2xl font-semibold tabular-nums text-ink-1">
                    {row.amount}
                  </p>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <AdvanceReviewModal row={open} onClose={() => setOpen(null)} />
    </>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Regression e2e (advance approval still works)**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm test:e2e -- tests/e2e/admin-advance-approval.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add "src/app/(admin)/admin/advance/advance-review-modal.tsx" "src/app/(admin)/admin/advance/advance-inbox.tsx"
git commit -m "refactor(advance): extract AdvanceReviewModal for reuse"
```

---

## Task 5: Extract `buildLeaveRowVM` into a server-only module + refactor `leave/page.tsx`

**Files:**
- Create: `src/app/(admin)/admin/leave/leave-row-vm.ts`
- Modify: `src/app/(admin)/admin/leave/page.tsx`

- [ ] **Step 1: Create `leave-row-vm.ts`**

Extract the Prisma `select`, the formatting helpers, `STATUS_INFO`, and the VM-building logic from `leave/page.tsx` into a server-only module the page and the calendar action both import:

```ts
import 'server-only';

import type { StatusKey } from '@/components/ui/status-badge';
import type { LeaveRowVM } from './leave-review-modal';

/** Prisma select covering every field `buildLeaveRowVM` reads. */
export const LEAVE_SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  reason: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
  attachmentUrl: true,
  deletedAt: true,
  deleteReason: true,
  leaveType: { select: { name: true, isPaid: true } },
  employee: {
    select: {
      firstName: true,
      lastName: true,
      nickname: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
    },
  },
} as const;

/** Status → Thai label + badge key. Exported so the trash list reuses it. */
export const LEAVE_STATUS_INFO: Record<string, { label: string; key: StatusKey }> = {
  Pending: { label: 'รออนุมัติ', key: 'pending' },
  Approved: { label: 'อนุมัติแล้ว', key: 'approved' },
  Rejected: { label: 'ไม่อนุมัติ', key: 'rejected' },
  Cancelled: { label: 'ยกเลิก', key: 'cancelled' },
};

export function formatLeaveRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  const same =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();
  if (same) return start.toLocaleDateString('th-TH', opts);
  return `${start.toLocaleDateString('th-TH', { ...opts, year: undefined })} – ${end.toLocaleDateString(
    'th-TH',
    opts,
  )}`;
}

export function formatLeaveDateTime(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Shape returned by a Prisma findMany/findUnique using LEAVE_SELECT. */
export type LeaveRecord = {
  id: string;
  startDate: Date;
  endDate: Date;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  attachmentUrl: string | null;
  leaveType: { name: string; isPaid: boolean };
  employee: {
    firstName: string;
    lastName: string;
    nickname: string | null;
    branch: { name: string };
    department: { name: string } | null;
  };
};

/**
 * Build the client-facing review VM for one leave record.
 * Callers supply the resolved attachment URL + working-day count so this stays
 * synchronous and free of storage/db imports (the page batches signing; the
 * single-record action signs one).
 */
export function buildLeaveRowVM(
  r: LeaveRecord,
  deps: { attachmentUrl: string | null; workingDays: number },
): LeaveRowVM {
  const info = LEAVE_STATUS_INFO[r.status] ?? { label: r.status, key: 'neutral' as StatusKey };
  return {
    id: r.id,
    status: r.status,
    statusKey: info.key,
    statusLabel: info.label,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
    nickname: r.employee.nickname,
    branch: r.employee.branch.name,
    department: r.employee.department?.name ?? null,
    leaveType: r.leaveType.name,
    isPaid: r.leaveType.isPaid,
    range: formatLeaveRange(r.startDate, r.endDate),
    workingDays: deps.workingDays,
    submitted: formatLeaveDateTime(r.createdAt),
    reason: r.reason,
    reviewNote: r.reviewNote ?? null,
    reviewedAt: r.reviewedAt ? formatLeaveDateTime(r.reviewedAt) : null,
    attachmentUrl: deps.attachmentUrl,
  };
}
```

- [ ] **Step 2: Refactor `leave/page.tsx` to use the shared module**

In `src/app/(admin)/admin/leave/page.tsx`:

1. Remove the local `STATUS_INFO`, `formatRange`, `formatDateTime`, and the inline `leaveSelect` const.
2. Update imports near the top (keep `StatusBadge`/`StatusKey` — still used by the trash list):

```ts
import { LeaveInbox, type LeaveRowVM } from './leave-inbox';
import {
  buildLeaveRowVM,
  formatLeaveDateTime,
  formatLeaveRange,
  LEAVE_SELECT,
  LEAVE_STATUS_INFO,
} from './leave-row-vm';
```

3. Replace `select: leaveSelect` with `select: LEAVE_SELECT` in both `findMany` calls.
4. Replace the `vm` mapping (the `rows.map((r) => {...})` block that builds `LeaveRowVM[]`) with:

```ts
  const vm: LeaveRowVM[] = isTrash
    ? []
    : rows.map((r) =>
        buildLeaveRowVM(r, {
          attachmentUrl: resolveAttachment(r.attachmentUrl),
          workingDays: workingDaysIn({
            startDate: r.startDate,
            endDate: r.endDate,
            holidays: expandedHolidays,
          }).length,
        }),
      );
```

5. In the trash list (the `isTrash ?` branch), update the per-row helpers to the imported ones. Replace the line `const info = STATUS_INFO[r.status] ?? { label: r.status, key: 'neutral' as StatusKey };` with:

```ts
                const info =
                  LEAVE_STATUS_INFO[r.status] ?? { label: r.status, key: 'neutral' as StatusKey };
```

Then change the trash branch's `formatDateTime(r.createdAt)` and `formatDateTime(r.deletedAt)` calls to `formatLeaveDateTime(...)`, and `formatRange(r.startDate, r.endDate)` to `formatLeaveRange(r.startDate, r.endDate)`.

- [ ] **Step 3: Typecheck + lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm typecheck && pnpm lint`
Expected: PASS. (If `LeaveRecord` and the Prisma row type mismatch, adjust `LeaveRecord` to match — the `select` is the source of truth.)

- [ ] **Step 4: Regression e2e**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm test:e2e -- tests/e2e/admin-leave-approval.spec.ts`
Expected: PASS — the inbox renders identical VMs.

- [ ] **Step 5: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add "src/app/(admin)/admin/leave/leave-row-vm.ts" "src/app/(admin)/admin/leave/page.tsx"
git commit -m "refactor(leave): extract buildLeaveRowVM into shared server module"
```

---

## Task 6: Extract `buildAdvanceRowVM` into a server-only module + refactor `advance/page.tsx`

**Files:**
- Create: `src/app/(admin)/admin/advance/advance-row-vm.ts`
- Modify: `src/app/(admin)/admin/advance/page.tsx`

- [ ] **Step 1: Create `advance-row-vm.ts`**

```ts
import 'server-only';

import type { StatusKey } from '@/components/ui/status-badge';
import type { AdvanceRowVM } from './advance-review-modal';

/** Prisma select covering every field `buildAdvanceRowVM` reads. */
export const ADVANCE_SELECT = {
  id: true,
  amount: true,
  status: true,
  requestedAt: true,
  approvedAt: true,
  receiptUrl: true,
  deletedAt: true,
  deleteReason: true,
  employee: {
    select: {
      firstName: true,
      lastName: true,
      nickname: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
    },
  },
} as const;

/** Status → Thai label + badge key. Exported so the trash list reuses it. */
export const ADVANCE_STATUS_INFO: Record<string, { label: string; key: StatusKey }> = {
  Pending: { label: 'รออนุมัติ', key: 'pending' },
  Approved: { label: 'อนุมัติแล้ว', key: 'approved' },
  Rejected: { label: 'ไม่อนุมัติ', key: 'rejected' },
  Cancelled: { label: 'ยกเลิก', key: 'cancelled' },
};

export function formatAdvanceMoney(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatAdvanceDateTime(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Shape returned by a Prisma findMany/findUnique using ADVANCE_SELECT. */
export type AdvanceRecord = {
  id: string;
  amount: unknown; // Prisma.Decimal
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  requestedAt: Date;
  approvedAt: Date | null;
  receiptUrl: string | null;
  employee: {
    firstName: string;
    lastName: string;
    nickname: string | null;
    branch: { name: string };
    department: { name: string } | null;
  };
};

/**
 * Build the client-facing review VM for one cash-advance record.
 * Caller supplies the resolved receipt URL (page batches signing; the
 * single-record action signs one).
 */
export function buildAdvanceRowVM(
  r: AdvanceRecord,
  deps: { receiptUrl: string | null },
): AdvanceRowVM {
  const info = ADVANCE_STATUS_INFO[r.status] ?? { label: r.status, key: 'neutral' as StatusKey };
  return {
    id: r.id,
    status: r.status,
    statusKey: info.key,
    statusLabel: info.label,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
    nickname: r.employee.nickname,
    branch: r.employee.branch.name,
    department: r.employee.department?.name ?? null,
    amount: formatAdvanceMoney(r.amount),
    submitted: formatAdvanceDateTime(r.requestedAt),
    decidedAt: r.approvedAt ? formatAdvanceDateTime(r.approvedAt) : null,
    receiptUrl: deps.receiptUrl,
  };
}
```

- [ ] **Step 2: Refactor `advance/page.tsx`**

In `src/app/(admin)/admin/advance/page.tsx`:

1. Remove local `STATUS_INFO`, `formatMoney`, `formatDateTime`, and the inline `advanceSelect` const.
2. Update imports:

```ts
import { AdvanceInbox, type AdvanceRowVM } from './advance-inbox';
import {
  ADVANCE_SELECT,
  ADVANCE_STATUS_INFO,
  buildAdvanceRowVM,
  formatAdvanceDateTime,
  formatAdvanceMoney,
} from './advance-row-vm';
```

3. Replace `select: advanceSelect` with `select: ADVANCE_SELECT` in both `findMany` calls.
4. Replace the `vm` mapping with:

```ts
  const vm: AdvanceRowVM[] = isTrash
    ? []
    : rows.map((r) => buildAdvanceRowVM(r, { receiptUrl: resolveReceipt(r.receiptUrl) }));
```

5. In the trash branch, replace the line `const info = STATUS_INFO[r.status] ?? { label: r.status, key: 'neutral' as StatusKey };` with:

```ts
                const info =
                  ADVANCE_STATUS_INFO[r.status] ?? { label: r.status, key: 'neutral' as StatusKey };
```

Then change the trash branch's `formatMoney(r.amount)` to `formatAdvanceMoney(r.amount)` and both `formatDateTime(...)` calls (`r.requestedAt`, `r.deletedAt`) to `formatAdvanceDateTime(...)`.

- [ ] **Step 3: Typecheck + lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Regression e2e**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm test:e2e -- tests/e2e/admin-advance-approval.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add "src/app/(admin)/admin/advance/advance-row-vm.ts" "src/app/(admin)/admin/advance/page.tsx"
git commit -m "refactor(advance): extract buildAdvanceRowVM into shared server module"
```

---

## Task 7: Server actions `getLeaveReviewRow` / `getAdvanceReviewRow`

**Files:**
- Modify: `src/app/(admin)/admin/_calendar/actions.ts`

- [ ] **Step 1: Add the two fetch actions**

Append to `src/app/(admin)/admin/_calendar/actions.ts` (keep the existing `loadAdminCalendar`). Add imports at the top of the file:

```ts
import { prisma } from '@/lib/db/prisma';
import { expandHolidaysWithSubstitutes, workingDaysIn } from '@/lib/leave/working-days';
import { signAttendancePhotoUrls } from '@/lib/storage/signed-urls';
import { ADVANCE_SELECT, buildAdvanceRowVM } from '../advance/advance-row-vm';
import type { AdvanceRowVM } from '../advance/advance-review-modal';
import { buildLeaveRowVM, LEAVE_SELECT } from '../leave/leave-row-vm';
import type { LeaveRowVM } from '../leave/leave-review-modal';
```

Then add:

```ts
/** Resolve a possibly-relative storage key to a signed URL (or pass through http URLs). */
async function resolveOne(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const signed = await signAttendancePhotoUrls([value]);
  return signed.get(value) ?? null;
}

/**
 * Fetch the full leave review VM for one request, for the calendar's
 * click-to-review. Same permission as the leave approve action.
 */
export async function getLeaveReviewRow(leaveRequestId: string): Promise<LeaveRowVM | null> {
  await requirePermission('leave.approve');

  const [row, holidays] = await Promise.all([
    prisma.leaveRequest.findUnique({ where: { id: leaveRequestId }, select: LEAVE_SELECT }),
    prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
  ]);
  if (!row) return null;

  const expandedHolidays = expandHolidaysWithSubstitutes(holidays.map((h) => h.date));
  const workingDays = workingDaysIn({
    startDate: row.startDate,
    endDate: row.endDate,
    holidays: expandedHolidays,
  }).length;

  return buildLeaveRowVM(row, {
    attachmentUrl: await resolveOne(row.attachmentUrl),
    workingDays,
  });
}

/**
 * Fetch the full cash-advance review VM for one request, for the calendar's
 * click-to-review. Same permission as the advance approve action.
 */
export async function getAdvanceReviewRow(cashAdvanceId: string): Promise<AdvanceRowVM | null> {
  await requirePermission('advance.approve');

  const row = await prisma.cashAdvance.findUnique({
    where: { id: cashAdvanceId },
    select: ADVANCE_SELECT,
  });
  if (!row) return null;

  return buildAdvanceRowVM(row, { receiptUrl: await resolveOne(row.receiptUrl) });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm typecheck && pnpm lint`
Expected: PASS. (Confirm `signAttendancePhotoUrls` returns a `Map<string,string>` keyed by the input key — it does; see `src/lib/storage/signed-urls.ts`.)

- [ ] **Step 3: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add "src/app/(admin)/admin/_calendar/actions.ts"
git commit -m "feat(calendar): server actions to fetch leave/advance review VMs"
```

---

## Task 8: Render advances + clickable rows in `CalendarGrid`

**Files:**
- Modify: `src/app/(liff)/liff/calendar/calendar-grid.tsx`

- [ ] **Step 1: Extend props + index advances**

Update the imports (add the advance type + helper):

```ts
import type {
  GridDay,
  TeamCalendarAdvance,
  TeamCalendarEntry,
  TeamCalendarHoliday,
} from '@/lib/leave/team-calendar-shape';
import { indexAdvancesByDate, indexEntriesByDate } from '@/lib/leave/team-calendar-shape';
```

Replace the `Props` type and the `useMemo`-index section. New `Props`:

```ts
type Props = {
  grid: GridDay[];
  entries: TeamCalendarEntry[];
  holidays: TeamCalendarHoliday[];
  /** Cash-advance markers (admin calendar only). Defaults to none. */
  advances?: TeamCalendarAdvance[];
  detailPosition?: 'below' | 'right';
  /** When provided, day-detail leave rows become buttons opening a review modal. */
  onLeaveClick?: (leaveRequestId: string) => void;
  /** When provided, day-detail advance rows become buttons opening a review modal. */
  onAdvanceClick?: (cashAdvanceId: string) => void;
  /** id of the row currently fetching its modal VM — shows a disabled/busy state. */
  busyId?: string | null;
};
```

Update the function signature + add the advance index (after the existing `holidayByDate` memo):

```ts
export function CalendarGrid({
  grid,
  entries,
  holidays,
  advances = [],
  detailPosition = 'below',
  onLeaveClick,
  onAdvanceClick,
  busyId = null,
}: Props) {
  const entriesByDate = useMemo(() => indexEntriesByDate(entries), [entries]);
  const advancesByDate = useMemo(() => indexAdvancesByDate(advances), [advances]);
  const holidayByDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of holidays) m.set(h.date, h.name);
    return m;
  }, [holidays]);
```

Add the selected-day advances near `selectedEntries`/`selectedHoliday`:

```ts
  const selectedEntries = entriesByDate.get(selected) ?? [];
  const selectedAdvances = advancesByDate.get(selected) ?? [];
  const selectedHoliday = holidayByDate.get(selected) ?? null;
```

- [ ] **Step 2: Render ฿ chips in the cell bar stack**

Inside the `grid.map((cell) => {...})` body, after `const holiday = holidayByDate.get(cell.date);`, add:

```ts
            const dayAdvances = advancesByDate.get(cell.date) ?? [];
            // Unified marker list: leaves first, then advances; share the ≤2 + "+N" budget.
            const markers: Array<
              | { kind: 'leave'; e: TeamCalendarEntry }
              | { kind: 'advance'; a: TeamCalendarAdvance }
            > = [
              ...dayEntries.map((e) => ({ kind: 'leave' as const, e })),
              ...dayAdvances.map((a) => ({ kind: 'advance' as const, a })),
            ];
```

Extend the `aria-label` to mention advances:

```tsx
                aria-label={`${cell.day}${holiday ? ` ${holiday}` : ''}${
                  dayEntries.length > 0 ? ` (มีลา ${dayEntries.length})` : ''
                }${dayAdvances.length > 0 ? ` (เบิก ${dayAdvances.length})` : ''}`}
```

Replace the existing entry-bars block (`{cell.inMonth && dayEntries.length > 0 && (...)}`) with the unified marker render:

```tsx
                {/* Markers — leave bars + ฿ advance chips, up to 2 then "+N" */}
                {cell.inMonth && markers.length > 0 && (
                  <div className="mt-auto flex flex-col gap-0.5">
                    {markers.slice(0, 2).map((m) =>
                      m.kind === 'leave' ? (
                        <span
                          key={`l:${m.e.leaveRequestId}`}
                          className={cn(
                            'block truncate rounded-sm px-0.5 text-[9px] leading-tight',
                            m.e.status === 'Approved'
                              ? 'bg-primary-100 text-primary-800'
                              : 'border border-dashed border-amber-300 bg-amber-50 text-amber-800',
                            m.e.isMine && 'ring-1 ring-primary-400',
                          )}
                        >
                          {m.e.shortLabel}
                        </span>
                      ) : (
                        <span
                          key={`a:${m.a.cashAdvanceId}`}
                          className={cn(
                            'block truncate rounded-sm px-0.5 text-[9px] leading-tight',
                            m.a.status === 'Approved'
                              ? 'bg-green-100 text-green-800'
                              : 'border border-dashed border-green-300 bg-green-50 text-green-800',
                          )}
                        >
                          {m.a.amountLabel}
                        </span>
                      ),
                    )}
                    {markers.length > 2 && (
                      <span className="text-[9px] font-medium leading-none text-gray-500">
                        +{markers.length - 2}
                      </span>
                    )}
                  </div>
                )}
```

- [ ] **Step 3: Make the detail panel rows clickable + add advance rows**

Replace the detail-panel body (the `{selectedEntries.length === 0 ? (...) : (<ul>...</ul>)}` block, from line ~212 to ~253) with:

```tsx
        {selectedEntries.length === 0 && selectedAdvances.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-gray-500">ไม่มีรายการวันนี้</p>
            {selectedHoliday && <p className="mt-1 text-xs text-gray-400">เนื่องจากเป็นวันหยุด</p>}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {selectedEntries.map((e) => {
              const body = (
                <>
                  <span
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold',
                      e.isMine ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600',
                    )}
                  >
                    {(e.shortLabel[0] ?? '?').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {e.employeeName}
                        {e.isMine && (
                          <span className="ml-1 text-xs font-normal text-primary-600">(คุณ)</span>
                        )}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-600">
                      {e.leaveTypeName}
                      {e.startDate !== e.endDate && (
                        <span className="text-gray-400">
                          {' '}
                          · {formatRangeCompact(e.startDate, e.endDate)}
                        </span>
                      )}
                    </p>
                  </div>
                  <StatusBadge status={e.status} />
                </>
              );
              return (
                <li key={e.leaveRequestId}>
                  {onLeaveClick ? (
                    <button
                      type="button"
                      disabled={busyId === e.leaveRequestId}
                      onClick={() => onLeaveClick(e.leaveRequestId)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-gray-50 disabled:opacity-60"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}

            {selectedAdvances.map((a) => {
              const body = (
                <>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-green-100 text-xs font-bold text-green-700">
                    ฿
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{a.employeeName}</p>
                    <p className="mt-0.5 text-xs text-gray-600">เบิกเงิน · {a.amountLabel}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </>
              );
              return (
                <li key={a.cashAdvanceId}>
                  {onAdvanceClick ? (
                    <button
                      type="button"
                      disabled={busyId === a.cashAdvanceId}
                      onClick={() => onAdvanceClick(a.cashAdvanceId)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-gray-50 disabled:opacity-60"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
```

(The `StatusBadge` local component already handles `'Pending' | 'Approved'`, so it works for advances unchanged.)

- [ ] **Step 4: Typecheck + lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm typecheck && pnpm lint`
Expected: PASS. The LIFF caller (`/liff/calendar`) passes no `advances`/callbacks, so it renders exactly as before (empty-state text now "ไม่มีรายการวันนี้" instead of "ไม่มีคนลาวันนี้" — acceptable copy change shared by both surfaces).

- [ ] **Step 5: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add "src/app/(liff)/liff/calendar/calendar-grid.tsx"
git commit -m "feat(calendar): render advance chips + clickable day-detail rows"
```

---

## Task 9: Wire click → fetch → modal in `AdminCalendarCard`

**Files:**
- Modify: `src/app/(admin)/admin/_calendar/admin-calendar-card.tsx`

- [ ] **Step 1: Add modal state + fetch handlers and pass props to the grid**

Update imports at the top:

```ts
import { useMemo, useState, useTransition } from 'react';
import { CalendarGrid } from '@/app/(liff)/liff/calendar/calendar-grid';
import { AdvanceReviewModal, type AdvanceRowVM } from '../advance/advance-review-modal';
import { LeaveReviewModal, type LeaveRowVM } from '../leave/leave-review-modal';
// ...existing Card/* + team-calendar-shape imports unchanged...
import { getAdvanceReviewRow, getLeaveReviewRow, loadAdminCalendar } from './actions';
```

Inside the component, after the existing state hooks, add:

```ts
  const [openLeave, setOpenLeave] = useState<LeaveRowVM | null>(null);
  const [openAdvance, setOpenAdvance] = useState<AdvanceRowVM | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function onLeaveClick(leaveRequestId: string) {
    setRowError(null);
    setBusyId(leaveRequestId);
    startTransition(async () => {
      const row = await getLeaveReviewRow(leaveRequestId);
      setBusyId(null);
      if (row) setOpenLeave(row);
      else setRowError('ไม่พบคำขอลานี้ (อาจถูกลบไปแล้ว)');
    });
  }

  function onAdvanceClick(cashAdvanceId: string) {
    setRowError(null);
    setBusyId(cashAdvanceId);
    startTransition(async () => {
      const row = await getAdvanceReviewRow(cashAdvanceId);
      setBusyId(null);
      if (row) setOpenAdvance(row);
      else setRowError('ไม่พบคำขอเบิกนี้ (อาจถูกลบไปแล้ว)');
    });
  }
```

(`startTransition`/`isPending` already exist in this component.)

- [ ] **Step 2: Pass props to `CalendarGrid` + render the modals**

Update the `<CalendarGrid .../>` usage to thread advances + callbacks:

```tsx
          <CalendarGrid
            key={ym}
            grid={grid}
            entries={data.entries}
            holidays={data.holidays}
            advances={data.advances}
            detailPosition="right"
            onLeaveClick={onLeaveClick}
            onAdvanceClick={onAdvanceClick}
            busyId={busyId}
          />
```

Add an inline error line just below the grid wrapper `<div aria-busy=...>` (inside `CardBody`, after that div), and the two modals before the closing `</Card>`:

```tsx
        {rowError && (
          <p role="alert" className="mt-2 text-xs font-medium text-danger-deep">
            {rowError}
          </p>
        )}
      </CardBody>

      <LeaveReviewModal row={openLeave} onClose={() => setOpenLeave(null)} />
      <AdvanceReviewModal row={openAdvance} onClose={() => setOpenAdvance(null)} />
    </Card>
```

(The modals' internal `router.refresh()` on a successful approve/reject/void re-renders the `/admin/calendar` server component, so the grid + right panel reflect the new status.)

- [ ] **Step 3: Typecheck + lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add "src/app/(admin)/admin/_calendar/admin-calendar-card.tsx"
git commit -m "feat(calendar): open review modals from clickable day-detail rows"
```

---

## Task 10: End-to-end test — calendar → click → approve

**Files:**
- Create: `tests/e2e/calendar-review.spec.ts`

- [ ] **Step 1: Write the e2e test**

A `CashAdvance.requestedAt` defaults to `now()`, so a freshly-seeded advance lands on today's cell, and `CalendarGrid` preselects today — the advance shows in the right panel immediately. Same for a leave covering today.

```ts
import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * /admin/calendar day-detail panel is clickable: a Pending advance/leave on
 * today's cell opens the matching review modal, and approving from there flips
 * status + refreshes the calendar. Mirrors admin-advance-approval but exercises
 * the calendar entry point + the shared extracted modals.
 */
test.describe('Admin calendar click-to-review', () => {
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
    return employee;
  }

  test('approve a Pending advance from the calendar day-detail panel', async ({ page }) => {
    const suffix = e2eId();
    const amount = 3210;
    const employee = await seedEmployee(suffix);
    const advance = await prisma.cashAdvance.create({
      data: {
        employeeId: employee.id,
        amount: new Prisma.Decimal(amount),
        status: 'Pending',
        // requestedAt defaults to now() → lands on today's cell (preselected).
      },
    });
    const employeeName = `e2e-First-${suffix} e2e-Last-${suffix}`;

    await loginAsAdmin(page);
    await page.goto('/admin/calendar');
    await expect(page.getByRole('heading', { name: 'ปฏิทินงาน' }).first()).toBeVisible();

    // The right-panel advance row is a button labelled with the employee name.
    const row = page.getByRole('button', { name: new RegExp(employeeName) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('ตรวจสอบคำขอเบิก')).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: /^อนุมัติ ฿/ }).click();
    await dialog.getByRole('button', { name: /^ยืนยันอนุมัติ/ }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const refreshed = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: { status: true, approvedAt: true, approvedById: true, employeeId: true },
    });
    expect(refreshed?.status).toBe('Approved');
    expect(refreshed?.approvedAt).not.toBeNull();
    expect(refreshed?.approvedById).not.toBeNull();
    expect(refreshed?.employeeId).toBe(employee.id);
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm test:e2e -- tests/e2e/calendar-review.spec.ts`
Expected: PASS. If the advance row isn't found, confirm the seeded `requestedAt` falls in the current Bangkok month and today is in the visible month (it is — default selection is today).

- [ ] **Step 3: Commit**

```bash
export PATH="/opt/homebrew/bin:$PATH"
git add tests/e2e/calendar-review.spec.ts
git commit -m "test(e2e): approve a cash advance from the calendar day-detail panel"
```

---

## Final verification

- [ ] **Full unit + typecheck + lint sweep**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Regression e2e sweep (extracted modals didn't change behavior)**

Run: `export PATH="/opt/homebrew/bin:$PATH"; pnpm test:e2e -- tests/e2e/admin-leave-approval.spec.ts tests/e2e/admin-advance-approval.spec.ts tests/e2e/review-modal.spec.ts tests/e2e/calendar-review.spec.ts`
Expected: all PASS.

- [ ] **Manual smoke (optional):** `pnpm dev`, open `/admin/calendar`, pick a day with a เบิก, click the ฿ row → `ตรวจสอบคำขอเบิก` opens; approve → row updates. Confirm `/liff/calendar` shows no ฿ chips and rows aren't clickable.

---

## Notes / risks

- **Shared grid:** all new `CalendarGrid` behavior is opt-in via props; the LIFF caller passes none, so employees see no advances and inert rows. The only shared visible change is the empty-state copy ("ไม่มีรายการวันนี้").
- **Permissions:** the fetch actions enforce `leave.approve` / `advance.approve` (same as the mutations). Server actions are independently callable, so this matters.
- **Soft-deletes:** advance loading uses `prisma` (not `prismaRaw`), which already excludes soft-deleted rows — no explicit `deletedAt` filter needed.
- **Month boundary:** advances are windowed on `requestedAt` in `[monthStart, firstOfNextMonth)` (UTC) then displayed on their Bangkok day; an advance created within ~7h of a month edge could sort to an adjacent month cell. Acceptable for an overview calendar.
- **Loader test coverage:** the spec listed a unit test asserting `getOrgCalendarData` includes advances while `getTeamCalendarData` returns `advances: []`. This repo unit-tests only pure helpers (it doesn't mock Prisma for loaders — see `team-calendar.test.ts`). The admin-only guarantee is structural (`loadEntriesAndHolidays` always returns `advances: []`; only `getOrgCalendarData` adds them) and is exercised end-to-end by Task 10. Deliberately no Prisma-mock loader test — it would break the repo's testing convention.
