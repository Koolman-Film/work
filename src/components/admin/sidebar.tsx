'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  Calculator,
  Calendar,
  Clock,
  FileText,
  History,
  Home,
  Settings,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Admin sidebar nav.
 *
 * Item order matches docs/v1/screens/navigation.md:163-172 exactly. Items
 * whose pages don't exist yet are rendered disabled (gray + cursor-not-allowed)
 * with a "เร็วๆ นี้" tooltip — preserves the IA so admins see the full menu
 * shape from day one.
 *
 * Active-item detection: `/admin` matches exactly; everything else matches
 * by pathname prefix (so /admin/employees/new still highlights "พนักงาน").
 * Active items get a 2px primary-600 left accent rail per spec.
 */

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  enabled?: boolean;
};

const NAV: ReadonlyArray<NavItem> = [
  { href: '/admin', label: 'หน้าหลัก', Icon: Home, enabled: true },
  { href: '/admin/employees', label: 'พนักงาน', Icon: Users, enabled: true },
  { href: '/admin/leave', label: 'คำขอลา', Icon: Calendar, enabled: true }, // W4c
  { href: '/admin/advance', label: 'คำขอเบิก', Icon: Banknote }, // W4
  { href: '/admin/attendance', label: 'ลงเวลา', Icon: Clock, enabled: true }, // W3c-1: disputed inbox live; Live + Manual tabs pending
  { href: '/admin/payroll', label: 'เงินเดือน', Icon: FileText }, // Phase 2
  { href: '/admin/accounting', label: 'บัญชี', Icon: Calculator }, // Phase 3
  { href: '/admin/audit', label: 'Audit log', Icon: History }, // Phase 3
  { href: '/admin/settings', label: 'ตั้งค่า', Icon: Settings, enabled: true },
];

export function Sidebar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <aside className="hidden w-60 shrink-0 border-r border-gray-200 bg-white lg:block">
      <div className="sticky top-0 flex h-dvh flex-col">
        {/* Logo block */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <Link href="/admin" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-lg bg-primary-600 text-sm font-bold text-white shadow-brand">
              KM
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight text-gray-900">Koolman HR</p>
              <p className="text-xs text-gray-500">แผงควบคุมผู้ดูแล</p>
            </div>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-0.5">
            {NAV.map((item) => {
              const active = isActive(item.href);
              const disabled = !item.enabled;
              const Icon = item.Icon;

              if (disabled) {
                return (
                  <li key={item.href}>
                    <span
                      className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-gray-400"
                      title="เร็วๆ นี้"
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon size={18} strokeWidth={2} aria-hidden="true" />
                        <span>{item.label}</span>
                      </span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                        soon
                      </span>
                    </span>
                  </li>
                );
              }

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                      active
                        ? 'bg-primary-50 font-medium text-primary-700 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary-600'
                        : 'text-gray-700 hover:bg-gray-50',
                    )}
                  >
                    <Icon size={18} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer: brand mark only (sign-out moved to topbar dropdown) */}
        <div className="border-t border-gray-100 px-5 py-3">
          <p className="text-[11px] uppercase tracking-wider text-gray-400">Koolman HR · V1</p>
        </div>
      </div>
    </aside>
  );
}
