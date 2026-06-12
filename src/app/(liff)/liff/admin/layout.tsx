/**
 * /liff/admin shell — tab nav grows in plan B (attendance overview, stats).
 *
 * Thai-only literals: admin-facing, matches the untranslated admin panel.
 * Auth is per-page (requireLiffAdmin); the LiffSessionGate handles the
 * "rich-menu deep link with no Supabase session yet" first-open case.
 */

import Link from 'next/link';
import { LiffSessionGate } from './liff-session-gate';

export default function LiffAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <nav className="flex gap-1 px-4 pt-2 text-sm">
        <Link
          href="/liff/admin/inbox"
          className="rounded-full px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
        >
          รออนุมัติ
        </Link>
        <Link
          href="/liff/admin/advance?filter=awaiting-slip"
          className="rounded-full px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
        >
          รอแนบสลิป
        </Link>
      </nav>
      <LiffSessionGate>{children}</LiffSessionGate>
    </div>
  );
}
