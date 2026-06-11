'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  BarChart3,
  Calculator,
  CalendarDays,
  CalendarOff,
  Clock,
  FileText,
  History,
  Home,
  Settings,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useMobileNav } from './use-mobile-nav';

/**
 * Admin sidebar nav (Sapphire Editorial).
 *
 * Two display modes from the same component:
 *   - **Desktop (≥lg)**: a floating rounded card on the canvas (sticky, layered
 *     shadow, hairline border) — matching the mockups.
 *   - **Mobile (<lg)**: hidden by default; slides in from the left as a drawer
 *     when `useMobileNav.open === true` (hamburger in the Topbar). Backdrop +
 *     close button + Escape + scroll-lock + auto-close-on-navigation.
 *
 * Items are grouped by admin workflow: ภาพรวม (views), งานประจำวัน (daily
 * action queues — these carry pending-count badges), ข้อมูล & รายงาน,
 * การเงิน (placeholder domain), ระบบ. Items whose pages don't exist yet
 * render disabled (gray + "เร็วๆ นี้") to preserve the IA. Active item
 * gets a primary-50 fill + a 2px brand left-accent rail.
 */

/** Pending-work counts fetched by the admin layout (server side). */
export type SidebarBadges = {
  /** LeaveRequest rows with status=Pending. */
  leave: number;
  /** CashAdvance rows with status=Pending. */
  advance: number;
  /** Attendance check-ins with checkInStatus=Disputed. */
  attendance: number;
};

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  enabled?: boolean;
  /** Which badge count (if any) to show next to this item. */
  badgeKey?: keyof SidebarBadges;
};

const SECTIONS: ReadonlyArray<{ label: string; items: ReadonlyArray<NavItem> }> = [
  {
    label: 'ภาพรวม',
    items: [
      { href: '/admin', label: 'หน้าหลัก', Icon: Home, enabled: true },
      { href: '/admin/calendar', label: 'ปฏิทินงาน', Icon: CalendarDays, enabled: true },
    ],
  },
  {
    label: 'งานประจำวัน',
    items: [
      {
        href: '/admin/attendance',
        label: 'ลงเวลา',
        Icon: Clock,
        enabled: true,
        badgeKey: 'attendance',
      },
      {
        href: '/admin/leave',
        label: 'คำขอลา',
        Icon: CalendarOff,
        enabled: true,
        badgeKey: 'leave',
      },
      {
        href: '/admin/advance',
        label: 'คำขอเบิก',
        Icon: Banknote,
        enabled: true,
        badgeKey: 'advance',
      },
    ],
  },
  {
    label: 'ข้อมูล & รายงาน',
    items: [
      { href: '/admin/employees', label: 'พนักงาน', Icon: Users, enabled: true },
      { href: '/admin/reports', label: 'รายงาน', Icon: BarChart3, enabled: true },
    ],
  },
  {
    label: 'การเงิน',
    items: [
      { href: '/admin/payroll', label: 'เงินเดือน', Icon: FileText },
      { href: '/admin/accounting', label: 'บัญชี', Icon: Calculator },
    ],
  },
  {
    label: 'ระบบ',
    items: [
      { href: '/admin/settings', label: 'ตั้งค่า', Icon: Settings, enabled: true },
      { href: '/admin/audit', label: 'Audit log', Icon: History },
    ],
  },
];

export function Sidebar({ badges }: { badges: SidebarBadges }) {
  const pathname = usePathname();
  const open = useMobileNav((s) => s.open);
  const close = useMobileNav((s) => s.close);

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  // Auto-close on route change (tapping a drawer link shouldn't leave it open).
  // biome-ignore lint/correctness/useExhaustiveDependencies: close is stable from zustand
  useEffect(() => {
    if (open) close();
  }, [pathname]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Lock body scroll while the drawer is open (mobile only).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {/* Backdrop — mobile-only, fades in when drawer opens. */}
      <div
        aria-hidden="true"
        onClick={close}
        className={cn(
          'fixed inset-0 z-30 bg-ink-1/40 transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* One element, two layouts: fixed drawer on mobile, floating card on desktop. */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-60 bg-white transition-transform duration-200',
          // Mobile: slide in/out
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full',
          // Desktop: floating rounded card on the canvas, sticky
          'lg:sticky lg:top-4 lg:m-4 lg:h-[calc(100dvh-2rem)] lg:translate-x-0 lg:rounded-2xl lg:border lg:border-[var(--border-color)] lg:shadow-card',
        )}
        aria-label="แผงควบคุมผู้ดูแล"
      >
        <div className="flex h-full flex-col">
          {/* Logo block */}
          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <Link href="/admin" className="flex items-center gap-2.5">
              <span
                className="grid size-10 place-items-center rounded-xl text-white shadow-cta"
                style={{
                  background:
                    'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-800))',
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 7l9-4 9 4-9 4-9-4z" />
                  <path d="M3 12l9 4 9-4" />
                  <path d="M3 17l9 4 9-4" />
                </svg>
              </span>
              <span>
                <span className="block font-display text-base font-extrabold leading-none tracking-tight text-ink-1">
                  Koolman
                </span>
                <span className="mt-1 block font-display text-[10px] font-semibold tracking-[0.08em] text-ink-3">
                  WORK · ADMIN
                </span>
              </span>
            </Link>

            {/* Close button — mobile-only. */}
            <button
              type="button"
              onClick={close}
              aria-label="ปิดเมนู"
              className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-gray-100 hover:text-ink-1 lg:hidden"
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          {/* Nav (grouped sections) */}
          <nav className="flex-1 overflow-y-auto px-3 pb-4">
            {SECTIONS.map((section) => (
              <div key={section.label} className="mb-1">
                <p className="px-2 pb-1.5 pt-3 font-display text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink-4">
                  {section.label}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = isActive(item.href);
                    const Icon = item.Icon;
                    const count = item.badgeKey ? badges[item.badgeKey] : 0;

                    if (!item.enabled) {
                      return (
                        <li key={item.href}>
                          <span
                            className="flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-sm text-ink-5"
                            title="เร็วๆ นี้"
                          >
                            <span className="flex items-center gap-2.5">
                              <Icon size={18} strokeWidth={2} aria-hidden="true" />
                              <span>{item.label}</span>
                            </span>
                            <span className="font-display text-[9.5px] font-semibold text-ink-4">
                              เร็วๆ นี้
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
                            'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
                            active
                              ? 'bg-primary-50 font-medium text-primary-700 before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-full before:bg-primary-600'
                              : 'text-ink-2 hover:bg-gray-50',
                          )}
                        >
                          <Icon size={18} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
                          <span className="flex-1">{item.label}</span>
                          {count > 0 && (
                            <span className="rounded-full bg-primary-600 px-1.5 py-0.5 font-display text-[10px] font-bold leading-none text-white">
                              {count > 99 ? '99+' : count}
                              <span className="sr-only"> รายการรอดำเนินการ</span>
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {/* Footer brand mark (the functional user menu lives in the Topbar). */}
          <div className="border-t border-gray-100 px-4 py-3">
            <p className="font-display text-[11px] uppercase tracking-wider text-ink-4">
              Koolman Work · V1
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
