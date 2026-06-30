# Payroll publish modal: preview + resend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After publishing a slip, show the real (frozen) slip preview in the per-employee payroll detail modal, with an async-aware "sent" note and a resend button for the LINE rich message.

**Architecture:** Four additive changes — (1) a dedup-bypass option on `sendNotification`, (2) a status-aware admin preview document selector, (3) a `resendPayslipNotificationAction` server action, (4) `RowDetail` UI parity for Published/Locked rows. No schema changes.

**Tech Stack:** Next.js (App Router, RSC + server actions), Prisma, Inngest, next-intl, Vitest, Biome.

## Global Constraints

- **Spec:** docs/superpowers/specs/2026-06-30-payroll-publish-modal-preview-resend-design.md
- **No schema changes; no delivery-status persistence; no bulk resend** (YAGNI).
- **Run a single test file:** `npx vitest run <path>`.
- **Commits:** `lint-staged` is NOT installed in worktrees, so the pre-commit hook fails. Before each commit, run Biome manually on changed TS files, then commit with `--no-verify`:
  `npx biome check --write --no-errors-on-unmatched <files…>` then `git commit --no-verify -m "…"`.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Resend dedup:** a resend MUST queue with a fresh Inngest event id; the 24h dedup window keys on `notif:payroll.published:{payrollId}:{recipientUserId}`.
- **"Sent" copy must say queued/async, never "delivered."**

---

### Task 1: Dedup-bypass for `sendNotification`

Extract the Inngest event-id construction into a pure, side-effect-free module so the dedup-bypass is unit-testable, then add an optional `dedupeSuffix`.

**Files:**
- Create: `src/lib/inngest/notification-id.ts`
- Create: `src/lib/inngest/notification-id.test.ts`
- Modify: `src/lib/inngest/events.ts` (remove the local `notificationIdempotencyKey`; import from the new module; add `opts` to `sendNotification`)

**Interfaces:**
- Produces: `notificationEventId(payload: NotificationPayload, recipientUserId: string, dedupeSuffix?: string): string`
- Produces: `notificationIdempotencyKey(payload: NotificationPayload): string` (moved verbatim)
- Produces (modified): `sendNotification(recipientUserId: string, payload: NotificationPayload, opts?: { dedupeSuffix?: string }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/inngest/notification-id.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { notificationEventId } from './notification-id';

const published = {
  kind: 'payroll.published' as const,
  payrollId: 'p1',
  month: '2026-06',
  employeeFirstName: 'Aung',
  netPay: '28,500.00',
};

describe('notificationEventId', () => {
  it('default id is idempotency key + recipient (unchanged dedup behavior)', () => {
    expect(notificationEventId(published, 'u1')).toBe('notif:payroll.published:p1:u1');
  });

  it('a dedupeSuffix yields a DISTINCT id so a resend bypasses the 24h dedup window', () => {
    const base = notificationEventId(published, 'u1');
    const resend = notificationEventId(published, 'u1', 'r-abc');
    expect(resend).toBe('notif:payroll.published:p1:u1:r-abc');
    expect(resend).not.toBe(base);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/inngest/notification-id.test.ts`
Expected: FAIL — cannot resolve `./notification-id` / `notificationEventId` is not a function.

- [ ] **Step 3: Create the pure module**

Create `src/lib/inngest/notification-id.ts` (the switch is copied VERBATIM from `events.ts`, comments included, so dedup keys are byte-for-byte identical):

