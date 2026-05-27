'use client';

import { Bell, ChevronDown, LogOut, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useMobileNav } from './use-mobile-nav';

/**
 * Admin topbar — sticky 56px header per docs/v1/screens/navigation.md:193-213.
 *
 * Layout: [breadcrumb] ............................ [bell] [avatar ▾]
 *
 * The avatar opens a small popover with sign-out (replaces v1's M-A2 modal
 * — the popover gives enough friction without a full dialog round-trip).
 * The bell is a placeholder (no Realtime wiring until W4); badge shows
 * unread count when notifications exist.
 */

type Props = {
  /** User display label (email for now; switches to firstName once Employee fields shipped) */
  userLabel: string;
  /** Optional unread notification count */
  unreadCount?: number;
};

export function Topbar({ userLabel, unreadCount = 0 }: Props) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const toggleMobileNav = useMobileNav((s) => s.toggle);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-gray-200 bg-white/80 px-3 backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile-only. The Owner shell doesn't have a sidebar,
            but the button is harmless there (toggles a store nobody reads).
            We could conditionally render based on whether the sidebar is
            mounted, but that requires layout-level coordination that isn't
            worth it for one stray button on the Owner page. */}
        <button
          type="button"
          onClick={toggleMobileNav}
          aria-label="เปิดเมนู"
          className="grid size-9 place-items-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 lg:hidden"
        >
          <Menu size={18} strokeWidth={2} aria-hidden="true" />
        </button>

        {/* Breadcrumb */}
        <nav aria-label="breadcrumb" className="flex min-w-0 items-center text-sm text-gray-500">
          {segments.length === 0 ? (
            <span className="font-medium text-gray-900">หน้าหลัก</span>
          ) : (
            segments.map((seg, i) => {
              const href = `/${segments.slice(0, i + 1).join('/')}`;
              const isLast = i === segments.length - 1;
              const label = labelFor(seg);
              return (
                <span key={href} className="flex items-center">
                  {i > 0 && <span className="px-1.5 text-gray-300">/</span>}
                  {isLast ? (
                    <span className="font-medium text-gray-900">{label}</span>
                  ) : (
                    <Link href={href} className="hover:text-gray-700">
                      {label}
                    </Link>
                  )}
                </span>
              );
            })
          )}
        </nav>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="การแจ้งเตือน"
          className="relative grid size-9 place-items-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
        >
          <Bell size={18} strokeWidth={2} aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 grid min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        <UserMenu userLabel={userLabel} />
      </div>
    </header>
  );
}

// ─── User menu (sign-out lives here per spec) ──────────────────────────────

function UserMenu({ userLabel }: { userLabel: string }) {
  const [open, setOpen] = useState(false);
  const initials = userLabel.slice(0, 2).toUpperCase();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={(e) => {
          // Close when focus moves outside the dropdown
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
            setOpen(false);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition',
          open ? 'bg-gray-100' : 'hover:bg-gray-100',
        )}
      >
        <span className="grid size-8 place-items-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
          {initials}
        </span>
        <span className="hidden max-w-[160px] truncate text-gray-700 sm:inline">{userLabel}</span>
        <ChevronDown size={14} className="text-gray-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 min-w-[200px] rounded-lg border border-gray-200 bg-white py-1 shadow-brand"
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="text-xs text-gray-500">เข้าสู่ระบบในนาม</p>
            <p className="truncate text-sm font-medium text-gray-900">{userLabel}</p>
          </div>
          <form action="/logout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50"
            >
              <LogOut size={16} aria-hidden="true" />
              <span>ออกจากระบบ</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Breadcrumb labeling — translate URL segments to Thai labels ───────────

const SEGMENT_LABELS: Record<string, string> = {
  admin: 'แอดมิน',
  owner: 'เจ้าของ',
  employees: 'พนักงาน',
  branches: 'สาขา',
  departments: 'แผนก',
  'accounting-groups': 'กลุ่มบัญชี',
  settings: 'ตั้งค่า',
  leave: 'คำขอลา',
  advance: 'คำขอเบิก',
  attendance: 'ลงเวลา',
  payroll: 'เงินเดือน',
  audit: 'Audit log',
  new: 'สร้างใหม่',
  edit: 'แก้ไข',
};

function labelFor(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  // UUIDs / dynamic segments — show short ID
  if (/^[0-9a-f]{8}-/i.test(segment)) return segment.slice(0, 8);
  return segment;
}
