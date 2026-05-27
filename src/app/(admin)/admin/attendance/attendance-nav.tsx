'use client';

import type { LucideIcon } from 'lucide-react';
import { Activity, AlertTriangle, ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Vertical side-tab nav for the Attendance cluster.
 *
 * Same shape as SettingsNav (intentional — visual consistency lets admins
 * navigate by muscle memory). Tabs:
 *   - Live   → today's check-ins, real-time
 *   - Disputed → review inbox
 *   - Manual entry → admin can add Absent/Late/EarlyLeave manually
 *
 * Only "Disputed" is enabled in W3c-1; Live + Manual land in later passes.
 */

type AttTab = {
  href: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  enabled?: boolean;
};

const TABS: ReadonlyArray<AttTab> = [
  {
    href: '/admin/attendance/disputed',
    label: 'ตรวจสอบ',
    description: 'รายการที่ต้องตัดสินใจ',
    Icon: AlertTriangle,
    enabled: true,
  },
  {
    href: '/admin/attendance/live',
    label: 'ลงเวลาวันนี้',
    description: 'แผงเรียลไทม์',
    Icon: Activity,
  },
  {
    href: '/admin/attendance/manual',
    label: 'บันทึกย้อนหลัง',
    description: 'เพิ่มขาด/ลา/สาย ด้วยตนเอง',
    Icon: ClipboardList,
  },
];

export function AttendanceNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-0.5">
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Attendance
      </p>
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        const Icon = tab.Icon;
        const disabled = !tab.enabled;

        if (disabled) {
          return (
            <div
              key={tab.href}
              aria-disabled="true"
              className="flex items-start gap-3 rounded-md px-3 py-2.5 text-gray-400"
            >
              <Icon size={18} strokeWidth={2} className="mt-0.5 text-gray-300" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm">
                  {tab.label}{' '}
                  <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-px text-[10px] font-medium text-gray-500">
                    soon
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-400">{tab.description}</p>
              </div>
            </div>
          );
        }

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-start gap-3 rounded-md px-3 py-2.5 transition',
              active
                ? 'bg-primary-50 text-primary-700 before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary-600'
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
