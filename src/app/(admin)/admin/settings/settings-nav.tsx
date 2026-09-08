'use client';

import type { Role } from '@prisma/client';
import type { LucideIcon } from 'lucide-react';
import {
  AlarmClock,
  Banknote,
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
import type { Permission } from '@/lib/auth/permissions';
import { cn } from '@/lib/utils';
import { canSeeSettingsItem } from './settings-nav-visibility';

/** `permission: null` = self-service entry, gated on Admin tier — see canSeeSettingsItem. */
type Item = {
  href: string;
  label: string;
  desc: string;
  Icon: LucideIcon;
  permission: Permission | null;
};

const ITEMS: Item[] = [
  {
    href: '/admin/settings/branches',
    label: 'สาขา',
    desc: 'ตำแหน่ง + geofence',
    Icon: Building2,
    permission: 'settings.branch.manage',
  },
  {
    href: '/admin/settings/departments',
    label: 'แผนก',
    desc: 'จัดกลุ่มพนักงาน',
    Icon: FolderTree,
    permission: 'settings.department.manage',
  },
  {
    href: '/admin/settings/accounting-groups',
    label: 'กลุ่มบัญชี',
    desc: 'PEAK export',
    Icon: Calculator,
    permission: 'settings.accounting-group.manage',
  },
  {
    href: '/admin/settings/leave-types',
    label: 'ประเภทการลา',
    desc: 'ลาป่วย / ลากิจ',
    Icon: CalendarOff,
    permission: 'settings.leave-type.manage',
  },
  {
    href: '/admin/settings/leave-config',
    label: 'ตั้งค่าการลา',
    desc: 'ครึ่งวัน / รายชั่วโมง',
    Icon: Hourglass,
    permission: 'settings.leave-config.manage',
  },
  {
    href: '/admin/settings/holidays',
    label: 'วันหยุด',
    desc: 'ราชการ + ชดเชย',
    Icon: CalendarDays,
    permission: 'settings.holiday.manage',
  },
  {
    href: '/admin/settings/work-schedules',
    label: 'ตารางงาน',
    desc: 'วันทำงาน + เวลา',
    Icon: Clock,
    permission: 'settings.work-schedule.manage',
  },
  {
    href: '/admin/settings/attendance',
    label: 'การมาสาย & รอบจ่าย',
    desc: 'เวลาเข้างาน + วันตัดรอบ',
    Icon: AlarmClock,
    permission: 'settings.attendance.manage',
  },
  {
    href: '/admin/settings/payroll',
    label: 'เงินเดือน',
    desc: 'ประกันสังคม / OT / หักเงิน',
    Icon: Banknote,
    permission: 'settings.payroll.manage',
  },
  {
    href: '/admin/settings/team',
    label: 'ทีมผู้ดูแล',
    desc: 'Admin + Superadmin',
    Icon: ShieldCheck,
    permission: 'team.read',
  },
  {
    href: '/admin/settings/roles',
    label: 'บทบาทและสิทธิ์',
    desc: 'สิทธิ์การเข้าถึง',
    Icon: KeyRound,
    permission: 'role.read',
  },
  // Admin LINE link temporarily disabled — see ADMIN_LINE_LINK_ENABLED.
  // Self-service: the page gates on Admin tier, so the link must too. It used
  // to require `team.read`, which the `admin` role deliberately does NOT carry
  // (admins are intentionally kept out of team management) — so the entry was
  // invisible to every non-superadmin admin. Don't re-gate this on a team.*
  // permission; grant nothing, gate on tier.
  ...(ADMIN_LINE_LINK_ENABLED
    ? [
        {
          href: '/admin/settings/line',
          label: 'LINE',
          desc: 'เชื่อมบัญชีแอดมิน',
          Icon: MessageCircle,
          permission: null,
        },
      ]
    : []),
];

/**
 * Settings sub-nav. Vertical side-tab list on lg+ (icon + label + description,
 * with a section header and active accent bar), collapsing to a horizontally-
 * scrollable pill strip below lg so it stays usable on phones.
 */
export function SettingsNav({
  allowedPermissions,
  tier,
}: {
  allowedPermissions: Permission[];
  tier: Role | null;
}) {
  const allowed = new Set(allowedPermissions);
  const visible = ITEMS.filter((i) => canSeeSettingsItem(i, allowed, tier));
  const pathname = usePathname();
  return (
    <nav
      aria-label="หมวดตั้งค่า"
      className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0"
    >
      <p className="hidden px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-4 lg:block">
        ตั้งค่า
      </p>
      {visible.map(({ href, label, desc, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition lg:items-start lg:gap-3 lg:py-2.5',
              active
                ? 'bg-primary-50 font-medium text-primary-700 lg:before:absolute lg:before:bottom-2 lg:before:left-0 lg:before:top-2 lg:before:w-0.5 lg:before:rounded-full lg:before:bg-brand-solid'
                : 'text-ink-3 hover:bg-surface-hover hover:text-ink-1',
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