```ts
import type { NotificationPayload } from './events';

/**
 * Stable per-entity idempotency key. The Inngest 24h dedup window keys on
 * this plus the recipient suffix (see notificationEventId). Kept in its own
 * side-effect-free module so it can be unit-tested without importing the
 * Inngest client.
 */
export function notificationIdempotencyKey(payload: NotificationPayload): string {
  switch (payload.kind) {
    case 'leave.approved':
    case 'leave.rejected':
      return `notif:${payload.kind}:${payload.leaveRequestId}`;
    case 'advance.approved':
    case 'advance.rejected':
    // advance.paid re-fires when an admin re-uploads the transfer slip —
    // within Inngest's ~24h dedupe window the second push is dropped.
    // Intentional: the employee already got "paid" for that advance.
    // (key includes the recipientUserId suffix — still deterministic for
    // single-recipient worker kinds)
    case 'advance.paid':
    case 'admin.advance-submitted':
      return `notif:${payload.kind}:${payload.cashAdvanceId}`;
    case 'admin.leave-submitted':
      return `notif:${payload.kind}:${payload.leaveRequestId}`;
    case 'admin.dispute-submitted':
      return `notif:${payload.kind}:${payload.attendanceId}`;
    case 'attendance.dispute-approved':
    case 'attendance.dispute-rejected':
      return `notif:${payload.kind}:${payload.attendanceId}`;
    case 'payroll.published':
      return `notif:${payload.kind}:${payload.payrollId}`;
  }
}

/**
 * The Inngest event id. Appending a `dedupeSuffix` produces a fresh id so a
 * deliberate resend escapes the 24h dedup window (the default — no suffix —
 * is byte-for-byte the id every existing caller already produced).
 */
export function notificationEventId(
  payload: NotificationPayload,
  recipientUserId: string,
  dedupeSuffix?: string,
): string {
  const base = `${notificationIdempotencyKey(payload)}:${recipientUserId}`;
  return dedupeSuffix ? `${base}:${dedupeSuffix}` : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/inngest/notification-id.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `events.ts` to the new module**

In `src/lib/inngest/events.ts`: delete the local `function notificationIdempotencyKey(...) { … }` definition entirely, add the import, and update `sendNotification`. The `NotificationPayload` type stays defined/exported in `events.ts` (the new module imports it `type`-only).

Add near the existing imports:

```ts
import { notificationEventId } from './notification-id';
```

Replace the whole `sendNotification` function with:

```ts
export async function sendNotification(
  recipientUserId: string,
  payload: NotificationPayload,
  opts?: { dedupeSuffix?: string },
): Promise<void> {
  await inngest.send({
    // Recipient suffix is required for admin fan-out: the same entity is
    // pushed to N admins, and without it Inngest would dedupe them down to
    // one event. A dedupeSuffix (resend only) appends a fresh token so a
    // deliberate re-send escapes the 24h dedup window.
    id: notificationEventId(payload, recipientUserId, opts?.dedupeSuffix),
    name: 'notification.send',
    data: { ...payload, recipientUserId },
  });
}
```

- [ ] **Step 6: Verify typecheck + full suite (no regressions)**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "inngest" | head`
Expected: no output.
Run: `npx vitest run src/lib/inngest src/lib/line`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx biome check --write --no-errors-on-unmatched src/lib/inngest/notification-id.ts src/lib/inngest/notification-id.test.ts src/lib/inngest/events.ts
git add src/lib/inngest/notification-id.ts src/lib/inngest/notification-id.test.ts src/lib/inngest/events.ts
git commit --no-verify -m "feat(notif): optional dedupeSuffix on sendNotification for resends

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Status-aware admin preview source

The admin preview route always recomputes the slip; for a Published/Locked row that can drift from the frozen slip the employee received. Branch it to use the frozen builder for published rows.

**Files:**
- Modify: `src/lib/payslip/preview.ts` (add `pickPreviewSource`)
- Create: `src/lib/payslip/preview-source.test.ts`
- Modify: `src/app/(admin)/admin/payroll/preview-html/route.ts` (select builder by row status)

**Interfaces:**
- Consumes: `getPayslipDocument(employeeId, month)` from `src/lib/payslip/document.ts` (frozen builder; returns `null` unless the row is Published/Locked).
- Consumes: `buildPreviewPayslipDocument(month, employeeId)` from `src/lib/payslip/preview.ts` (recompute builder).
- Produces: `pickPreviewSource(status: 'Draft' | 'Published' | 'Locked'): 'recompute' | 'frozen'`

- [ ] **Step 1: Write the failing test**

Create `src/lib/payslip/preview-source.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickPreviewSource } from './preview';

describe('pickPreviewSource', () => {
  it('Draft → recompute (live engine, may still change)', () => {
    expect(pickPreviewSource('Draft')).toBe('recompute');
  });
  it('Published → frozen (exactly what the employee received)', () => {
    expect(pickPreviewSource('Published')).toBe('frozen');
  });
  it('Locked → frozen', () => {
    expect(pickPreviewSource('Locked')).toBe('frozen');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payslip/preview-source.test.ts`
Expected: FAIL — `pickPreviewSource` is not exported.

- [ ] **Step 3: Add `pickPreviewSource` to `preview.ts`**

