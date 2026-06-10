'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/reports/attendance', label: 'ลงเวลา' },
  { href: '/admin/reports/leave', label: 'วันลา' },
  { href: '/admin/reports/advance', label: 'เบิกเงิน' },
];

/**
 * Horizontal sub-nav for the Reports cluster — pill per report, styled like
 * AttendanceTabs. Client component so the shared layout can highlight the
 * active tab via usePathname (the layout itself stays a Server Component).
 */
export function ReportTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200'
                : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-4 transition hover:bg-gray-50 hover:text-ink-2'
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
