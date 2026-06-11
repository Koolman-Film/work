import { requirePermission } from '@/lib/auth/check-permission';

/**
 * Permission gate for all /admin/payroll/* pages — same pattern as the
 * reports layout. Finer-grained write actions (`payroll.run`,
 * `payroll.publish`) are enforced inside the Server Actions themselves.
 */
export default async function PayrollLayout({ children }: { children: React.ReactNode }) {
  await requirePermission('payroll.read');
  return <>{children}</>;
}
