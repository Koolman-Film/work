/**
 * /admin/attendance/live — today's check-in board.
 *
 * Server Component does the initial fetch (useful before client JS / Realtime
 * connects); the Client child subscribes to Supabase Realtime + 30s polling.
 * Reads `?filter=` so the dashboard KPIs can deep-link into a specific list.
 */

import { PageHeader } from '@/components/ui/page-header';
import { getTodayAttendance } from '@/lib/attendance/live';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { AttendanceTabs } from '../attendance-tabs';
import { parseFilter } from './filter';
import { LiveBoardClient } from './live-client';

export default async function LiveBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requirePermission('attendance.live-board');
  const [{ filter }, [initial, disputedCount]] = await Promise.all([
    searchParams,
    Promise.all([
      getTodayAttendance(),
      prisma.attendance.count({
        where: { type: 'CheckIn', checkInStatus: 'Disputed', deletedAt: null },
      }),
    ]),
  ]);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ลงเวลา"
        title="การลงเวลาสด"
        subtitle="อัปเดตอัตโนมัติทุก 30 วินาที — เรียลไทม์ผ่าน Supabase channel"
      />
      <AttendanceTabs current="live" disputedCount={disputedCount} />
      <LiveBoardClient initial={initial} initialFilter={parseFilter(filter)} />
    </div>
  );
}
