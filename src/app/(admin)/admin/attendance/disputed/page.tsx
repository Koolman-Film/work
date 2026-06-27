/**
 * /admin/attendance/disputed — review inbox for Disputed check-ins.
 *
 * Master-detail: a scrollable list (left) + a detail pane (right) with the
 * selfie, a Leaflet map of the check-in position vs the branch geofence, the
 * computed distance, the system reason, and Approve/Reject. Read-only fetch is
 * a Server Component; the interactive surface is the DisputedClient.
 */

import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { signAttendancePhotoUrls } from '@/lib/storage/signed-urls';
import { AttendanceTabs } from '../attendance-tabs';
import { DisputedClient, type DisputedVM } from './disputed-client';

function formatBkk(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  });
}

/** Great-circle distance in metres (rounded). */
function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export default async function DisputedInboxPage() {
  await requirePermission('attendance.read');
  const rows = await prisma.attendance.findMany({
    where: { type: 'CheckIn', checkInStatus: { in: ['Disputed'] } },
    orderBy: { clockInAt: 'desc' },
    take: 50,
    select: {
      id: true,
      clockInAt: true,
      checkInLat: true,
      checkInLng: true,
      disputeReason: true,
      checkInSelfieUrl: true,
      checkInBranch: {
        select: { name: true, latitude: true, longitude: true, radiusMeters: true },
      },
      employee: {
        select: {
          firstName: true,
          lastName: true,
          nickname: true,
          branch: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
  });

  const selfieKeys = rows
    .map((r) => r.checkInSelfieUrl)
    .filter((k): k is string => !!k && k.length > 0);
  const signedSelfieUrls = await signAttendancePhotoUrls(selfieKeys);

  const vm: DisputedVM[] = rows.map((r) => {
    const empLat = r.checkInLat != null ? Number(r.checkInLat) : null;
    const empLng = r.checkInLng != null ? Number(r.checkInLng) : null;
    const branch =
      r.checkInBranch?.latitude != null && r.checkInBranch.longitude != null
        ? {
            name: r.checkInBranch.name,
            lat: Number(r.checkInBranch.latitude),
            lng: Number(r.checkInBranch.longitude),
            radiusMeters: r.checkInBranch.radiusMeters,
          }
        : null;
    const distanceMeters =
      empLat != null && empLng != null && branch
        ? haversineMeters(empLat, empLng, branch.lat, branch.lng)
        : null;
    return {
      id: r.id,
      name: `${r.employee.firstName} ${r.employee.lastName}`,
      nickname: r.employee.nickname,
      branchLabel: `${r.employee.branch.name}${r.employee.department ? ` • ${r.employee.department.name}` : ''}`,
      clockInLabel: r.clockInAt ? formatBkk(r.clockInAt) : '—',
      reason: r.disputeReason ?? 'ไม่ระบุ',
      selfieUrl: r.checkInSelfieUrl ? (signedSelfieUrls.get(r.checkInSelfieUrl) ?? null) : null,
      empLat,
      empLng,
      branch,
      distanceMeters,
    };
  });

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ลงเวลา"
        title="ต้องตรวจสอบ"
        subtitle="เช็คอินที่อยู่นอกรัศมีสาขา — ตรวจหลักฐาน (เซลฟี่ + ตำแหน่ง) แล้วอนุมัติหรือปฏิเสธ"
      />
      <AttendanceTabs current="disputed" disputedCount={vm.length} />

      {vm.length === 0 ? (
        <div className="surface">
          <EmptyState
            title="ไม่มีรายการที่ต้องตรวจสอบ ✨"
            hint="การเช็คอินทั้งหมดผ่านการตรวจอัตโนมัติ — ไม่มีอะไรต้องตัดสินใจ"
          />
        </div>
      ) : (
        <DisputedClient rows={vm} />
      )}
    </div>
  );
}
