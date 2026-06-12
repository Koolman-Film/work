'use client';

/**
 * Tab nav for the /liff/admin shell. Each tab is a SCREEN with one job:
 *   งานรออนุมัติ → /liff/admin/inbox   (everything pending a decision)
 *   รอแนบสลิป   → /liff/admin/advance (approved advances awaiting slip)
 * The active tab doubles as the page title — pages don't repeat an h1.
 * Plan-B pages (attendance overview, stats) append here.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/liff/admin/inbox', label: 'งานรออนุมัติ' },
  { href: '/liff/admin/advance', label: 'รอแนบสลิป' },
] as const;

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 px-4 pt-2 text-sm">
      {TABS.map((tab) => {
        // Prefix match so detail pages highlight their section
        // (/liff/admin/advance/[id] → รอแนบสลิป). Leave detail pages
        // belong to the inbox flow but live under /liff/admin/leave —
        // no tab highlights there, which is fine for a drill-in page.
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-full bg-primary-50 px-3 py-1.5 font-semibold text-primary-700 ring-1 ring-primary-200'
                : 'rounded-full px-3 py-1.5 font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
