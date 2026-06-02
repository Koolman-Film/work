# Review Modal + Status Rail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline `ตรวจสอบ` accordion on `/admin/leave` and `/admin/advance` with a focused, shared review **modal**, and make request statuses scannable via a status-colored left rail + icon badge.

**Architecture:** Add a status rail/icon map next to `StatusBadge` (single source of truth). Extract a shared `DialogFooter`. Build one shared `ReviewModal` (composes `Dialog`) that owns the footer, the required-note field, the in-modal money-confirm and void-reason two-steps, and success → `router.refresh()`. Each page gets a small **client** inbox component that renders whole-row buttons + one `ReviewModal`; the server page just queries and passes a serializable view-model. Delete the two inline panels and the advance approve `ConfirmDialog`.

**Tech Stack:** Next.js 16 (RSC + client components), React 19 `useTransition`, Tailwind v4, Playwright (e2e), Vitest (unit), Biome.

**Spec:** `docs/superpowers/specs/2026-06-03-review-modal-status-redesign-design.md`

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/components/ui/status-badge.tsx` | + `STATUS_RAIL` / `STATUS_ICON` maps + `statusRail()` helper | Modify |
| `src/components/ui/status-badge.test.ts` | assert the maps cover the 4 approval statuses | Create |
| `src/components/ui/dialog-footer.tsx` | shared right-aligned `sm`-button action bar + optional `leading` slot | Create |
| `src/components/ui/confirm-dialog.tsx` | use `DialogFooter` (no behavior change) | Modify |
| `src/components/ui/review-modal.tsx` | the shared review shell (footer, note, money/void two-steps, refresh) | Create |
| `src/app/(admin)/admin/leave/leave-inbox.tsx` | client list of row-buttons + `ReviewModal` (leave body) | Create |
| `src/app/(admin)/admin/leave/page.tsx` | query → serializable VM → `<LeaveInbox>` | Modify |
| `src/app/(admin)/admin/leave/leave-review-panel.tsx` | inline accordion | **Delete** |
| `src/app/(admin)/admin/advance/advance-inbox.tsx` | client list + `ReviewModal` (advance body, receipt upload, money confirm) | Create |
| `src/app/(admin)/admin/advance/page.tsx` | query → VM → `<AdvanceInbox>` | Modify |
| `src/app/(admin)/admin/advance/advance-review-panel.tsx` | inline accordion | **Delete** |
| `tests/e2e/admin-leave-approval.spec.ts` | drive the modal flow | Modify |
| `tests/e2e/admin-advance-approval.spec.ts` | drive the modal flow | Modify |
| `tests/e2e/confirm-dialog.spec.ts` → `tests/e2e/review-modal.spec.ts` | ReviewModal contract (amount/cancel/confirm/money-step/void) | Rename+rewrite |
| `src/app/(admin)/admin/mockup-review/page.tsx` | throwaway mockup | **Delete** |

**Status-key contract (locked):** the rows use the approval `StatusKey`s `pending | approved | rejected | cancelled`. Rail = `border-l-<color>` (4px width applied separately via `border-l-4`). Icons: ⏳ / ✓ / ✕ / ⊘.

---

### Task 1: Status rail + icon maps

**Files:**
- Modify: `src/components/ui/status-badge.tsx`
- Test: `src/components/ui/status-badge.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/components/ui/status-badge.test.ts
import { describe, expect, it } from 'vitest';
import { STATUS_ICON, STATUS_RAIL, statusRail } from './status-badge';

