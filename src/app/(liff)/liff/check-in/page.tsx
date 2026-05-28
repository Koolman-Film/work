/**
 * /liff/check-in — the daily widget.
 *
 * Layout (per docs/v1/screens/employee.md — adapted for a check-in-focused
 * Phase-1 LIFF, not the full v1 dashboard):
 *   - Greeting + today's date in Thai Buddhist calendar
 *   - Today's status card (not checked in / checked in / checked out)
 *   - Big primary button: "เช็คอินเข้างาน" or "เช็คเอาท์"
 *
 * Server Component does the data fetch (employee profile + today's state +
 * the list of assigned branch names for context) and passes that to the
 * Client Component which owns the geolocation + button-state machinery.
 */

import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { toZonedTime } from 'date-fns-tz';
import { getCheckInState } from '@/lib/attendance/check-in';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import CheckInClient from './check-in-client';

export default async function LiffCheckInPage() {
  const { employee } = await requireRole(['Employee']);
  if (!employee) {
    throw new Error('requireRole did not return an Employee — should have notFound()');
  }

  const [state, branchInfo] = await Promise.all([
    getCheckInState(),
    prisma.branch.findMany({
      where: {
        id: { in: Array.from(new Set([employee.branchId, ...employee.assignedBranchIds])) },
        archivedAt: null,
      },
      select: { id: true, name: true, requireSelfie: true, requireCheckOut: true },
      orderBy: { name: 'asc' },
    }),
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

  // Format today's date in Thai Buddhist calendar. We do this server-side
  // (UTC offset Asia/Bangkok = +07:00) so the client never has to know.
  const bkkNow = toZonedTime(new Date(), 'Asia/Bangkok');
  // date-fns doesn't natively handle Thai Buddhist era; we format the
  // Gregorian date then swap the year. (Year 2026 → พ.ศ. 2569.)
  const gregYear = bkkNow.getFullYear();
  const thaiYear = gregYear + 543;
  const dateLine = format(bkkNow, 'EEEEที่ d MMMM', { locale: th }).replace(
    /\bMMMM\b/,
    '', // no-op fallback if pattern fails — defensive
  );

  return (
    <CheckInClient
      employeeFirstName={employee.firstName}
      employeeLastName={employee.lastName}
      branches={branchInfo.map((b) => ({ id: b.id, name: b.name }))}
      selfieRequired={selfieRequired}
      checkOutRequired={checkOutRequired}
      initialState={state}
      dateLine={`${dateLine} ${thaiYear}`}
    />
  );
}
