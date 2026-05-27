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
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useMobileNav } from './use-mobile-nav';

/**
 * Admin sidebar nav.
 *
 * Two display modes from the same component:
 *   - **Desktop (≥lg)**: always visible, static side rail (`lg:block`).
 *   - **Mobile (<lg)**: hidden by default; slides in from the left as a
 *     drawer when `useMobileNav.open === true` (triggered by the
 *     hamburger button in the Topbar). Backdrop + close button +
 *     Escape-key + auto-close-on-navigation.
 *
 * Item order matches docs/v1/screens/navigation.md:163-172 exactly.
 * Items whose pages don't exist yet are rendered disabled (gray +
 * cursor-not-allowed) with a "เร็วๆ นี้" pill — preserves the IA so
 * admins see the full menu shape from day one.
 *
 * Active-item detection: `/admin` matches exactly; everything else
 * matches by pathname prefix (so /admin/employees/new still highlights
 * "พนักงาน"). Active items get a 2px primary-600 left accent rail
 * per spec.
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
  { href: '/admin/advance', label: 'คำขอเบิก', Icon: Banknote, enabled: true }, // W4d
  { href: '/admin/attendance', label: 'ลงเวลา', Icon: Clock, enabled: true }, // W3c-1: disputed inbox live; Live + Manual tabs pending
  { href: '/admin/payroll', label: 'เงินเดือน', Icon: FileText }, // Phase 2
  { href: '/admin/accounting', label: 'บัญชี', Icon: Calculator }, // Phase 3
  { href: '/admin/audit', label: 'Audit log', Icon: History }, // Phase 3
  { href: '/admin/settings', label: 'ตั้งค่า', Icon: Settings, enabled: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const open = useMobileNav((s) => s.open);
  const close = useMobileNav((s) => s.close);

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  // Auto-close on route change. Without this, tapping a link inside the
  // drawer leaves it open over the new page — deeply annoying UX.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close is stable from zustand
  useEffect(() => {
    if (open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Lock body scroll while the drawer is open (mobile only — desktop's
  // static sidebar wouldn't trigger this).
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
      {/* Backdrop — mobile-only, fades in when drawer opens.
          aria-hidden because the drawer panel itself owns the interactive
          state; the backdrop is a decorative click target. */}
      <div
        aria-hidden="true"
        onClick={close}
        className={cn(
          'fixed inset-0 z-30 bg-gray-900/40 transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* The aside is positioned `fixed` on mobile (slides via transform)
          and `lg:static` on desktop. One element, two layouts. */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-60 border-r border-gray-200 bg-white transition-transform duration-200',
          // Mobile: slide in/out from the left
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full',
          // Desktop: ignore transform, always visible, static positioning
          'lg:static lg:block lg:translate-x-0 lg:shadow-none',
        )}
        aria-label="แผงควบคุมผู้ดูแล"
      >
        <div className="sticky top-0 flex h-dvh flex-col">
          {/* Logo block */}
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <Link href="/admin" className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-lg bg-primary-600 text-sm font-bold text-white shadow-brand">
                KM
              </span>
              <div>
                <p className="text-sm font-semibold leading-tight text-gray-900">Koolman Work</p>
                <p className="text-xs text-gray-500">แผงควบคุมผู้ดูแล</p>
              </div>
            </Link>

            {/* Close button — mobile-only. Desktop sidebar is permanently
                pinned; close button would be confusing chrome there. */}
            <button
              type="button"
              onClick={close}
              aria-label="ปิดเมนู"
              className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:hidden"
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
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
            <p className="text-[11px] uppercase tracking-wider text-gray-400">Koolman Work · V1</p>
          </div>
        </div>
      </aside>
    </>
  );
}
