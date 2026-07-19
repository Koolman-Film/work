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

    const advance = await step.run('read-latest', () =>
      prisma.cashAdvance.findUnique({
        where: { id: cashAdvanceId },
        select: {
          status: true,
          paidAt: true,
          amount: true,
          employee: { select: { firstName: true } },
        },
      }),
    );
    if (!advance) return { sent: false, reason: 'not-found' };

    // Inngest serializes step.run's return value to JSON (and back on
    // replay), so `paidAt` arrives here as an ISO string, not a Date —
    // rehydrate before handing it to pickApprovalKind.
    const paidAt = advance.paidAt ? new Date(advance.paidAt) : null;
    const kind = pickApprovalKind({ status: advance.status, paidAt });
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
