'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

type Item = { href: string; label: string; desc: string; icon: string };

const ITEMS: Item[] = [
  { href: '/admin/settings/branches', label: 'สาขา', desc: 'ตำแหน่ง + geofence', icon: '🏢' },
  { href: '/admin/settings/departments', label: 'แผนก', desc: 'จัดกลุ่มพนักงาน', icon: '🗂️' },
  { href: '/admin/settings/accounting-groups', label: 'กลุ่มบัญชี', desc: 'PEAK export', icon: '🧮' },
  { href: '/admin/settings/leave-types', label: 'ประเภทการลา', desc: 'ลาป่วย / ลากิจ', icon: '📅' },
  { href: '/admin/settings/holidays', label: 'วันหยุด', desc: 'ราชการ + ชดเชย', icon: '🎌' },
  { href: '/admin/settings/work-schedules', label: 'ตารางงาน', desc: 'วันทำงาน + เวลา', icon: '🕐' },
  { href: '/admin/settings/team', label: 'ทีมผู้ดูแล', desc: 'Admin + Superadmin', icon: '🛡️' },
  { href: '/admin/settings/roles', label: 'บทบาทและสิทธิ์', desc: 'สิทธิ์การเข้าถึง', icon: '🔑' },
];

/**
 * Settings sub-nav. Vertical sidebar on lg+, a horizontally-scrollable pill
 * strip below lg so it stays usable on phones.
 */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="หมวดตั้งค่า"
      className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0"
    >
      {ITEMS.map((it) => {
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
              active
                ? 'bg-primary-50 font-medium text-primary-700 lg:before:absolute lg:before:bottom-2 lg:before:left-0 lg:before:top-2 lg:before:w-0.5 lg:before:rounded-full lg:before:bg-primary-600'
                : 'text-ink-3 hover:bg-gray-50 hover:text-ink-1',
            )}
          >
            <span className="text-base leading-none" aria-hidden="true">
              {it.icon}
            </span>
            <span className="min-w-0">
              <span className="block whitespace-nowrap">{it.label}</span>
              <span className="hidden truncate text-[11px] text-ink-4 lg:block">{it.desc}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
