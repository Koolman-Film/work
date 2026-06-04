/**
 * /admin/settings — entity hub. A card grid of every settings entity with a
 * live count, a "จัดการ" link, and a quick "+ เพิ่ม". Replaces the old
 * redirect-to-branches; pairs with the pass-through layout (each entity page
 * owns its own PageHeader + breadcrumb back here).
 */

import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { prisma } from '@/lib/db/prisma';

type Entity = { key: string; href: string; label: string; desc: string; icon: string };

const ENTITIES: Entity[] = [
  {
    key: 'branches',
    href: '/admin/settings/branches',
    label: 'สาขา',
    desc: 'ตำแหน่ง + geofence',
    icon: '🏢',
  },
  {
    key: 'departments',
    href: '/admin/settings/departments',
    label: 'แผนก',
    desc: 'จัดกลุ่มพนักงานตามหน้าที่',
    icon: '🗂️',
  },
  {
    key: 'accounting-groups',
    href: '/admin/settings/accounting-groups',
    label: 'กลุ่มบัญชี',
    desc: 'จัดกลุ่มสำหรับ PEAK export',
    icon: '🧮',
  },
  {
    key: 'leave-types',
    href: '/admin/settings/leave-types',
    label: 'ประเภทการลา',
    desc: 'ลาป่วย / ลากิจ / ลาพักร้อน',
    icon: '📅',
  },
  {
    key: 'holidays',
    href: '/admin/settings/holidays',
    label: 'วันหยุด',
    desc: 'วันหยุดราชการ + ชดเชย',
    icon: '🎌',
  },
  {
    key: 'work-schedules',
    href: '/admin/settings/work-schedules',
    label: 'ตารางงาน',
    desc: 'วันทำงาน + เวลาต่อวัน',
    icon: '🕐',
  },
  {
    key: 'team',
    href: '/admin/settings/team',
    label: 'ทีมผู้ดูแล',
    desc: 'บัญชี Admin + Superadmin',
    icon: '🛡️',
  },
  {
    key: 'roles',
    href: '/admin/settings/roles',
    label: 'บทบาทและสิทธิ์',
    desc: 'กำหนดสิทธิ์การเข้าถึงระบบ',
    icon: '🔑',
  },
];

export default async function SettingsHubPage() {
  const [branches, departments, accountingGroups, leaveTypes, holidays, workSchedules, roles] =
    await Promise.all([
      prisma.branch.count({ where: { archivedAt: null } }),
      prisma.department.count({ where: { archivedAt: null } }),
      prisma.accountingGroup.count({ where: { archivedAt: null } }),
      prisma.leaveType.count({ where: { archivedAt: null } }),
      prisma.holiday.count({ where: { archivedAt: null } }),
      prisma.workSchedule.count({ where: { archivedAt: null } }),
      prisma.roleDefinition.count({ where: { archivedAt: null } }),
    ]);

  const counts: Record<string, number | null> = {
    branches,
    departments,
    'accounting-groups': accountingGroups,
    'leave-types': leaveTypes,
    holidays,
    'work-schedules': workSchedules,
    roles,
    team: null, // team membership count is permission-derived; omit here
  };

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="ตั้งค่า"
        subtitle="สาขา / แผนก / กลุ่มบัญชี และค่ากำหนดต่างๆ ของระบบ"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ENTITIES.map((e) => {
          const count = counts[e.key];
          return (
            <div key={e.key} className="surface flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink-1">
                    <span className="text-lg" aria-hidden="true">
                      {e.icon}
                    </span>
                    {e.label}
                  </p>
                  <p className="mt-1 text-xs text-ink-3">{e.desc}</p>
                </div>
                {count != null && (
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-2">
                    {count}
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                <Link
                  href={e.href}
                  className="text-xs font-semibold text-primary-700 hover:text-primary-800"
                >
                  จัดการ →
                </Link>
                <Link
                  href={`${e.href}/new`}
                  className="text-xs font-medium text-ink-3 hover:text-ink-1"
                >
                  + เพิ่ม
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