describe('status rail + icon maps', () => {
  it('covers the four approval statuses with left-border colors', () => {
    for (const k of ['pending', 'approved', 'rejected', 'cancelled'] as const) {
      expect(STATUS_RAIL[k]).toMatch(/^border-l-/);
      expect(STATUS_ICON[k]).toBeTruthy();
    }
  });

  it('statusRail falls back to a neutral border for non-approval keys', () => {
    expect(statusRail('sick')).toBe('border-l-gray-200');
    expect(statusRail('pending')).toBe('border-l-amber-400');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/status-badge.test.ts`
Expected: FAIL — `STATUS_RAIL`/`STATUS_ICON`/`statusRail` not exported.

- [ ] **Step 3: Add the maps + helper to `status-badge.tsx`**

Append below the existing `STATUS_COLORS` / `StatusKey` exports:

```ts
/** Left-rail border color per approval status (width comes from `border-l-4`). */
export const STATUS_RAIL: Partial<Record<StatusKey, string>> = {
  pending: 'border-l-amber-400',
  approved: 'border-l-emerald-400',
  rejected: 'border-l-red-400',
  cancelled: 'border-l-slate-300',
};

/** Small glyph shown inside the badge for approval statuses. */
export const STATUS_ICON: Partial<Record<StatusKey, string>> = {
  pending: '⏳',
  approved: '✓',
  rejected: '✕',
  cancelled: '⊘',
};

/** Rail class for a row, with a neutral fallback for non-approval keys. */
export function statusRail(status: StatusKey): string {
  return STATUS_RAIL[status] ?? 'border-l-gray-200';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/status-badge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/status-badge.tsx src/components/ui/status-badge.test.ts
git commit -m "feat(ui): add status rail + icon maps next to StatusBadge"
```

---

### Task 2: Shared `DialogFooter` + refactor `ConfirmDialog`

**Files:**
- Create: `src/components/ui/dialog-footer.tsx`
- Modify: `src/components/ui/confirm-dialog.tsx` (the footer block only)

- [ ] **Step 1: Create `DialogFooter`**

```tsx
// src/components/ui/dialog-footer.tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Standard modal action bar: right-aligned `sm` buttons, with an optional
 * left-aligned slot (e.g. a destructive "ลบรายการ" link). Shared by
 * ConfirmDialog and ReviewModal so button size/spacing can't drift.
 */
export function DialogFooter({ leading, children }: { leading?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn('mt-5 flex items-center gap-2', leading ? 'justify-between' : 'justify-end')}>
      {leading ?? null}
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Use it in `ConfirmDialog`**

In `src/components/ui/confirm-dialog.tsx`, add `import { DialogFooter } from './dialog-footer';` and replace the footer block:

```tsx
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={close} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'destructive' : 'primary'}
            size="sm"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? 'กำลังดำเนินการ…' : confirmLabel}
          </Button>
        </div>
```

with:

```tsx
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={close} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'destructive' : 'primary'}
            size="sm"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? 'กำลังดำเนินการ…' : confirmLabel}
          </Button>
        </DialogFooter>
```

- [ ] **Step 3: Typecheck + run the existing confirm-dialog e2e to prove no regression**

Run: `npx tsc --noEmit && npm run test:e2e -- confirm-dialog.spec.ts`
Expected: typecheck clean; 2 passed (ConfirmDialog still works through the advance page — this spec is rewritten in Task 8).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/dialog-footer.tsx src/components/ui/confirm-dialog.tsx
git commit -m "refactor(ui): extract DialogFooter; ConfirmDialog uses it"
```

---

### Task 3: `ReviewModal` shell

**Files:**
- Create: `src/components/ui/review-modal.tsx`

This composes `Dialog` + `DialogFooter`. It owns: required-note field, the in-modal money-confirm step, the in-modal void-reason step, pending/error state, and success → `onClose()` + `router.refresh()`. Approve/reject buttons render only when their handlers are provided (decided rows pass neither → read-only).

- [ ] **Step 1: Create the component**

```tsx
// src/components/ui/review-modal.tsx
'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useId, useState, useTransition } from 'react';
import { Button } from './button';
import { type ActionResult } from './confirm-dialog';
import { Dialog } from './dialog';
import { DialogFooter } from './dialog-footer';

type Handler = (note: string) => Promise<ActionResult>;

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Page-specific detail body (read-only content). */
  children: ReactNode;
  /** Required note field shown above the footer (leave: required). */
  note?: { required: boolean; placeholder?: string };
  /** When set, approve runs an in-modal "ยืนยัน ฿amount?" step first. */
  moneyConfirm?: { amountLabel: string };
  approveLabel?: string;
  /** Omit approve/reject for read-only (decided) rows. */
  onApprove?: Handler;
  onReject?: Handler;
  /** Footer "ลบรายการ" → in-modal required-reason step. */
  onVoid?: (reason: string) => Promise<ActionResult>;
};

type Mode = 'review' | 'confirm-approve' | 'void';

export function ReviewModal({
  open,
  onClose,
  title,
  children,
  note,
  moneyConfirm,
  approveLabel = 'อนุมัติ',
  onApprove,
  onReject,
  onVoid,
}: Props) {
  const router = useRouter();
  const noteId = useId();
  const [mode, setMode] = useState<Mode>('review');
  const [noteValue, setNoteValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setMode('review');
    setNoteValue('');
    setReason('');
    setError(null);
  }
  function close() {
    reset();
    onClose();
  }
  /** Run an action; on ok close + refresh the list, else show its message. */
  function run(action: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        close();
        router.refresh();
      } else {
        setError(r.message);
      }
    });
  }

  function clickApprove() {
    if (note?.required && !noteValue.trim()) {
      setError('กรุณาระบุหมายเหตุ');
      return;
    }
    if (moneyConfirm) {
      setError(null);
      setMode('confirm-approve');
      return;
    }
    if (onApprove) run(() => onApprove(noteValue.trim()));
  }
  function clickReject() {
    if (note?.required && !noteValue.trim()) {
      setError('กรุณาระบุหมายเหตุ');
      return;
    }
    if (onReject) run(() => onReject(noteValue.trim()));
  }

  return (
    <Dialog
      open={open}
      onClose={() => !pending && close()}
      title={title}
      dismissable={!pending}
    >
      {/* Detail body is hidden during the void-reason step to keep focus. */}
      {mode !== 'void' && <div className="mt-2">{children}</div>}

      {mode === 'review' && (onApprove || onReject) && note && (
        <div className="mt-4">
          <label htmlFor={noteId} className="block text-xs font-medium text-ink-2">
            หมายเหตุ <span className="text-danger">*</span>
          </label>
          <textarea
            id={noteId}
            data-autofocus
            rows={2}
            value={noteValue}
            disabled={pending}
            onChange={(e) => setNoteValue(e.target.value)}
            placeholder={note.placeholder}
            className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
        </div>
      )}

      {mode === 'confirm-approve' && (
        <p className="mt-4 text-sm text-ink-2">
          ยืนยันการอนุมัติ {moneyConfirm?.amountLabel}? การกระทำนี้จะถูกบันทึกในประวัติ
        </p>
      )}

      {mode === 'void' && (
        <div className="mt-2">
          <label htmlFor={`${noteId}-void`} className="block text-xs font-medium text-ink-2">
            เหตุผลที่ลบ <span className="text-danger">*</span>
          </label>
          <textarea
            id={`${noteId}-void`}
            data-autofocus
            rows={3}
            value={reason}
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น บันทึกผิดวัน / อนุมัติผิดคน"
            className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
          />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger-deep">
          {error}
        </p>
      )}

      {/* Footers per mode */}
      {mode === 'review' && (
        <DialogFooter
          leading={
            onVoid ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  setMode('void');
                }}
                className="text-xs text-danger hover:text-danger-deep disabled:opacity-60"
              >
                ลบรายการ
              </button>
            ) : undefined
          }
        >
          {onReject && (
            <Button type="button" variant="reject" size="sm" onClick={clickReject} disabled={pending}>
              {pending ? '…' : 'ปฏิเสธ'}
            </Button>
          )}
          {onApprove && (
            <Button type="button" variant="approve" size="sm" onClick={clickApprove} disabled={pending}>
              {pending ? '…' : approveLabel}
            </Button>
          )}
        </DialogFooter>
      )}

      {mode === 'confirm-approve' && (
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={() => setMode('review')} disabled={pending}>
            กลับ
          </Button>
          <Button
            type="button"
            variant="approve"
            size="sm"
            onClick={() => onApprove && run(() => onApprove(noteValue.trim()))}
            disabled={pending}
          >
            {pending ? 'กำลังดำเนินการ…' : `ยืนยันอนุมัติ ${moneyConfirm?.amountLabel ?? ''}`.trim()}
          </Button>
        </DialogFooter>
      )}

      {mode === 'void' && (
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={() => setMode('review')} disabled={pending}>
            กลับ
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              if (!reason.trim()) {
                setError('กรุณาระบุเหตุผล');
                return;
              }
              if (onVoid) run(() => onVoid(reason.trim()));
            }}
            disabled={pending}
          >
            {pending ? 'กำลังดำเนินการ…' : 'ยืนยันลบ'}
          </Button>
        </DialogFooter>
      )}
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (component compiles; not yet used).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/review-modal.tsx
git commit -m "feat(ui): ReviewModal shell (footer + note + money/void steps + refresh)"
```

> ReviewModal has no standalone test — it is UI, covered end-to-end by the leave/advance page specs (Tasks 5, 7) and `review-modal.spec.ts` (Task 8).

---

### Task 4: Leave inbox client component

**Files:**
- Create: `src/app/(admin)/admin/leave/leave-inbox.tsx`

Renders the row list (rail + icon badge, whole-row button) + one `ReviewModal`. Receives a serializable VM array from the server page (Task 5).

- [ ] **Step 1: Define the VM type + create the component**

```tsx
// src/app/(admin)/admin/leave/leave-inbox.tsx
'use client';

