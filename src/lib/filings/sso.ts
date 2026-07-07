import 'server-only';
import { prisma } from '@/lib/db/prisma';

export type SsoFilingRow = {
  employeeId: string;
  nationalId: string | null;
  name: string;
  wages: number;
  employeeContribution: number;
  employerContribution: number;
};

export type SsoFiling = {
  month: string;
  branch: { id: string; name: string; ssoAccountNo: string | null };
  rows: SsoFilingRow[];
  totals: { wages: number; employee: number; employer: number; grand: number; count: number };
  ratePercent: number;
  problems: { missingNationalIds: number; missingBranchSso: boolean };
};

export async function loadSsoFiling(month: string, branchId: string): Promise<SsoFiling | null> {
  const [branch, config, payrolls] = await Promise.all([
    prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, name: true, ssoAccountNo: true },
    }),
    prisma.payrollConfig.findFirst({ select: { ssoRate: true } }),
    prisma.payroll.findMany({
      where: {
        month,
        employee: { branchId, hasSso: true, status: { not: 'Archived' } },
      },
      orderBy: [{ employee: { firstName: 'asc' } }, { employee: { lastName: 'asc' } }],
      select: {
        incomeBase: true,
        deductSso: true,
        employee: { select: { id: true, firstName: true, lastName: true, nationalId: true } },
      },
    }),
  ]);

  if (!branch) return null;

  const rows: SsoFilingRow[] = payrolls.map((p) => {
    const contribution = p.deductSso.toNumber();
    return {
      employeeId: p.employee.id,
      nationalId: p.employee.nationalId,
      name: `${p.employee.firstName} ${p.employee.lastName}`,
      // NOTE: wages = incomeBase, contribution = deductSso (computed on Employee.baseSalary).
      // Consistent only while incomeBase == baseSalary (V1, no proration in calc.ts).
      // TODO(proration): revisit the wages source when Payroll starts prorating mid-month.
      wages: p.incomeBase.toNumber(),
      // Thai SSO employer rate mirrors the employee rate → employer == employee.
      employeeContribution: contribution,
      employerContribution: contribution,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.wages += r.wages;
      acc.employee += r.employeeContribution;
      acc.employer += r.employerContribution;
      acc.count += 1;
      return acc;
    },
    { wages: 0, employee: 0, employer: 0, grand: 0, count: 0 },
  );
  totals.grand = totals.employee + totals.employer;

  // ssoRate is a fraction (e.g. 0.05) → percent for the summary label.
  const ratePercent = config ? Number(config.ssoRate) * 100 : 0;

  return {
    month,
    branch,
    rows,
    totals,
    ratePercent,
    problems: {
      missingNationalIds: rows.filter((r) => !r.nationalId).length,
      missingBranchSso: !branch.ssoAccountNo,
    },
  };
}
