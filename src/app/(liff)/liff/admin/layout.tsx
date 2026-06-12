/**
 * /liff/admin shell — tab nav grows in plan B (attendance overview, stats).
 *
 * Thai-only literals: admin-facing, matches the untranslated admin panel.
 * Auth is per-page (requireLiffAdmin); the LiffSessionGate handles the
 * "rich-menu deep link with no Supabase session yet" first-open case.
 */

import { AdminTabs } from './admin-tabs';
import { LiffSessionGate } from './liff-session-gate';

export default function LiffAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <AdminTabs />
      <LiffSessionGate>{children}</LiffSessionGate>
    </div>
  );
}
