/**
 * The branch label to show an employee in their own locale.
 *
 * Thai employees (and any branch without an English name) see the native
 * `name`; non-Thai employees see `nameEn` when it's set. Used by the payslip
 * สาขา field and the LIFF profile / check-in surfaces.
 */
export function localizedBranchName(
  branch: { name: string; nameEn: string | null },
  locale: string,
): string {
  return locale === 'th' ? branch.name : branch.nameEn || branch.name;
}
