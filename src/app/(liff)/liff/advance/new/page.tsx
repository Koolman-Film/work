import { advanceBalanceFor } from '@/lib/advance/available';
import { isInAdvanceBlackout } from '@/lib/advance/blackout';
import { requireEmployee } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { AdvanceNewForm } from './advance-new-form';

export default async function NewAdvancePage() {
  const { employee } = await requireEmployee();

  // Soft cap for the warning banner — same number the admin approval guard
  // enforces (advanceBalanceFor is the single source of truth). May be null
  // for rate-based employees when earnings can't be computed; the form then
  // simply shows no warning. Submission is never blocked here.
  const balance = await advanceBalanceFor(employee.id);

  // Resolved here and passed down so the form can EXPLAIN the blackout instead
  // of letting someone type an amount and be refused. The real guard is in
  // submitCashAdvance — a disabled button is presentation, and a page held open
  // across midnight would walk straight past it.
  const cfg = await prisma.payrollConfig.findFirst({
    select: { cutoffDay: true, advanceBlackoutDays: true },
  });
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const blackout = cfg
    ? isInAdvanceBlackout(todayYmd, cfg.cutoffDay, cfg.advanceBlackoutDays)
    : false;

  return <AdvanceNewForm available={balance.available} blackout={blackout} />;
}
