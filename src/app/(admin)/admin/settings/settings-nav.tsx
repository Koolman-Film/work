'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  Calculator,
  CalendarDays,
  CalendarOff,
  Clock,
  FolderTree,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Vertical side-tab nav for the Settings cluster.
 *
 * Per docs/v1/screens/admin.md:740-762 — settings has its own sub-nav, the
 * sidebar entry points just to /admin/settings. Subsections like
 * /admin/settings/branches inherit this nav.
 *
 * Active detection: prefix match on the section path.
 */

type SettingsTab = {
  href: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  enabled?: boolean;
};

const TABS: ReadonlyArray<SettingsTab> = [
  {
    href: '/admin/settings/branches',
    label: 'สาขา',
    description: 'ตำแหน่ง + geofence',
    Icon: Building2,
    enabled: true,
  },
  {
    href: '/admin/settings/departments',
    label: 'แผนก',
    description: 'จัดกลุ่มพนักงาน',
    Icon: FolderTree,
    enabled: true,
  },
  {
    href: '/admin/settings/accounting-groups',
    label: 'กลุ่มบัญชี',
    description: 'PEAK export grouping',
    Icon: Calculator,
    enabled: true,
  },
  {
    href: '/admin/settings/leave-types',
    label: 'ประเภทการลา',
    description: 'ลาป่วย / ลากิจ / ลาพักร้อน',
    Icon: CalendarOff,
    enabled: true,
  },
  {
    href: '/admin/settings/holidays',
    label: 'วันหยุด',
    description: 'วันหยุดราชการ + ชดเชย',
    Icon: CalendarDays,
    enabled: true,
  },
  {
    href: '/admin/settings/work-schedules',
    label: 'ตารางงาน',
    description: 'วันทำงาน + เวลาต่อวัน',
    Icon: Clock,
    enabled: true,
  },
  {
    href: '/admin/settings/team',
    label: 'ทีมผู้ดูแล',
    description: 'บัญชี Admin + Superadmin',
    Icon: ShieldCheck,
    enabled: true,
  },
  {
    href: '/admin/settings/roles',
    label: 'บทบาทและสิทธิ์',
    description: 'จัดการบทบาท + สิทธิ์การใช้งาน',
    Icon: KeyRound,
    enabled: true,
  },
  // ดีเฟอร์: Payroll config
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-0.5">
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Settings
      </p>
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        const Icon = tab.Icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-start gap-3 rounded-md px-3 py-2.5 transition',
              active
                ? 'bg-primary-50 text-primary-700 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-primary-600'
                : 'text-gray-700 hover:bg-gray-50',
            )}
          >
            <Icon
              size={18}
              strokeWidth={active ? 2.5 : 2}
              className={active ? 'mt-0.5 text-primary-600' : 'mt-0.5 text-gray-400'}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className={cn('text-sm', active && 'font-medium')}>{tab.label}</p>
              <p className="mt-0.5 truncate text-xs text-gray-500">{tab.description}</p>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
