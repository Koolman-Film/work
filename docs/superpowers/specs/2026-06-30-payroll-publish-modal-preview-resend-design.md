# Payroll publish modal: post-publish preview + resend

**Date:** 2026-06-30
**Status:** Approved (pending implementation plan)

## Problem

After an admin clicks **"เผยแพร่ + ส่งสลิป"** in the per-employee payroll detail modal,
the modal re-renders into the **Published** view, which today shows only the frozen
numbers — no slip preview, no confirmation that the LINE notification went out, and no
way to resend it if the push failed. The **Draft** view, by contrast, already shows a
slip preview pane on the right.

Three gaps to close:

1. Show the slip preview on the right in the Published/Locked modal (parity with Draft),
   so the post-publish "finish" view and any later reopen both show the slip.
2. Add a **resend** button for the LINE rich message, as a safety net when a send fails.
3. Show a **"sent"** note — honestly framed, since delivery is asynchronous.

## Constraints (from current architecture)

- **Notifications are async + deduped.** `sendNotification` (src/lib/inngest/events.ts)
  queues an Inngest event keyed `notif:payroll.published:{payrollId}:{recipientUserId}`
  with a **24h dedup window**, then returns once Inngest acknowledges (~<100ms). The
  actual LINE push happens in a separate retried Inngest function.
  - Implication A: a naive resend within 24h would be **silently deduped** — a working
    resend must queue with a **fresh event id**.
  - Implication B: the admin action can only confirm the push was **queued**, never
    **delivered**. The UI copy must say "sent / may take a moment", not "delivered".
- **No send-status persistence.** Nothing records per-recipient delivery results, so we
  do not attempt to show real delivery state (explicitly out of scope — see below).
- **Published preview source.** `/admin/payroll/preview-html` currently always
  *recomputes* the slip via `buildPreviewPayslipDocument` (correct for Drafts). For a
  Published/Locked row this can drift from the frozen slip the employee actually received
  if adjustments changed after publish.

## Design

### 1. Published preview reflects the frozen slip

Branch the admin preview route `/admin/payroll/preview-html` (src/app/(admin)/admin/payroll/preview-html/route.ts)
by the row's payroll status:

