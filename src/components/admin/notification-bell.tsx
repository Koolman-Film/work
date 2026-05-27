'use client';

/**
 * Topbar in-app bell — Admin/Owner notification dropdown.
 *
 * Lifecycle:
 *   1. Mount → server-fetch the last N notifications via
 *      fetchRecentNotifications() to populate initial state.
 *   2. Subscribe to Supabase Realtime on the Notification table
 *      filtered by `userId = me`. New INSERTs prepend to local state;
 *      we don't need UPDATE/DELETE coverage because the only mutation
 *      is readAt-flipping which we do client-first (optimistic).
 *   3. Bell badge shows count of unread (readAt IS NULL).
 *   4. Click bell → toggle dropdown. Render notifications grouped
 *      (unread → recently-read), each with kind-specific icon + Thai
 *      text + relative time + click target URL.
 *   5. Clicking a row → mark that one read + navigate.
 *   6. "อ่านทั้งหมด" footer button → mark all read.
 *
 * Realtime caveat:
 *   The `Notification` table must be in the `supabase_realtime`
 *   publication. One-time SQL in docs/v2/architecture.md alongside
 *   the existing Attendance entry.
 */

import { Bell, BellRing } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  type BellNotification,
  fetchRecentNotifications,
  markAllNotificationsRead,
  markOneNotificationRead,
} from '@/lib/notifications/actions';
import { createClient } from '@/lib/supabase/browser';
import { cn } from '@/lib/utils';

type Props = {
  /** Current user's User.id — used to filter Realtime to this admin only. */
  userId: string;
};

