/**
 * /liff/leave/new — submit a new leave request.
 *
 * Server Component fetches the LeaveType options + today's date for the
 * `min` attribute, then renders the Client form which owns the
 * date-range UX + working-day count preview.
 */

import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { remainingByTypeForEmployee } from '@/lib/leave/balance';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { localizedLeaveTypeName } from '@/lib/leave/localized-name';
import { perMinuteRate } from '@/lib/leave/over-quota';
import { standardDayMinutes } from '@/lib/leave/units';
import { LeaveNewForm } from './leave-new-form';

export default async function NewLeavePage() {
  const { employee } = await requireRole(['Staff']);

  const [rawLeaveTypes, leaveConfig, locale, payCfg] = await Promise.all([
    prisma.leaveType.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        nameByLocale: true,
        isPaid: true,
        annualQuota: true,
        allowFullDay: true,
        allowHalfDay: true,
        allowHourly: true,
        overQuotaPolicy: true,
      },
    }),
    getLeaveConfig(),
    getLocale() as Promise<Locale>,
    prisma.payrollConfig.findFirstOrThrow({ select: { workingDaysPerMonth: true } }),
  ]);

  // Resolve display names to the viewer's locale here so the client form
  // stays a dumb renderer (its option labels are already final strings).
  const leaveTypes = rawLeaveTypes.map(({ nameByLocale, ...lt }) => ({
    ...lt,
    name: localizedLeaveTypeName(lt.name, nameByLocale, locale),
  }));

  // Per-minute deduction rate for over-quota preview. Falls back to 0 when
  // employee row is missing (edge case: Superadmin viewing the page).
  const ratePerMinute = employee
    ? perMinuteRate(
        employee.salaryType,
        Number(employee.baseSalary),
        payCfg.workingDaysPerMonth,
        standardDayMinutes(leaveConfig),
      )
    : 0;

  if (leaveTypes.length === 0) {
    // Defensive: if admin hasn't seeded any LeaveType yet, send the
    // employee back to the list with a hint rather than rendering a
    // form with an empty select.
    redirect('/liff/leave?error=no-leave-types');
  }

  // Today's date in YYYY-MM-DD (Bangkok). `todayYmd` seeds the form's default
  // dates; `minDate` is 7 days earlier so workers can back-file recent leave
  // (must stay in sync with MAX_BACKDATE_DAYS in ./actions.ts).
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const minDate = new Date(`${todayYmd}T00:00:00.000Z`);
  minDate.setUTCDate(minDate.getUTCDate() - 7);
  const minDateYmd = minDate.toISOString().slice(0, 10);
  const currentYear = Number(todayYmd.slice(0, 4));

  // Remaining balance per leave type for the current year (read-only; falls
  // back to the type's annualQuota default when no entitlement row exists).
  const remainingByType = employee
    ? await remainingByTypeForEmployee(employee.id, currentYear)
    : {};

  return (
    <LeaveNewForm
      leaveTypes={leaveTypes}
      minDate={minDateYmd}
      defaultDate={todayYmd}
      leaveConfig={leaveConfig}
      remainingByType={remainingByType}
      ratePerMinute={ratePerMinute}
    />
  );
}
