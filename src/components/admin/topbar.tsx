'use client';

import { ChevronDown, LogOut, Menu, Sparkles, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { useProductUpdates } from '@/lib/product-updates/store';
import { cn } from '@/lib/utils';
import { NotificationBell } from './notification-bell';
import { useMobileNav } from './use-mobile-nav';

/**
 * Admin topbar (Sapphire Editorial) — sticky 56px header.
 *
 * Layout: [hamburger (mobile)] ............ [theme] [bell] [avatar ▾]
 *
 * The breadcrumb lives in each page's <PageHeader>, so the topbar does not
 * render one (no double breadcrumb).
 *
 * There is deliberately NO search box here. One used to sit in this slot: a
 * button with no onClick, no ⌘K handler anywhere in the codebase, and its own
 * tooltip reading "ค้นหา (เร็วๆ นี้)". It rendered a keyboard-shortcut hint for
 * a shortcut that did not exist, which is worse than an empty slot — a hint
 * that specific reads as a promise, so people try it, nothing happens, and
 * they conclude the app is broken rather than the feature unbuilt.
 *
 * A command palette is worth building for an app with 59 admin pages, and the
 * per-page `?q=` search already works on 7 of them. When it is built it needs
 * permission scoping (getPermittedBranches) so results cannot leak rows across
 * branches — which is why it is a feature, not a slot filler.
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
    <header
      className={cn(
        'sticky top-0 z-20 flex h-14 items-center justify-between gap-2 bg-surface/80 backdrop-blur',
        // 1rem — the same number every page wrapper uses — so the bar's
        // contents sit on exactly the rails the page content below them uses.
        'px-4',
        // Mobile: a flush bar with a hairline under it — the sidebar is
        // off-canvas here, so there is no floating card to be coherent with.
        'border-b border-[var(--border-color)]',
        // Desktop: the same floating card as the sidebar — same radius,
        // border, shadow and 1rem gutter. The shell then reads as two panels
        // on a canvas rather than one panel plus a bar stuck to the window.
        // The bar owns its own right gutter so the content column can stay
        // full-width and pages are not inset twice.
        'lg:top-4 lg:mx-4 lg:mt-4 lg:rounded-2xl lg:border lg:shadow-card',
        // A floating sticky bar leaves a 1rem hole above itself, and page
        // content scrolls straight through it — the page title was visible,
        // clipped, above the bar. This paints the canvas colour across that
        // strip so content disappears BEHIND the shell instead of above it.
        // Scoped to lg: the mobile bar is flush and has no gap to cover.
        //
        // `bottom-[calc(100%+1px)]`, NOT `bottom-full`. An absolutely
        // positioned child is laid out against its containing block's PADDING
        // box, so `bottom: 100%` lands the strip's lower edge at the top of
        // the padding box — one pixel INSIDE the border box, i.e. directly on
        // top of the 1px top border, painting canvas colour over it. The bar
        // then reads as if its top edge had been cropped off, while the
        // sidebar beside it (which has no such strip) keeps a crisp border.
        // The +1px is that border width; it must track `lg:border` above.
        'lg:before:pointer-events-none lg:before:absolute lg:before:inset-x-0',
        'lg:before:bottom-[calc(100%+1px)] lg:before:h-4 lg:before:bg-canvas',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile-only (opens the sidebar drawer). */}
        <button
          type="button"
          onClick={toggleMobileNav}
          aria-label="เปิดเมนู"
          className="grid size-9 place-items-center rounded-md text-ink-3 transition hover:bg-surface-hover-strong hover:text-ink-1 lg:hidden"
        >
          <Menu size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-2">
        {/* Anchor lives here, not inside ThemeToggle: that component is shared
            with LIFF, and a data-tour attribute is admin-tour vocabulary. Same
            reason topbar-bell wraps rather than annotates NotificationBell. */}
        <span data-tour="theme-toggle">
          <ThemeToggle />
        </span>
        <span data-tour="topbar-bell">
          <NotificationBell userId={userId} />
        </span>
        <UserMenu userLabel={userLabel} />
      </div>
    </header>
  );
}

// ─── User menu (sign-out lives here per spec) ──────────────────────────────

function UserMenu({ userLabel }: { userLabel: string }) {
  const [open, setOpen] = useState(false);
  const startTour = useProductUpdates((s) => s.startTour);
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
          open ? 'bg-surface-sunken' : 'hover:bg-surface-hover-strong',
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
          className="absolute right-0 mt-1 min-w-[200px] rounded-lg border border-[var(--border-color)] bg-surface py-1 shadow-card"
        >
          <div className="border-b border-line-soft px-3 py-2">
            <p className="text-xs text-ink-3">เข้าสู่ระบบในนาม</p>
            <p className="truncate text-sm font-medium text-ink-1">{userLabel}</p>
          </div>
          <Link
            href="/admin/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-2 transition hover:bg-surface-hover"
          >
            <UserCog size={16} aria-hidden="true" />
            <span>โปรไฟล์ของฉัน</span>
          </Link>
          {/* No language picker here — the admin UI is Thai-only. Users change
              their employee-app language from the LIFF language modal. */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              startTour('welcome');
            }}
            className="flex w-full items-center gap-2 border-t border-line-soft px-3 py-2 text-sm text-ink-2 transition hover:bg-surface-hover"
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>เริ่มทัวร์แนะนำใหม่</span>
          </button>
          <form action="/logout" method="post" className="border-t border-line-soft">
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-2 transition hover:bg-surface-hover"
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