import { useState } from 'react';
import { Dropzone } from '@/components/ui/dropzone'; // not used here; remove if unused
import { ReviewModal } from '@/components/ui/review-modal';
import { STATUS_ICON, StatusBadge, type StatusKey, statusRail } from '@/components/ui/status-badge';
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
  range: string; // pre-formatted
  workingDays: number;
  submitted: string; // pre-formatted
  reason: string;
  reviewNote: string | null;
  reviewedAt: string | null; // pre-formatted
};

function badge(row: LeaveRowVM) {
  return (
    <StatusBadge status={row.statusKey}>
      {STATUS_ICON[row.statusKey] ?? ''} {row.statusLabel}
    </StatusBadge>
  );
}

export function LeaveInbox({ rows }: { rows: LeaveRowVM[] }) {
  const [open, setOpen] = useState<LeaveRowVM | null>(null);
  const isPending = open?.status === 'Pending';

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
                    {badge(row)}
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

      <ReviewModal
        open={open !== null}
        onClose={() => setOpen(null)}
        title="ตรวจสอบคำขอลา"
        note={isPending ? { required: true, placeholder: 'เช่น: อนุมัติตามขอ / ปฏิเสธ — ไม่มีเอกสารแนบ' } : undefined}
        onApprove={
          isPending && open
            ? (n) => approveLeaveRequest({ leaveRequestId: open.id, note: n })
            : undefined
        }
        onReject={
          isPending && open
            ? (n) => rejectLeaveRequest({ leaveRequestId: open.id, note: n })
            : undefined
        }
        onVoid={open ? (reason) => voidLeaveRequest(open.id, reason) : undefined}
      >
        {open && <LeaveBody row={open} />}
      </ReviewModal>
    </>
  );
}

