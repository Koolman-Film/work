import { requireGlobalPermission } from '@/lib/auth/require-global-permission';

/**
 * Permission gate for all /admin/payroll/* pages — same pattern as the
 * reports layout. Finer-grained write actions (`payroll.run`,
 * `payroll.publish`) are enforced inside the Server Actions themselves.
 */
export default async function PayrollLayout({ children }: { children: React.ReactNode }) {
  await requireGlobalPermission('payroll.read');
  return <>{children}</>;
}
