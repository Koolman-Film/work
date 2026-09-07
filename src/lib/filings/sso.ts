import 'server-only';
import type { TitlePrefix } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

/** The Thai word สปส.1-10's Excel template expects in `คำนำหน้าชื่อ`.
 *  ภ.ง.ด.1 will want the same concept as a 3-digit code — a second map off the
 *  same enum, not a second column. */
const TITLE_TH: Record<TitlePrefix, string> = {
  Mr: 'นาย',
  Mrs: 'นาง',
  Miss: 'นางสาว',
};

function titlePrefixTh(p: TitlePrefix | null): string | null {
  return p ? TITLE_TH[p] : null;
}

export type SsoFilingRow = {
  employeeId: string;
  nationalId: string | null;
  /// คำนำหน้าชื่อ as the Thai WORD the upload template wants (นาย / นาง /
  /// นางสาว), null when the employee has none recorded.
  titlePrefixTh: string | null;
  firstName: string;
  lastName: string;
  /** Combined, for the on-screen table only. The upload template wants the
   *  parts in separate columns. */
  name: string;
  wages: number;
  employeeContribution: number;
  employerContribution: number;
};

export type SsoFiling = {
  month: string;
  branch: { id: string; name: string; ssoAccountNo: string | null; ssoBranchNo: string | null };
  rows: SsoFilingRow[];
  totals: { wages: number; employee: number; employer: number; grand: number; count: number };
  ratePercent: number;
  problems: {
    missingNationalIds: number;
    missingTitlePrefixes: number;
    missingBranchSso: boolean;
    missingBranchSsoNo: boolean;
  };
};

export async function loadSsoFiling(month: string, branchId: string): Promise<SsoFiling | null> {
  const [branch, config, payrolls] = await Promise.all([
    prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, name: true, ssoAccountNo: true, ssoBranchNo: true },
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
        employee: {
          select: {
            id: true,
            titlePrefix: true,
            firstName: true,
            lastName: true,
            nationalId: true,
          },
        },
      },
    }),
  ]);

  if (!branch) return null;

  const rows: SsoFilingRow[] = payrolls.map((p) => {
    const contribution = p.deductSso.toNumber();
    return {
      employeeId: p.employee.id,
      nationalId: p.employee.nationalId,
      titlePrefixTh: titlePrefixTh(p.employee.titlePrefix),
      firstName: p.employee.firstName,
      lastName: p.employee.lastName,
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
      missingTitlePrefixes: rows.filter((r) => !r.titlePrefixTh).length,
      missingBranchSso: !branch.ssoAccountNo,
      missingBranchSsoNo: !branch.ssoBranchNo,
    },
  };
}
