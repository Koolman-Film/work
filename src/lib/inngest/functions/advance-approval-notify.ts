/**
 * `advance-approval-notify` — delays the "advance approved" push instead of
 * sending it immediately.
 *
 * Why: measured on production, of 21 advances that were both approved and
 * paid, 19 were paid within an hour and the MEDIAN gap was zero minutes —
 * admins approve and pay in the same click, so the employee got two LINE
 * messages seconds apart. This function waits out SETTLE_WINDOW_MS
 * (src/lib/advance/settle-window.ts) then re-reads the advance's live state
 * and sends exactly one message:
 *   - `advance.approved-and-paid` if it was paid within the window
 *   - `advance.approved` if it's still unpaid
 *   - nothing if the advance is no longer Approved (voided/cancelled)
 *
 * Triggered by `advance.approval-decided`, fired once from
 * approveCashAdvance (src/lib/advance/admin.ts) in place of the old direct
 * `sendNotification(..., 'advance.approved')` call.
 *
 * markAdvancePaid consults the SAME settle-window helpers
 * (`paidPushNeeded`) to decide whether IT still needs to push — the two
 * sides must never drift, or the employee gets a duplicate or nothing.
 *
 * Runs sleep across a deploy: Inngest resumes this step function from
 * durable state, matched by function id and step id. That only works if the
 * function id (`advance-approval-notify`) and the step ids (`settle-window`,
 * `read-latest`, `send`) stay unchanged across a deploy — renaming any of
 * them strands in-flight approvals sleeping with no notification ever sent.
 */

import { formatAmount } from '@/lib/advance/format-amount';
import { pickApprovalKind, SETTLE_WINDOW_MS } from '@/lib/advance/settle-window';
import { prisma } from '@/lib/db/prisma';
import { inngest } from '../client';
import type { AdvanceApprovalDecidedEvent } from '../events';
import { sendNotification } from '../events';

export const advanceApprovalNotify = inngest.createFunction(
  {
    id: 'advance-approval-notify',
    retries: 3,
    triggers: [{ event: 'advance.approval-decided' }],
  },
  async ({ event, step }) => {
    const { cashAdvanceId, recipientUserId } = event.data as AdvanceApprovalDecidedEvent['data'];

    await step.sleep('settle-window', SETTLE_WINDOW_MS);

    // `findUnique` is NOT covered by the soft-delete Prisma extension (it
    // only wraps findFirst/findMany/count/aggregate — see
    // soft-delete-extension.ts), so a voided advance would still come back
    // here with status: 'Approved' (void only sets deletedAt, it never
    // touches status). deletedAt is selected explicitly and threaded through
    // pickApprovalKind rather than filtered in the `where` so the "voided
    // meanwhile" decision lives in one testable place alongside the rest of
    // the settle-window logic.
    const advance = await step.run('read-latest', () =>
      prisma.cashAdvance.findUnique({
        where: { id: cashAdvanceId },
        select: {
          status: true,
          deletedAt: true,
          approvedAt: true,
          paidAt: true,
          amount: true,
          employee: { select: { firstName: true } },
        },
      }),
    );
    if (!advance) return { sent: false, reason: 'not-found' };

    // Inngest serializes step.run's return value to JSON (and back on
    // replay), so date fields arrive here as ISO strings, not Dates —
    // rehydrate before handing them to pickApprovalKind.
    const deletedAt = advance.deletedAt ? new Date(advance.deletedAt) : null;
    const approvedAt = advance.approvedAt ? new Date(advance.approvedAt) : null;
    const paidAt = advance.paidAt ? new Date(advance.paidAt) : null;
    const kind = pickApprovalKind({ status: advance.status, deletedAt, approvedAt, paidAt });
    if (!kind) return { sent: false, reason: 'no-longer-approved' };

    await step.run('send', () =>
      sendNotification(recipientUserId, {
        kind,
        cashAdvanceId,
        employeeFirstName: advance.employee.firstName,
        amount: formatAmount(advance.amount),
      }),
    );
    return { sent: true, kind };
  },
);
