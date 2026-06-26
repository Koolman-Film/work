'use client';

import type { LucideIcon } from 'lucide-react';
import {
  AlarmClock,
  Building2,
  Calculator,
  CalendarDays,
  CalendarOff,
  Clock,
  FolderTree,
  Hourglass,
  KeyRound,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_LINE_LINK_ENABLED } from '@/lib/auth/admin-line-feature';
import { cn } from '@/lib/utils';

type Item = { href: string; label: string; desc: string; Icon: LucideIcon };

const ITEMS: Item[] = [
  { href: '/admin/settings/branches', label: 'สาขา', desc: 'ตำแหน่ง + geofence', Icon: Building2 },
  { href: '/admin/settings/departments', label: 'แผนก', desc: 'จัดกลุ่มพนักงาน', Icon: FolderTree },
  {
    href: '/admin/settings/accounting-groups',
    label: 'กลุ่มบัญชี',
    desc: 'PEAK export',
    Icon: Calculator,
  },
  {
    href: '/admin/settings/leave-types',
    label: 'ประเภทการลา',
    desc: 'ลาป่วย / ลากิจ',
    Icon: CalendarOff,
  },
  {
    href: '/admin/settings/leave-config',
    label: 'ตั้งค่าการลา',
    desc: 'ครึ่งวัน / รายชั่วโมง',
    Icon: Hourglass,
  },
  { href: '/admin/settings/holidays', label: 'วันหยุด', desc: 'ราชการ + ชดเชย', Icon: CalendarDays },
  {
    href: '/admin/settings/work-schedules',
    label: 'ตารางงาน',
    desc: 'วันทำงาน + เวลา',
    Icon: Clock,
  },
  {
    href: '/admin/settings/attendance',
    label: 'การมาสาย & รอบจ่าย',
    desc: 'เวลาเข้างาน + วันตัดรอบ',
    Icon: AlarmClock,
  },
  { href: '/admin/settings/team', label: 'ทีมผู้ดูแล', desc: 'Admin + Superadmin', Icon: ShieldCheck },
  { href: '/admin/settings/roles', label: 'บทบาทและสิทธิ์', desc: 'สิทธิ์การเข้าถึง', Icon: KeyRound },
  // Admin LINE link temporarily disabled — see ADMIN_LINE_LINK_ENABLED.
  ...(ADMIN_LINE_LINK_ENABLED
    ? [{ href: '/admin/settings/line', label: 'LINE', desc: 'เชื่อมบัญชีแอดมิน', Icon: MessageCircle }]
    : []),
];

/**
 * Settings sub-nav. Vertical side-tab list on lg+ (icon + label + description,
 * with a section header and active accent bar), collapsing to a horizontally-
 * scrollable pill strip below lg so it stays usable on phones.
 */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="หมวดตั้งค่า"
      className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0"
    >
      <p className="hidden px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-4 lg:block">
        ตั้งค่า
      </p>
      {ITEMS.map(({ href, label, desc, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition lg:items-start lg:gap-3 lg:py-2.5',
              active
                ? 'bg-primary-50 font-medium text-primary-700 lg:before:absolute lg:before:bottom-2 lg:before:left-0 lg:before:top-2 lg:before:w-0.5 lg:before:rounded-full lg:before:bg-primary-600'
                : 'text-ink-3 hover:bg-gray-50 hover:text-ink-1',
            )}
          >
            <Icon
              size={18}
              strokeWidth={active ? 2.5 : 2}
              className={cn('shrink-0 lg:mt-0.5', active ? 'text-primary-600' : 'text-ink-4')}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span className="block whitespace-nowrap">{label}</span>
              <span className="mt-0.5 hidden truncate text-[11px] text-ink-4 lg:block">{desc}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
