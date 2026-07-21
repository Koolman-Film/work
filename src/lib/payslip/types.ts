export type PayslipLine = {
  key: string;
  labelKey?: string; // payslip.* key when it's a fixed bucket
  label?: string; // literal (adjustment reason)
  /**
   * Interpolation values for `labelKey`'s own text (e.g. `{days}` in the
   * settled-with-leave note) — distinct from `detail.vars`, which feeds the
   * separate detail sub-line.
   */
  vars?: Record<string, string | number>;
  /**
   * Raw per-locale leave-type name data for the settled-with-leave note's
   * `{leaveType}` placeholder. Carried as raw data rather than a
   * pre-resolved string because this document model has no locale
   * awareness by design — only the renderer (which knows both the primary
   * and reference locale for the bilingual label) can resolve it, via
   * `localizedLeaveTypeName`.
   */
  leaveType?: { name: string; nameByLocale: unknown } | null;
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
