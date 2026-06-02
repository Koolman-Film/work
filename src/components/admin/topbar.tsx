'use client';

import { ChevronDown, LogOut, Menu, Search, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { cn } from '@/lib/utils';
import { NotificationBell } from './notification-bell';
import { useMobileNav } from './use-mobile-nav';

/**
 * Admin topbar (Sapphire Editorial) — sticky 56px header.
 *
 * Layout: [hamburger (mobile)] [⌘K search] ............ [bell] [avatar ▾]
 *
 * The breadcrumb now lives in each page's <PageHeader>, so the topbar no longer
 * renders one (no double breadcrumb). The ⌘K search is a visual placeholder for
 * now — the command palette is a later enhancement. Bell + user menu (profile /
 * language / sign-out) are unchanged.
 */

type Props = {
  /** User display label (email for now; switches to firstName once Employee fields shipped) */
  userLabel: string;
  /** Current user's User.id — used by the NotificationBell to filter
   *  Realtime to this admin's own row inserts. */
  userId: string;
};

export function Topbar({ userLabel, userId }: Props) {
  const toggleMobileNav = useMobileNav((s) => s.toggle);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-[var(--border-color)] bg-white/80 px-3 backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile-only (opens the sidebar drawer). */}
        <button
          type="button"
          onClick={toggleMobileNav}
          aria-label="เปิดเมนู"
          className="grid size-9 place-items-center rounded-md text-ink-3 transition hover:bg-gray-100 hover:text-ink-1 lg:hidden"
        >
          <Menu size={18} strokeWidth={2} aria-hidden="true" />
        </button>

        {/* ⌘K search — visual placeholder (command palette is a later enhancement). */}
        <button
          type="button"
          title="ค้นหา (เร็วๆ นี้)"
          aria-label="ค้นหา"
          className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-gray-50 px-3 py-1.5 text-xs text-ink-4 transition hover:bg-gray-100 sm:min-w-[210px]"
        >
          <Search size={14} strokeWidth={2} aria-hidden="true" />
          <span className="hidden flex-1 text-left sm:inline">ค้นหา…</span>
          <span className="ml-auto hidden gap-1 sm:flex">
            <kbd className="rounded border border-[var(--border-color)] bg-white px-1.5 font-display text-[10px] font-semibold text-ink-3">
              ⌘
            </kbd>
            <kbd className="rounded border border-[var(--border-color)] bg-white px-1.5 font-display text-[10px] font-semibold text-ink-3">
              K
            </kbd>
          </span>
        </button>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-2">
        <NotificationBell userId={userId} />
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
        <span className="grid size-8 place-items-center rounded-full bg-primary-100 font-display text-xs font-bold text-primary-700">
          {initials}
        </span>
        <span className="hidden max-w-[160px] truncate text-ink-2 sm:inline">{userLabel}</span>
        <ChevronDown size={14} className="text-ink-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 min-w-[200px] rounded-lg border border-[var(--border-color)] bg-white py-1 shadow-card"
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="text-xs text-ink-3">เข้าสู่ระบบในนาม</p>
            <p className="truncate text-sm font-medium text-ink-1">{userLabel}</p>
          </div>
          <Link
            href="/admin/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-2 transition hover:bg-gray-50"
          >
            <UserCog size={16} aria-hidden="true" />
            <span>โปรไฟล์ของฉัน</span>
          </Link>
          {/* Language picker — its dropdown change submits a Server Action
              which revalidates the layout, so we don't need to close the
              parent popover manually. */}
          <div className="border-t border-gray-100">
            <LanguageSwitcher variant="topbar" />
          </div>
          <form action="/logout" method="post" className="border-t border-gray-100">
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-2 transition hover:bg-gray-50"
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