export function NotificationBell({ userId }: Props) {
  const [notifications, setNotifications] = useState<BellNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [_pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  // Initial fetch on mount.
  useEffect(() => {
    void fetchRecentNotifications()
      .then(setNotifications)
      .catch((err) => console.error('[bell] initial fetch failed', err));
  }, []);

  // Realtime subscription. New INSERTs land at the top of the list.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'Notification',
          filter: `userId=eq.${userId}`,
        },
        () => {
          // The payload from Supabase contains the new row but we
          // refetch from the server to (a) get the canonical typed
          // shape and (b) re-sort with any other concurrent inserts.
          // ~50ms round-trip; negligible vs the WebSocket latency.
          void fetchRecentNotifications()
            .then(setNotifications)
            .catch((err) => console.error('[bell] realtime refetch failed', err));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  // Click-outside-to-close. Necessary because the dropdown isn't a
  // <details> element; without this, the user has to click the bell
  // button again to dismiss.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function onMarkAllRead() {
    // Optimistic — flip readAt locally so the badge clears instantly,
    // then call the server. If the server fails, the next Realtime
    // event or fetch reconciles (worst case: badge briefly shows wrong
    // count before sync).
    setNotifications((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    );
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  }

  function onClickItem(n: BellNotification) {
    // Optimistic flip + server mutation, then close + navigate.
    if (!n.readAt) {
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      );
      startTransition(async () => {
        await markOneNotificationRead(n.id);
      });
    }
    setOpen(false);
  }

  const Icon = unreadCount > 0 ? BellRing : Bell;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="การแจ้งเตือน"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'relative grid size-9 place-items-center rounded-full transition',
          open
            ? 'bg-gray-100 text-gray-700'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
        )}
      >
        <Icon
          size={18}
          strokeWidth={2}
          className={unreadCount > 0 ? 'text-primary-600' : undefined}
          aria-hidden="true"
        />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-brand"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">การแจ้งเตือน</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                อ่านทั้งหมด
              </button>
            )}
          </div>

          {/* Body */}
          {notifications.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-gray-500">ยังไม่มีการแจ้งเตือน</p>
              <p className="mt-1 text-xs text-gray-400">ระบบจะแจ้งเตือนเมื่อพนักงานส่งคำขอ</p>
            </div>
          ) : (
            <ul className="max-h-[420px] divide-y divide-gray-100 overflow-y-auto">
              {notifications.map((n) => (
                <NotificationRow key={n.id} notification={n} onClick={() => onClickItem(n)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Per-kind rendering ────────────────────────────────────────────────────

type RenderedKind = {
  emoji: string;
  title: string;
  subtitle: string;
  href: string;
};

/** Switch over the event kind to produce display fields. New kinds added in
 *  notifications/in-app-bell.ts MUST also be handled here. Unknown kinds
 *  fall back to a generic "เหตุการณ์ใหม่" row rather than crashing. */
function renderNotification(n: BellNotification): RenderedKind {
  const payload = (
    typeof n.payload === 'object' && n.payload !== null
      ? (n.payload as Record<string, unknown>)
      : {}
  ) as Record<string, string | undefined>;

  switch (n.event) {
    case 'leave.submitted':
      return {
        emoji: '📅',
        title: `${payload.employeeName ?? 'พนักงาน'} ส่งคำขอลา`,
        subtitle: `${payload.leaveTypeName ?? ''} ${formatRange(payload.startDate, payload.endDate)}`,
        href: '/admin/leave',
      };
    case 'advance.submitted':
      return {
        emoji: '💰',
        title: `${payload.employeeName ?? 'พนักงาน'} ส่งคำขอเบิก`,
        subtitle: `฿${payload.amount ?? ''}`,
        href: '/admin/advance',
      };
    case 'attendance.disputed':
      return {
        emoji: '⚠️',
        title: `${payload.employeeName ?? 'พนักงาน'} เช็คอินที่ต้องตรวจสอบ`,
        subtitle: payload.reason ?? '',
        href: '/admin/attendance/disputed',
      };
    case 'attendance.late-summary': {
      const count = payload.countNotCheckedIn ?? '0';
      const samples = Array.isArray(payload.sampleEmployeeNames)
        ? (payload.sampleEmployeeNames as string[]).slice(0, 3).join(', ')
        : '';
      return {
        emoji: '⏰',
        title: `${count} พนักงานยังไม่เช็คอินวันนี้`,
        subtitle: samples,
        href: '/admin/attendance/live',
      };
    }
    case 'probation.ending':
      return {
        emoji: '🎓',
        title: `${payload.employeeName ?? 'พนักงาน'} จะหมดทดลองงานในอีก ${payload.daysRemaining ?? '?'} วัน`,
        subtitle: `จบทดลองงาน ${payload.endDate ?? ''}`,
        href: payload.employeeId
          ? `/admin/employees/${payload.employeeId}/edit`
          : '/admin/employees',
      };
    default:
      return {
        emoji: '🔔',
        title: 'เหตุการณ์ใหม่',
        subtitle: n.event,
        href: '/admin',
      };
  }
}

function formatRange(start: string | undefined, end: string | undefined): string {
  if (!start || !end) return '';
  return start === end ? start : `${start} – ${end}`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return 'เมื่อกี้';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชม. ที่แล้ว`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
  });
}

function NotificationRow({
  notification,
  onClick,
}: {
  notification: BellNotification;
  onClick: () => void;
}) {
  const r = renderNotification(notification);
  const unread = !notification.readAt;
  return (
    <li>
      <Link
        href={r.href}
        onClick={onClick}
        className={cn(
          'flex items-start gap-3 px-4 py-3 transition hover:bg-gray-50',
          unread && 'bg-primary-50/30',
        )}
      >
        <span className="mt-0.5 text-lg leading-none" aria-hidden="true">
          {r.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate text-sm',
              unread ? 'font-semibold text-gray-900' : 'text-gray-700',
            )}
          >
            {r.title}
          </p>
          {r.subtitle && <p className="mt-0.5 truncate text-xs text-gray-500">{r.subtitle}</p>}
          <p className="mt-0.5 text-[10px] text-gray-400">{relativeTime(notification.createdAt)}</p>
        </div>
        {unread && (
          <span
            // role="img" + aria-label is the WAI-ARIA pattern for a
            // visual-only element that conveys meaning (the unread dot).
            // A plain <span aria-label> would fail useAriaPropsSupportedByRole
            // because spans have no implicit role.
            role="img"
            aria-label="ยังไม่ได้อ่าน"
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600"
          />
        )}
      </Link>
    </li>
  );
}