In `src/lib/payslip/preview.ts`, add at the top (after imports):

```ts
/**
 * Which document a preview should render for a payroll row. Drafts recompute
 * live (numbers can still change); Published/Locked render the FROZEN slip —
 * the same bytes the employee got — so the admin preview never silently drifts
 * from reality after a post-publish adjustment edit.
 */
export function pickPreviewSource(
  status: 'Draft' | 'Published' | 'Locked',
): 'recompute' | 'frozen' {
  return status === 'Draft' ? 'recompute' : 'frozen';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payslip/preview-source.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Branch the preview route by status**

In `src/app/(admin)/admin/payroll/preview-html/route.ts`:

Add imports:

```ts
import { prisma } from '@/lib/db/prisma';
import { getPayslipDocument } from '@/lib/payslip/document';
import { buildPreviewPayslipDocument, pickPreviewSource } from '@/lib/payslip/preview';
```

(If `buildPreviewPayslipDocument` is already imported, just extend that import to add `pickPreviewSource`, and remove any duplicate import lines.)

Replace the existing document-build block:

```ts
  let doc: Awaited<ReturnType<typeof buildPreviewPayslipDocument>>;
  try {
    doc = await buildPreviewPayslipDocument(month, employeeId);
  } catch (err) {
    console.error('[payslip-preview-html] document build failed', {
      employeeId,
      month,
      error: err instanceof Error ? err.message : String(err),
    });
    return new NextResponse('Could not generate preview', { status: 500 });
  }
  if (!doc) return new NextResponse('No computable draft', { status: 404 });
```

with:

```ts
  let doc: Awaited<ReturnType<typeof buildPreviewPayslipDocument>>;
  try {
    const row = await prisma.payroll.findFirst({
      where: { employeeId, month },
      select: { status: true },
    });
    // Published/Locked → render the frozen slip (what the employee received);
    // Draft (or no row yet) → recompute live.
    doc =
      row && pickPreviewSource(row.status) === 'frozen'
        ? await getPayslipDocument(employeeId, month)
        : await buildPreviewPayslipDocument(month, employeeId);
  } catch (err) {
    console.error('[payslip-preview-html] document build failed', {
      employeeId,
      month,
      error: err instanceof Error ? err.message : String(err),
    });
    return new NextResponse('Could not generate preview', { status: 500 });
  }
  if (!doc) return new NextResponse('No computable slip', { status: 404 });
```

- [ ] **Step 6: Verify typecheck + suite**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "preview" | head`
Expected: no output.
Run: `npx vitest run src/lib/payslip`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx biome check --write --no-errors-on-unmatched src/lib/payslip/preview.ts src/lib/payslip/preview-source.test.ts "src/app/(admin)/admin/payroll/preview-html/route.ts"
git add src/lib/payslip/preview.ts src/lib/payslip/preview-source.test.ts "src/app/(admin)/admin/payroll/preview-html/route.ts"
git commit --no-verify -m "feat(payroll): admin preview renders frozen slip for published rows

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `resendPayslipNotificationAction`

A server action that re-queues the `payroll.published` LINE flex for one already-published employee, bypassing the dedup window.

**Files:**
- Modify: `src/app/(admin)/admin/payroll/actions.ts` (add the action + import `sendNotification`)
- Create: `src/app/(admin)/admin/payroll/resend-notification.test.ts`

