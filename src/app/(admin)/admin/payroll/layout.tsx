import { requireGlobalPermission } from '@/lib/auth/require-global-permission';

/**
 * Defect 2: there is no vercel.json, and `maxDuration` otherwise appears only
 * on five heavy route handlers (PDF/zip/export generation) that opt up to
 * 60/300s — evidence the platform default here is well below the payroll
 * transaction budgets below (run.ts: `runPayrollDraft` 10s, `publishPayroll`
 * 15s; both plus a 5s `maxWait` pool-acquisition budget on top). If the
 * platform kills the function before that budget elapses, the `try/catch`
 * around `publishPayroll`/`runPayrollDraft` in this segment's Server Actions
 * (actions.ts, reconcile/actions.ts) never runs, and the admin gets a raw
 * gateway error — exactly the symptom those catches exist to remove, reached
 * a different way. Set here (not on individual pages) so it covers every
 * route nested under /admin/payroll, including reconcile/ and adjustments/,
 * all of which call into the same payroll transactions. 60s matches the
 * lighter tier the five existing route handlers already use.
 */
export const maxDuration = 60;

/**
 * Permission gate for all /admin/payroll/* pages — same pattern as the
 * reports layout. Finer-grained write actions (`payroll.run`,
 * `payroll.publish`) are enforced inside the Server Actions themselves.
 */
export default async function PayrollLayout({ children }: { children: React.ReactNode }) {
  await requireGlobalPermission('payroll.read');
  return <>{children}</>;
}