function LeaveBody({ row }: { row: LeaveRowVM }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {badge(row)}
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
      <div>
        <p className="text-xs font-medium text-ink-4">เหตุผลของพนักงาน</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{row.reason}</p>
      </div>
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

> Remove the unused `Dropzone` import (it was a copy guard). Run Biome in Step 3.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (The `approveLeaveRequest` result type is assignable to `ActionResult`.)

- [ ] **Step 3: Biome + commit**

```bash
npx biome check --write "src/app/(admin)/admin/leave/leave-inbox.tsx"
git add "src/app/(admin)/admin/leave/leave-inbox.tsx"
git commit -m "feat(leave): LeaveInbox client (rail rows + ReviewModal)"
```

---

### Task 5: Wire `LeaveInbox` into the leave page + delete the inline panel

**Files:**
- Modify: `src/app/(admin)/admin/leave/page.tsx`
- Delete: `src/app/(admin)/admin/leave/leave-review-panel.tsx`
- Test: `tests/e2e/admin-leave-approval.spec.ts`

- [ ] **Step 1: Update the e2e to the modal flow (write the failing test first)**

Replace the interaction block in `tests/e2e/admin-leave-approval.spec.ts`. The approve test body becomes:

```ts
    // Open the row → modal → fill note → approve. The row leaves the Pending list.
    await row.click();
    await page.getByRole('dialog').getByRole('textbox').fill('e2e — approved by Playwright');
    await page.getByRole('dialog').getByRole('button', { name: /^อนุมัติ/ }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 });
```

and the reject test body:

```ts
    await row.click();
    await page.getByRole('dialog').getByRole('textbox').fill('e2e — rejected');
    await page.getByRole('dialog').getByRole('button', { name: /^ปฏิเสธ/ }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 });
```

Keep all the existing Prisma DB assertions (status/reviewNote) unchanged — they are the real contract.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:e2e -- admin-leave-approval.spec.ts`
Expected: FAIL — the row isn't a button / no dialog yet.

- [ ] **Step 3: Refactor the page to build a VM and render `<LeaveInbox>`**

In `src/app/(admin)/admin/leave/page.tsx`:
- Import `LeaveInbox, type LeaveRowVM` from `./leave-inbox`; drop the `LeaveReviewPanel` import.
- Keep the query, holiday expansion, `formatRange`, `formatDateTime`, `STATUS_INFO`, the filter chips, the trash branch (RestoreButton stays), and the EmptyState.
- In the non-trash branch, instead of the inline `<ul>`/`<LeaveReviewPanel>`, build the VM array and render `<LeaveInbox rows={vm} />`:

```tsx
const expandedHolidays = expandHolidaysWithSubstitutes(holidays.map((h) => h.date));
const vm: LeaveRowVM[] = rows.map((r) => {
  const info = STATUS_INFO[r.status] ?? { label: r.status, key: 'neutral' as StatusKey };
  const wd = workingDaysIn({ startDate: r.startDate, endDate: r.endDate, holidays: expandedHolidays });
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
    range: formatRange(r.startDate, r.endDate),
    workingDays: wd.length,
    submitted: formatDateTime(r.createdAt),
    reason: r.reason,
    reviewNote: r.reviewNote ?? null,
    reviewedAt: r.reviewedAt ? formatDateTime(r.reviewedAt) : null,
  };
});
```

Then in the Card body (non-trash, rows>0): `<LeaveInbox rows={vm} />`. The trash branch keeps its existing `<ul>` + `RestoreButton`. (Void now lives in the modal, so the inline `VoidDialog` per non-trash row is removed.)

> Note: the leave page no longer needs the `attachmentUrl` preview in the list (the modal body shows reason; attachments can be added to the modal later — out of scope). Keep `signAttendancePhotoUrls` only if the trash branch still uses it; otherwise remove the now-unused import (Biome will flag it).

- [ ] **Step 4: Delete the inline panel**

```bash
git rm "src/app/(admin)/admin/leave/leave-review-panel.tsx"
```

- [ ] **Step 5: Typecheck + run the e2e (now passing)**

Run: `npx tsc --noEmit && npm run test:e2e -- admin-leave-approval.spec.ts`
Expected: typecheck clean; **2 passed**. Run it 3× to confirm determinism (no settled-message race now — the modal closes + `router.refresh()`):

```bash
for i in 1 2 3; do npm run test:e2e -- admin-leave-approval.spec.ts 2>&1 | grep -E "[0-9]+ (passed|failed)"; done
```

- [ ] **Step 6: Biome + commit**

```bash
npx biome check --write "src/app/(admin)/admin/leave/page.tsx"
git add "src/app/(admin)/admin/leave/page.tsx" tests/e2e/admin-leave-approval.spec.ts
git commit -m "feat(leave): row-click ReviewModal; delete inline panel; modal e2e"
```

---

### Task 6: Advance inbox client component

**Files:**
- Create: `src/app/(admin)/admin/advance/advance-inbox.tsx`

Like `LeaveInbox` but: amount is the hero figure; the modal body has the receipt `Dropzone` (per-open-row file state); `onApprove` uploads the receipt then calls `approveCashAdvance`; `moneyConfirm` is set so approve runs the two-step. `note` is omitted (advance has no note).

- [ ] **Step 1: Create the component**

```tsx
// src/app/(admin)/admin/advance/advance-inbox.tsx
'use client';