**Interfaces:**
- Consumes: `sendNotification(recipientUserId, payload, { dedupeSuffix })` (Task 1).
- Consumes: `ActionResult` (already imported in `actions.ts` from `@/components/ui/confirm-dialog`).
- Produces: `resendPayslipNotificationAction(employeeId: string, month: string): Promise<ActionResult>`

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/admin/payroll/resend-notification.test.ts`. The mocks shield `actions.ts`'s heavy transitive imports (run engine, warm, prisma, inngest) so only the action's own logic runs:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
}));
vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }));
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn() }));

const requirePermission = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
}));

const sendNotification = vi.fn();
vi.mock('@/lib/inngest/events', () => ({
  sendNotification: (...a: unknown[]) => sendNotification(...a),
}));

// Shield the engine/warm modules actions.ts imports at module load.
vi.mock('@/lib/payroll/run', () => ({
  publishPayroll: vi.fn(),
  lockPayroll: vi.fn(),
  notifyPublishedSlips: vi.fn(),
  payrollRowDetail: vi.fn(),
  runPayrollDraft: vi.fn(),
}));
vi.mock('@/lib/payslip/warm', () => ({ warmPublishedPayslips: vi.fn() }));
vi.mock('./adjustments/adjustment-schema', () => ({ readForm: vi.fn() }));

const payrollFindFirst = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: { payroll: { findFirst: (...a: unknown[]) => payrollFindFirst(...a) } },
}));

import { resendPayslipNotificationAction } from './actions';

const VALID_EMP = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { id: 'actor' } });
});

describe('resendPayslipNotificationAction', () => {
  it('rejects a malformed month', async () => {
    const r = await resendPayslipNotificationAction(VALID_EMP, '2026-13');
    expect(r.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('rejects a malformed employee id', async () => {
    const r = await resendPayslipNotificationAction('not-a-uuid', '2026-06');
    expect(r.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('errors when the slip is not published', async () => {
    payrollFindFirst.mockResolvedValue(null);
    const r = await resendPayslipNotificationAction(VALID_EMP, '2026-06');
    expect(r).toEqual({ ok: false, message: 'ยังไม่ได้เผยแพร่สลิปงวดนี้' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('errors when the employee has no linked LINE account', async () => {
    payrollFindFirst.mockResolvedValue({
      id: 'pay1',
      netPay: { toNumber: () => 28500 },
      employee: { firstName: 'Aung', userId: 'u1', user: { lineUserId: null } },
    });
    const r = await resendPayslipNotificationAction(VALID_EMP, '2026-06');
    expect(r.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('re-queues the flex with a fresh dedupeSuffix and the published payload', async () => {
    payrollFindFirst.mockResolvedValue({
      id: 'pay1',
      netPay: { toNumber: () => 28500 },
      employee: { firstName: 'Aung', userId: 'u1', user: { lineUserId: 'L1' } },
    });
    const r = await resendPayslipNotificationAction(VALID_EMP, '2026-06');
    expect(r).toEqual({ ok: true });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [recipient, payload, opts] = sendNotification.mock.calls[0];
    expect(recipient).toBe('u1');
    expect(payload).toMatchObject({
      kind: 'payroll.published',
      payrollId: 'pay1',
      month: '2026-06',
      employeeFirstName: 'Aung',
      netPay: '28,500.00',
    });
    expect(typeof opts.dedupeSuffix).toBe('string');
    expect(opts.dedupeSuffix.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(admin)/admin/payroll/resend-notification.test.ts"`
Expected: FAIL — `resendPayslipNotificationAction` is not exported.

- [ ] **Step 3: Implement the action**

In `src/app/(admin)/admin/payroll/actions.ts`, add to the imports:

```ts
import { sendNotification } from '@/lib/inngest/events';
```

Append this exported action at the end of the file:

```ts
/**
 * Resend the LINE rich message for an already-published slip — the safety net
 * when the original push failed. Re-queues with a fresh dedupeSuffix so the
 * 24h Inngest dedup window doesn't silently swallow it. Confirms only that the
 * push was QUEUED (delivery is async with retries), so the UI says "may take a
 * moment", not "delivered".
 */
export async function resendPayslipNotificationAction(
  employeeId: string,
  month: string,
): Promise<ActionResult> {
  const { user } = await requirePermission('payroll.publish');
  if (!MONTH_RE.test(month)) return { ok: false, message: 'เดือนไม่ถูกต้อง' };
  if (!UUID_RE.test(employeeId)) return { ok: false, message: 'พนักงานไม่ถูกต้อง' };

  const payroll = await prisma.payroll.findFirst({
    where: { employeeId, month, status: { in: ['Published', 'Locked'] } },
    select: {
      id: true,
      netPay: true,
      employee: {
        select: { firstName: true, userId: true, user: { select: { lineUserId: true } } },
      },
    },
  });
  if (!payroll) return { ok: false, message: 'ยังไม่ได้เผยแพร่สลิปงวดนี้' };
  if (!payroll.employee.user?.lineUserId) {
    return { ok: false, message: 'พนักงานยังไม่ได้เชื่อมบัญชี LINE — ส่งสลิปไม่ได้' };
  }

  try {
    await sendNotification(
      payroll.employee.userId,
      {
        kind: 'payroll.published',
        payrollId: payroll.id,
        month,
        employeeFirstName: payroll.employee.firstName,
        // Same formatting publishPayroll uses for the original push.
        netPay: payroll.netPay.toNumber().toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      },
      // Fresh per call → bypasses the 24h dedup window. Server-action runtime,
      // so Date.now()/randomness are fine here (this is not a workflow script).
      { dedupeSuffix: `resend-${Date.now().toString(36)}` },
    );
  } catch (err) {
    console.error('resendPayslipNotificationAction: LINE notify failed', err);
    return { ok: false, message: 'ส่งสลิปไม่สำเร็จ กรุณาลองใหม่' };
  }

  auditLog({
    actorId: user.id,
    action: 'payroll.publish',
    entityType: 'Payroll',
    entityId: month,
    metadata: { source: 'admin-ui', via: 'resend', employeeId, payrollId: payroll.id },
  });

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/(admin)/admin/payroll/resend-notification.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "payroll/actions" | head`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
npx biome check --write --no-errors-on-unmatched "src/app/(admin)/admin/payroll/actions.ts" "src/app/(admin)/admin/payroll/resend-notification.test.ts"
git add "src/app/(admin)/admin/payroll/actions.ts" "src/app/(admin)/admin/payroll/resend-notification.test.ts"
git commit --no-verify -m "feat(payroll): resendPayslipNotificationAction with dedup bypass

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Modal UI — Published preview + sent note + resend

