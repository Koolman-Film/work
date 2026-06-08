import Link from 'next/link';

type Current = 'records' | 'disputed' | 'live' | 'manual' | 'overtime';

const TABS = [
  { key: 'records', href: '/admin/attendance', label: 'ประวัติ' },
  { key: 'disputed', href: '/admin/attendance/disputed', label: 'ต้องตรวจสอบ' },
  { key: 'live', href: '/admin/attendance/live', label: 'สด' },
  { key: 'manual', href: '/admin/attendance/manual', label: 'คีย์มือ' },
  { key: 'overtime', href: '/admin/attendance/overtime', label: 'OT' },
] as const;

/**
 * Horizontal sub-nav for the Attendance cluster — one pill per view, styled
 * like the leave/advance filter chips. Rendered per page under its PageHeader.
 * `disputedCount` shows an amber badge on the "ต้องตรวจสอบ" pill when > 0.
 */
export function AttendanceTabs({
  current,
  disputedCount,
}: {
  current: Current;
  disputedCount?: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {TABS.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200'
                : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-4 transition hover:bg-gray-50 hover:text-ink-2'
            }
          >
            {t.label}
            {t.key === 'disputed' && disputedCount ? (
              <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                {disputedCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