import { useState } from 'react';
import { type ActionResult } from '@/components/ui/confirm-dialog';
import { Dropzone } from '@/components/ui/dropzone';
import { ReviewModal } from '@/components/ui/review-modal';
import { STATUS_ICON, StatusBadge, type StatusKey, statusRail } from '@/components/ui/status-badge';
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
  amount: string; // pre-formatted ฿X,XXX.XX
  submitted: string;
  decidedAt: string | null;
  receiptUrl: string | null; // resolved (signed) URL or null
};

function badge(row: AdvanceRowVM) {
  return (
    <StatusBadge status={row.statusKey}>
      {STATUS_ICON[row.statusKey] ?? ''} {row.statusLabel}
    </StatusBadge>
  );
}

export function AdvanceInbox({ rows }: { rows: AdvanceRowVM[] }) {
  const [open, setOpen] = useState<AdvanceRowVM | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isPending = open?.status === 'Pending';

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
    setOpen(null);
  }

  async function doApprove(): Promise<ActionResult> {
    if (!open) return { ok: false, message: 'ไม่พบรายการ' };
    try {
      let storageKey: string | undefined;
      if (receiptFile) {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (!data.user) return { ok: false, message: 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่' };
        const compressed = await compressToJpeg(receiptFile);
        const up = await uploadAdvanceReceipt(supabase, compressed, data.user.id, open.id);
        storageKey = up.key;
      }
      return await approveCashAdvance({ cashAdvanceId: open.id, receiptUrl: storageKey });
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'เกิดข้อผิดพลาด' };
    }
  }

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
                    {badge(row)}
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
                  <p className="display text-2xl font-semibold tabular-nums text-ink-1">{row.amount}</p>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <ReviewModal
        open={open !== null}
        onClose={closeModal}
        title="ตรวจสอบคำขอเบิก"
        moneyConfirm={isPending && open ? { amountLabel: open.amount } : undefined}
        approveLabel={open ? `อนุมัติ ${open.amount}` : 'อนุมัติ'}
        onApprove={isPending ? doApprove : undefined}
        onReject={isPending && open ? () => rejectCashAdvance({ cashAdvanceId: open.id }) : undefined}
        onVoid={open ? (reason) => voidCashAdvance(open.id, reason) : undefined}
      >
        {open && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {badge(open)}
                <span className="text-sm font-medium text-ink-1">
                  {open.name}
                  {open.nickname && <span className="text-ink-3"> ({open.nickname})</span>}
                </span>
              </div>
              <p className="display text-2xl font-semibold tabular-nums text-ink-1">{open.amount}</p>
            </div>
            <p className="text-xs text-ink-3">
              {open.branch}
              {open.department ? ` • ${open.department}` : ''} — ส่งเมื่อ {open.submitted}
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
                    <img src={previewUrl} alt="ตัวอย่างใบเสร็จ" className="h-20 w-20 rounded object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink-1">{receiptFile?.name}</p>
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
              open.receiptUrl && (
                <a
                  href={open.receiptUrl}
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
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Biome + commit**

```bash
npx biome check --write "src/app/(admin)/admin/advance/advance-inbox.tsx"
git add "src/app/(admin)/admin/advance/advance-inbox.tsx"
git commit -m "feat(advance): AdvanceInbox client (rail rows + ReviewModal + money confirm)"
```

---

### Task 7: Wire `AdvanceInbox` into the advance page + delete the inline panel

**Files:**
- Modify: `src/app/(admin)/admin/advance/page.tsx`
- Delete: `src/app/(admin)/admin/advance/advance-review-panel.tsx`
- Test: `tests/e2e/admin-advance-approval.spec.ts`

- [ ] **Step 1: Update the e2e to the modal flow (failing first)**

In `tests/e2e/admin-advance-approval.spec.ts`, the approve test interaction becomes (open row → money two-step):

```ts
    await row.click();
    await page.getByRole('dialog').getByRole('button', { name: /^อนุมัติ ฿/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^ยืนยันอนุมัติ/ }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 });
```

and the reject test:

```ts
    await row.click();
    await page.getByRole('dialog').getByRole('button', { name: /^ปฏิเสธ$/ }).click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 });
```

Keep the Prisma assertions (status Approved/Rejected, receiptUrl null, approvedById, etc.).

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:e2e -- admin-advance-approval.spec.ts`
Expected: FAIL (rows aren't buttons yet).

- [ ] **Step 3: Refactor the page to build a VM and render `<AdvanceInbox>`**

In `src/app/(admin)/admin/advance/page.tsx`:
- Import `AdvanceInbox, type AdvanceRowVM` from `./advance-inbox`; drop the `AdvanceReviewPanel` + `VoidDialog` (non-trash) imports.
- Keep query, `formatMoney`, `formatDateTime`, `STATUS_INFO`, filter chips, trash branch (RestoreButton), EmptyState, `resolveReceipt`.
- Build the VM and render `<AdvanceInbox rows={vm} />` in the non-trash, rows>0 branch:

```tsx
const vm: AdvanceRowVM[] = rows.map((r) => {
  const info = STATUS_INFO[r.status] ?? { label: r.status, key: 'neutral' as StatusKey };
  return {
    id: r.id,
    status: r.status,
    statusKey: info.key,
    statusLabel: info.label,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
    nickname: r.employee.nickname,
    branch: r.employee.branch.name,
    department: r.employee.department?.name ?? null,
    amount: formatMoney(r.amount),
    submitted: formatDateTime(r.requestedAt),
    decidedAt: r.approvedAt ? formatDateTime(r.approvedAt) : null,
    receiptUrl: resolveReceipt(r.receiptUrl),
  };
});
```

(`STATUS_INFO` here is the same `{label,key}` map used by leave — add it to the advance page, keyed by the four statuses, importing `StatusKey`.)

- [ ] **Step 4: Delete the inline panel**

```bash
git rm "src/app/(admin)/admin/advance/advance-review-panel.tsx"
```

- [ ] **Step 5: Typecheck + run the e2e 3×**

Run: `npx tsc --noEmit && for i in 1 2 3; do npm run test:e2e -- admin-advance-approval.spec.ts 2>&1 | grep -E "[0-9]+ (passed|failed)"; done`
Expected: typecheck clean; **2 passed** each run.

- [ ] **Step 6: Biome + commit**

```bash
npx biome check --write "src/app/(admin)/admin/advance/page.tsx"
git add "src/app/(admin)/admin/advance/page.tsx" tests/e2e/admin-advance-approval.spec.ts
git commit -m "feat(advance): row-click ReviewModal + money confirm; delete inline panel"
```

---

### Task 8: Rework `confirm-dialog.spec.ts` → `review-modal.spec.ts`

**Files:**
- Rename: `tests/e2e/confirm-dialog.spec.ts` → `tests/e2e/review-modal.spec.ts`
- Rewrite to test the ReviewModal contract via the advance page.

- [ ] **Step 1: Rename + rewrite**

```bash
git mv tests/e2e/confirm-dialog.spec.ts tests/e2e/review-modal.spec.ts
```

New contents (keep the existing `seedPendingAdvance` helper):

```ts
// tests/e2e/review-modal.spec.ts — contract for the shared ReviewModal via /admin/advance
// Test 1: amount shown + CANCEL (✕/back) aborts with no mutation.
//   row.click() → dialog visible → expect /฿7,777/ visible → click "อนุมัติ ฿"
//   → expect "ยืนยันอนุมัติ" visible → click "กลับ" → click dialog ✕ (aria "ปิด")
//   → expect dialog hidden → DB: status Pending, approvedAt null.
// Test 2: CONFIRM commits → row.click() → "อนุมัติ ฿" → "ยืนยันอนุมัติ"
//   → dialog hidden → DB: status Approved, approvedById not null.
// Test 3: VOID from the modal → row.click() → "ลบรายการ" → fill reason
//   → "ยืนยันลบ" → dialog hidden → DB: deletedAt not null.
```

Write the three tests concretely using `page.getByRole('dialog')` scoping and the existing seed helper + Prisma assertions. For Test 1's cancel, click the dialog close button via `page.getByRole('dialog').getByRole('button', { name: 'ปิด' })`.

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -- review-modal.spec.ts`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/review-modal.spec.ts
git commit -m "test(e2e): review-modal contract (amount / cancel / confirm / void)"
```

---

### Task 9: Cleanup + full verification

**Files:**
- Delete: `src/app/(admin)/admin/mockup-review/page.tsx`

- [ ] **Step 1: Delete the throwaway mockup route**

```bash
git rm "src/app/(admin)/admin/mockup-review/page.tsx"
git commit -m "chore: remove throwaway review mockup route"
```

- [ ] **Step 2: Full gate**

Run:
```bash
npx tsc --noEmit
npx biome check src/ tests/
npx vitest run
npm run test:e2e -- admin-leave-approval.spec.ts admin-advance-approval.spec.ts review-modal.spec.ts
```
Expected: typecheck clean; Biome clean; all unit tests pass; **6 e2e passed**.

- [ ] **Step 3: Visual smoke (manual or screenshot spec)**

Seed data is present (`npm run db:seed:leave-advance`). Log in, open `/admin/leave?status=all` and `/admin/advance?status=all`: rows show colored rails + icon badges; clicking a Pending row opens the modal (note/approve/reject for leave; receipt + money-confirm for advance); clicking a decided row opens read-only; ✕ and backdrop close; mobile = bottom-sheet. Fix any visual drift against the spec's consistency rules.

- [ ] **Step 4: Update the master plan progress**

In `docs/superpowers/plans/2026-06-02-sapphire-production-redesign.md`, add a note under PR-4/PR-5 that the inline review panels were replaced by the shared `ReviewModal` + status rail (this plan). Commit.

```bash
git add docs/superpowers/plans/2026-06-02-sapphire-production-redesign.md
git commit -m "docs(plan): note review-modal refactor of leave/advance inboxes"
```

---

## Self-review notes

- **Spec coverage:** status rail+icon (Task 1) · shared DialogFooter (Task 2) · ReviewModal shell w/ note, money two-step, void step, refresh (Task 3) · whole-row trigger + leave body + decided read-only (Tasks 4–5) · advance body w/ receipt upload + money confirm (Tasks 6–7) · close button (already shipped on `Dialog`) · dialog-consistency (sm buttons / no divider / matched textarea — baked into Tasks 2–3) · test rework (Tasks 5, 7, 8) · cleanup (Task 9). ✓
- **Refresh behavior:** `router.refresh()` lives in `ReviewModal.run()`; the server actions stay non-revalidating (the PR-4/PR-5 fix), so there's no double-render and no in-row settled message. ✓
- **Read-only rows:** driven by *which handlers the parent passes* — decided rows omit `onApprove`/`onReject`/`note`, so the modal shows body + (void) + close only. ✓
- **Void:** in-modal reason step (no nested dialog); still required-reason, matching the confirm map. Trash-view RestoreButton is untouched. ✓
- **Type assignability:** `ApproveResult`/`RejectResult`/`VoidResult` (`{ok:true} | {ok:false,code,message}`) are assignable to `ActionResult` (`{ok:true} | {ok:false,message}`), so handlers can return action results directly. ✓