Give the Published/Locked detail modal the same two-column layout as Draft (breakdown + preview), plus the sent/resend footer. Extract the preview pane so it isn't duplicated.

**Files:**
- Modify: `src/app/(admin)/admin/payroll/row-detail.tsx`
- Modify: `src/app/(admin)/admin/payroll/page.tsx` (rows query + new props)

**Interfaces:**
- Consumes: `resendPayslipNotificationAction(employeeId, month)` (Task 3).
- Consumes: `/admin/payroll/preview-html?m=&employeeId=` (Task 2 — now frozen-aware).
- Produces: `RowDetail` gains props `lineLinked: boolean` and `resendAction: (employeeId: string, month: string) => Promise<ActionResult>`.

- [ ] **Step 1: Extract `SlipPreviewPane` in `row-detail.tsx`**

Add this component above `RowDetail` (it holds its own preview state; identical markup to today's inline right pane):

```tsx
function SlipPreviewPane({ month, employeeId }: { month: string; employeeId: string }) {
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewKey, setPreviewKey] = useState(0); // bump to retry (re-mounts the iframe)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ink-3">ตัวอย่างสลิป (PDF)</p>
        {/* Honest retry: a 500/blank still "loads" into the iframe, so we
            can't auto-detect failure — a manual reload re-mounts it. */}
        <button
          type="button"
          onClick={() => {
            setPreviewKey((k) => k + 1);
            setPreviewLoading(true);
          }}
          className="rounded-md px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
        >
          โหลดใหม่
        </button>
      </div>
      <div className="relative">
        {previewLoading && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-lg bg-white/80">
            <div className="flex flex-col items-center gap-2">
              <span
                className="size-7 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600"
                aria-hidden="true"
              />
              <p className="text-xs text-ink-3">กำลังสร้างตัวอย่างสลิป…</p>
            </div>
          </div>
        )}
        <iframe
          key={previewKey}
          title="ตัวอย่างสลิปเงินเดือน"
          src={`/admin/payroll/preview-html?m=${month}&employeeId=${employeeId}`}
          className="h-[50dvh] w-full rounded-lg border border-gray-200 lg:h-[70vh]"
          onLoad={() => setPreviewLoading(false)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the `SentStatusFooter` component**

Add above `RowDetail` (uses `ConfirmDialog`; transient confirmation survives because `refreshOnSuccess={false}` keeps client state):

```tsx
function SentStatusFooter({
  lineLinked,
  canPublish,
  employeeId,
  month,
  resendAction,
}: {
  lineLinked: boolean;
  canPublish: boolean;
  employeeId: string;
  month: string;
  resendAction: (employeeId: string, month: string) => Promise<ActionResult>;
}) {
  const [justSent, setJustSent] = useState(false);

  if (!lineLinked) {
    return (
      <div className="mt-5 border-t border-gray-100 pt-4 text-xs text-amber-700">
        ยังไม่ได้เชื่อมบัญชี LINE — ส่งสลิปไม่ได้
      </div>
    );
  }

  return (
    <div className="mt-5 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
      <div className="min-w-0 text-xs">
        <p className="font-medium text-green-700">✓ ส่งสลิปทาง LINE แล้ว</p>
        <p className="mt-0.5 text-ink-4">ระบบส่งแบบอัตโนมัติ อาจใช้เวลาสักครู่จึงจะถึงพนักงาน</p>
        {justSent && (
          <p className="mt-0.5 font-medium text-primary-700">ส่งอีกครั้งแล้ว · อาจใช้เวลาสักครู่</p>
        )}
      </div>
      {canPublish && (
        <ConfirmDialog
          trigger={(openConfirm) => (
            <Button type="button" variant="secondary" size="sm" onClick={openConfirm}>
              ส่งอีกครั้ง
            </Button>
          )}
          title="ส่งสลิปทาง LINE อีกครั้ง?"
          description="พนักงานจะได้รับข้อความสลิปซ้ำอีกครั้ง — ใช้เมื่อการส่งครั้งก่อนอาจไม่สำเร็จ"
          confirmLabel="ส่งอีกครั้ง"
          tone="primary"
          refreshOnSuccess={false}
          action={async () => {
            const result = await resendAction(employeeId, month);
            if (result.ok) setJustSent(true);
            return result;
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `RowDetail` props**

Extend the `Props` type:

```tsx
  canPublish: boolean;
  publishAction: (employeeId: string, month: string) => Promise<ActionResult>;
  lineLinked: boolean;
  resendAction: (employeeId: string, month: string) => Promise<ActionResult>;
```

And the destructured params in `export function RowDetail({ … })` — add `lineLinked` and `resendAction`.

- [ ] **Step 4: Use `SlipPreviewPane` in the Draft branch**

In the Draft branch, replace the entire right-pane block (the `<div className="mt-4 border-t border-gray-100 pt-4 lg:mt-0 lg:flex-[3] …">…</div>` that contains the inline iframe + retry button + loading overlay) with:

```tsx
              <div className="mt-4 border-t border-gray-100 pt-4 lg:mt-0 lg:flex-[3] lg:min-w-0 lg:border-t-0 lg:border-l lg:border-gray-100 lg:pl-6 lg:pt-0">
                <SlipPreviewPane month={month} employeeId={employeeId} />
              </div>
```

Then delete the now-unused `previewLoading` / `previewKey` `useState` lines from `RowDetail` (they moved into `SlipPreviewPane`).

- [ ] **Step 5: Give the Published/Locked branch the two-column layout + footer**

Replace the Published/Locked branch — currently `frozen ? ( <div className="mt-4 space-y-4"> …frozen sections… </div> ) : ( <p…/> )` — with a two-column layout that keeps the frozen sections on the left, adds the preview on the right, and the footer below:

```tsx
        ) : frozen ? (
          /* Published/Locked — frozen stored buckets (left) + the real slip
             preview (right), mirroring the Draft layout. */
          <>
            <div className="mt-4 lg:flex lg:gap-6">
              <div className="space-y-4 lg:flex-[2] lg:min-w-0">
                <section>
                  <h3 className="text-xs font-semibold text-ink-3">รายได้</h3>
                  <Line label="ฐานเงินเดือน" value={frozen.incomeBase} />
                  {frozen.incomeOther !== '0.00' && (
                    <Line label="เงินเพิ่ม" value={`+${frozen.incomeOther}`} />
                  )}
                </section>
                <section className="border-t border-gray-100 pt-3">
                  <h3 className="text-xs font-semibold text-ink-3">รายการหัก</h3>
                  {frozen.deductSso !== '0.00' && (
                    <Line label="ประกันสังคม" value={`-${frozen.deductSso}`} />
                  )}
                  {frozen.deductAttendance !== '0.00' && (
                    <Line label="หักขาด/ลา/สาย" value={`-${frozen.deductAttendance}`} />
                  )}
                  {frozen.deductLeave !== '0.00' && (
                    <Line label="ลาเกินสิทธิ" value={`-${frozen.deductLeave}`} />
                  )}
                  {frozen.deductAdvance !== '0.00' && (
                    <Line label="หักเบิกล่วงหน้า" value={`-${frozen.deductAdvance}`} />
                  )}
                  {frozen.deductDebt !== '0.00' && (
                    <Line label="หักหนี้/ผ่อน" value={`-${frozen.deductDebt}`} />
                  )}
                  {frozen.deductOther !== '0.00' && (
                    <Line label="หักอื่น ๆ" value={`-${frozen.deductOther}`} />
                  )}
                </section>
                <section className="flex items-baseline justify-between border-t border-gray-200 pt-3">
                  <span className="text-sm font-semibold text-ink-1">เงินสุทธิ</span>
                  <span className="font-mono text-lg font-bold text-primary-700">
                    {frozen.netPay}
                  </span>
                </section>
              </div>
              <div className="mt-4 border-t border-gray-100 pt-4 lg:mt-0 lg:flex-[3] lg:min-w-0 lg:border-t-0 lg:border-l lg:border-gray-100 lg:pl-6 lg:pt-0">
                <SlipPreviewPane month={month} employeeId={employeeId} />
              </div>
            </div>
            <SentStatusFooter
              lineLinked={lineLinked}
              canPublish={canPublish}
              employeeId={employeeId}
              month={month}
              resendAction={resendAction}
            />
          </>
        ) : (
          <p className="mt-4 text-sm text-ink-3">ไม่มีข้อมูลการคำนวณสำหรับงวดนี้</p>
        )}
```

- [ ] **Step 6: Pass the new props from `page.tsx`**

In `src/app/(admin)/admin/payroll/page.tsx`:

(a) Add `lineUserId` to the rows query — extend the `employee.select` block (around line 97):

```tsx
      employee: {
        select: {
          firstName: true,
          lastName: true,
          nickname: true,
          branchId: true,
          departmentId: true,
          user: { select: { lineUserId: true } },
        },
      },
```

(b) Import the action near the other action imports (around line 19):

```tsx
  resendPayslipNotificationAction,
```

(c) Pass the new props where `<RowDetail … />` is rendered (around line 478) — add after `publishAction={…}` (keep existing props):

```tsx
              lineLinked={r.employee.user?.lineUserId != null}
              resendAction={resendPayslipNotificationAction}
```

- [ ] **Step 7: Verify typecheck, biome, full suite**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "row-detail|payroll/page" | head`
Expected: no output.
Run: `npx biome check "src/app/(admin)/admin/payroll/row-detail.tsx" "src/app/(admin)/admin/payroll/page.tsx"`
Expected: no errors.
Run: `npx vitest run`
Expected: all pass (previous count + 10 new tests from Tasks 1–3).

- [ ] **Step 8: Manual verification (record result)**

Start the app (`mcp__Claude_Preview__preview_start` / project run skill), log in as an admin with `payroll.publish`, open a month with at least one **Published** row, click **ดูรายละเอียด**, and confirm:
- the slip preview renders on the right beside the frozen numbers;
- the **"✓ ส่งสลิปทาง LINE แล้ว"** note + async sub-line show;
- **ส่งอีกครั้ง** opens the confirm, and on confirm shows **"ส่งอีกครั้งแล้ว · อาจใช้เวลาสักครู่"**;
- for an employee with no linked LINE account, the amber "ยังไม่ได้เชื่อมบัญชี LINE — ส่งสลิปไม่ได้" shows and there is no resend button.

- [ ] **Step 9: Commit**

```bash
npx biome check --write --no-errors-on-unmatched "src/app/(admin)/admin/payroll/row-detail.tsx" "src/app/(admin)/admin/payroll/page.tsx"
git add "src/app/(admin)/admin/payroll/row-detail.tsx" "src/app/(admin)/admin/payroll/page.tsx"
git commit --no-verify -m "feat(payroll): published modal shows slip preview + sent note + resend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** (1) frozen preview → Task 2; (2) modal parity / "finish modal" → Task 4 Step 5; (3) sent note + async line → Task 4 Step 2; (4) resend + dedup bypass → Tasks 1 + 3; (5) LINE-link awareness → Task 3 (server guard) + Task 4 (UI prop); bulk toast unchanged → no task (already exists). All covered.
- **Placeholder scan:** none — every code/test step has full content.
- **Type consistency:** `notificationEventId`/`sendNotification(opts)` (Task 1) consumed in Task 3; `resendPayslipNotificationAction(employeeId, month)` produced in Task 3, consumed in Task 4; `pickPreviewSource` produced/consumed in Task 2; `SlipPreviewPane`/`SentStatusFooter`/`RowDetail` props consistent across Task 4 steps.
