/**
 * Thai national ID (เลขประจำตัวประชาชน) validation.
 * 13 digits; the 13th is a mod-11 check digit over the first 12 weighted 13..2.
 */
export function isValidThaiNationalId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(id[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(id[12]);
}

/** Mask all but the last 4 digits (`•••••••••7285`) for audit-log payloads —
 * mirrors `maskBankAccountNumber` so PII is never written to the audit trail
 * in full. Short values pass through. */
export function maskNationalId(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return value;
  return `${'•'.repeat(value.length - 4)}${value.slice(-4)}`;
}
