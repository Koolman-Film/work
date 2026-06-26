import { advanceBalanceFor } from '@/lib/advance/available';
import { requireEmployee } from '@/lib/auth/require-role';
import { AdvanceNewForm } from './advance-new-form';

export default async function NewAdvancePage() {
  const { employee } = await requireEmployee();

  // Soft cap for the warning banner — same number the admin approval guard
  // enforces (advanceBalanceFor is the single source of truth). May be null
  // for rate-based employees when earnings can't be computed; the form then
  // simply shows no warning. Submission is never blocked here.
  const balance = await advanceBalanceFor(employee.id);

  return <AdvanceNewForm available={balance.available} />;
}
