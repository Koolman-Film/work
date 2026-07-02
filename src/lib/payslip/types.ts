export type PayslipLine = {
  key: string;
  labelKey?: string; // payslip.* key when it's a fixed bucket
  label?: string; // literal (adjustment reason)
  amount: number;
  detail?: { key: string; vars: Record<string, string | number> } | null;
};

export type PayslipDocument = {
  meta: {
    employeeName: string;
    employeeId: string;
    branch: string;
    branchEn: string | null;
    letterhead: {
      payslipNameEn: string | null;
      payslipNameNative: string | null;
      payslipLogoKey: string | null;
    };
    department: string | null;
    payType: 'Monthly' | 'Daily' | 'Hourly';
    month: string;
  };
  income: { lines: PayslipLine[]; total: number };
  deduct: { lines: PayslipLine[]; total: number };
  net: number;
};
