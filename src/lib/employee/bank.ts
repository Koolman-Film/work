/**
 * Pure helpers for the employee bank-account field.
 *
 * `normalizeBankAccountNumber` — strip human-friendly separators (spaces,
 * dashes) down to bare digits for storage; empty → null.
 * `maskBankAccountNumber` — last-4-only masking for audit-log payloads, so
 * full account numbers are never written to the audit trail.
 */

/** Strip spaces/dashes; return bare digits, or null when empty. */
export function normalizeBankAccountNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s-]/g, '');
  return digits === '' ? null : digits;
}

/** Mask all but the last 4 digits (`••••••7890`). Short values pass through. */
export function maskBankAccountNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[\s-]/g, '');
  if (digits.length <= 4) return digits;
  return `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}
