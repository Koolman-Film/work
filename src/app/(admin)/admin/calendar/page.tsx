/**
 * /admin/calendar — full work calendar (ปฏิทินงาน).
 *
 * Hosts the full month grid + day-detail that previously sat at the bottom of
 * the dashboard. Same data + island (AdminCalendarCard) as before; the
 * dashboard now shows only a compact agenda that links here. Splitting it out
 * keeps the dashboard a short scan-and-triage snapshot.
 */

import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { getOrgCalendarData } from '@/lib/leave/team-calendar';
import { currentMonthYM, parseMonth } from '@/lib/leave/team-calendar-shape';
import { AdminCalendarCard } from '../_calendar/admin-calendar-card';

// Same caching posture as the dashboard: the initial month render can be up to
// 30s stale; month/branch switches go through the live server action.
export const revalidate = 30;

export default async function AdminCalendarPage() {
  await requirePermission('dashboard.read');

  const initialYm = currentMonthYM();
  const calMonth = parseMonth(initialYm);
  if (!calMonth) throw new Error('Could not parse current month — date system broken?');

  const [branches, initialData] = await Promise.all([
    prisma.branch.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    getOrgCalendarData({ monthStart: calMonth.start, monthEnd: calMonth.end }),
  ]);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ปฏิทินงาน" title="ปฏิทินงาน" subtitle="วันลาและวันหยุดของทุกสาขา" />
      <AdminCalendarCard branches={branches} initialYm={initialYm} initialData={initialData} />
    </div>
  );
}
