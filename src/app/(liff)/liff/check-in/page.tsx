/**
 * /liff/check-in — the daily widget.
 *
 * Layout (per docs/v1/screens/employee.md — adapted for a check-in-focused
 * Phase-1 LIFF, not the full v1 dashboard):
 *   - Greeting + today's date in the active locale's calendar
 *   - Today's status card (not checked in / checked in / checked out)
 *   - Big primary button: "เช็คอินเข้างาน" or "เช็คเอาท์"
 *
 * Server Component does the data fetch (employee profile + today's state +
 * the list of assigned branch names for context) and passes that to the
 * Client Component which owns the geolocation + button-state machinery.
 */

import { toZonedTime } from 'date-fns-tz';
import { getLocale } from 'next-intl/server';
import { getCheckInState } from '@/lib/attendance/check-in';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import CheckInClient from './check-in-client';

export default async function LiffCheckInPage() {
  const { employee } = await requireRole(['Staff']);
  if (!employee) {
    throw new Error('requireRole did not return an Employee — should have notFound()');
  }

  const [state, branchInfo, locale] = await Promise.all([
    getCheckInState(),
    prisma.branch.findMany({
      where: {
        id: { in: Array.from(new Set([employee.branchId, ...employee.assignedBranchIds])) },
        archivedAt: null,
      },
      select: { id: true, name: true, requireSelfie: true, requireCheckOut: true },
      orderBy: { name: 'asc' },
    }),
    getLocale(),
  ]);

  // Selfie required when ANY of the employee's assigned branches has
  // requireSelfie=true. Same rule the server enforces at submitCheckIn
  // time — keeps client + server in agreement on the gate. See
  // src/lib/attendance/check-in.ts for the server-side check.
  const selfieRequired = branchInfo.some((b) => b.requireSelfie);

  // Check-out prompt required when ANY assigned branch enables it. Same
  // "minimum bar across the assignment" rule as selfie: a multi-branch
  // employee who belongs to even one strict branch sees the prompt. The
  // server-side `submitCheckOut` action stays unconditional — this flag
  // only controls the LIFF UX (button prominence). Force-checkout cron
  // is unaffected.
  const checkOutRequired = branchInfo.some((b) => b.requireCheckOut);

  // Format today's date using the active locale. formatDate handles the
  // Thai Buddhist year conversion for the 'th' locale and uses
  // Intl.DateTimeFormat for all others (Asia/Bangkok time zone).
  const bkkNow = toZonedTime(new Date(), 'Asia/Bangkok');
  const dateLine = formatDate(bkkNow, locale as Locale);

  return (
    <CheckInClient
      employeeFirstName={employee.firstName}
      employeeLastName={employee.lastName}
      branches={branchInfo.map((b) => ({ id: b.id, name: b.name }))}
      selfieRequired={selfieRequired}
      checkOutRequired={checkOutRequired}
      initialState={state}
      dateLine={dateLine}
    />
  );
}