- **Draft** → `buildPreviewPayslipDocument(month, employeeId)` (recompute) — unchanged.
- **Published / Locked** → `getPayslipDocument(employeeId, month)` (the frozen-row builder
  in src/lib/payslip/document.ts that the employee's LIFF PDF route already uses).

The route looks up the row's status server-side (it already has `employeeId` + `month`);
no new query param needed. Result: the admin preview for a published slip is byte-for-byte
the same document the employee sees. `getPayslipDocument` returns `null` when the row is
not Published/Locked → route responds 404 as today (the iframe shows its existing error
state with a manual reload affordance).

### 2. Modal layout parity (`RowDetail`)

In src/app/(admin)/admin/payroll/row-detail.tsx:

- Extract the right-side preview block (the "ตัวอย่างสลิป (PDF)" header + retry button +
  iframe + loading overlay) into a small local component (e.g. `SlipPreviewPane`) so it is
  shared by both branches instead of duplicated. It already only needs `month` +
  `employeeId` + its own `previewLoading`/`previewKey` state.
- **Draft branch:** unchanged (breakdown left, preview right).
- **Published/Locked branch:** wrap the existing frozen breakdown + the shared preview pane
  in the same `lg:flex lg:gap-6` two-column layout used by Draft (frozen breakdown
  `lg:flex-[2]`, preview `lg:flex-[3]`), then render the sent/resend footer (section 3)
  below.

### 3. Sent note + resend footer (Published/Locked only)

A new prop `lineLinked: boolean` is threaded into `RowDetail`:

- **Linked** (`employee.user.lineUserId != null`):
  - Note: **"✓ ส่งสลิปทาง LINE แล้ว"**
  - Sub-line (smaller, muted): **"ระบบส่งแบบอัตโนมัติ อาจใช้เวลาสักครู่จึงจะถึงพนักงาน"**
  - Button: **"ส่งอีกครั้ง"** → `ConfirmDialog` ("ส่งสลิปทาง LINE อีกครั้ง?") to prevent
    accidental re-spam, consistent with the codebase's pattern for sensitive actions.
  - On resend success, show a transient confirmation: **"ส่งอีกครั้งแล้ว · อาจใช้เวลาสักครู่"**.
- **Not linked** (`lineUserId == null`):
  - Note: **"ยังไม่ได้เชื่อมบัญชี LINE — ส่งสลิปไม่ได้"**, resend button disabled.

`lineLinked` is derived in the page (src/app/(admin)/admin/payroll/page.tsx) by adding
`user: { select: { lineUserId: true } }` to the existing rows `findMany` include, and
passed through where `RowDetail` is rendered.

### 4. Resend server action + dedup bypass

New action in src/app/(admin)/admin/payroll/actions.ts:

```
resendPayslipNotificationAction(employeeId, month): Promise<ActionResult>
```

- Gated `requirePermission('payroll.publish')`; validate `month` (MONTH_RE) + `employeeId`
  (UUID_RE).
- Look up the Published/Locked payroll row + recipient (the linked User). If no such row,
  or the employee has no linked LINE user → `{ ok: false, message }` (defensive: the button
  is already disabled/absent in those cases).
- Re-queue the `payroll.published` flex via the notify path, **bypassing the 24h dedup**.
- Write an audit log (`payroll.publish`, metadata `{ via: 'resend', employeeId }`).
- LINE/queue failure → `{ ok: false, message }`; never throws to the client.

**Dedup bypass:** add an optional options arg to `sendNotification`:

```
sendNotification(recipientUserId, payload, opts?: { dedupeSuffix?: string })
```

When `dedupeSuffix` is set, append it to the Inngest event `id`
(`{idempotencyKey}:{recipientUserId}:{dedupeSuffix}`) so the resend is treated as a new
event rather than a 24h-window duplicate. The resend action passes a unique per-call
suffix (a fresh nonce — server-action runtime, so a timestamp/random value is fine here;
this is not a workflow-script context). Default behavior (no `dedupeSuffix`) is byte-for-byte
unchanged for all existing callers (publish, per-employee publish, admin fan-out).

A thin helper (e.g. `resendPublishedSlipNotification(month, slip, suffix)`) mirrors
`notifyPublishedSlips` for a single recipient, or the action calls `sendNotification`
directly with the assembled `payroll.published` payload.

### 5. Bulk "sent" message

Already covered by the existing publish toast: *"เผยแพร่สลิป N คน และส่งแจ้งเตือน LINE แล้ว"*.
No change.

## Error handling

- Resend: publish is already committed; a LINE/queue failure returns an inline error in the
  `ConfirmDialog` and does not crash or alter the published row.
- Non-linked employee: guarded both in the UI (disabled button) and server-side (action
  returns an error rather than queuing a no-op).
- Preview route: unchanged error semantics — a 404/500 renders into the iframe; the existing
  "โหลดใหม่" button re-mounts it.

## Testing

Unit-level (matches the repo's existing test style; no React component tests unless requested):

1. `sendNotification` with `dedupeSuffix` produces an event `id` **distinct** from the
   no-suffix id (dedup bypass), and the no-suffix id is unchanged from today.
2. `resendPayslipNotificationAction`: rejects bad month/employee; returns an error for a
   non-Published row or a non-linked employee; on the happy path queues exactly one event
   with a distinct id and writes the audit log. (Mock prisma + the notify/inngest boundary
   as existing action tests do.)
3. Preview route document selection: Published/Locked → frozen builder
   (`getPayslipDocument`); Draft → recompute (`buildPreviewPayslipDocument`).

## Out of scope (YAGNI)

- No schema changes.
- No real per-recipient delivery-status tracking (would need schema + Inngest write-back).
- No bulk "resend all" — per-employee resend only.

## Touched files

- src/app/(admin)/admin/payroll/preview-html/route.ts — status-based document selection
- src/app/(admin)/admin/payroll/row-detail.tsx — shared preview pane + Published layout + footer
- src/app/(admin)/admin/payroll/page.tsx — add `user.lineUserId` to rows query; pass `lineLinked`
- src/app/(admin)/admin/payroll/actions.ts — `resendPayslipNotificationAction`
- src/lib/inngest/events.ts — optional `dedupeSuffix` on `sendNotification`
- src/lib/payroll/run.ts — (optional) single-recipient resend helper
- tests alongside the above
