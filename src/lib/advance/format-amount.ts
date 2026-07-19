/**
 * Format a Prisma.Decimal (or any stringifiable numeric) as a human-friendly
 * currency string ("12,500.00") for LINE Flex Message display. Stays in
 * string form across the Inngest event boundary so JSON serialisation
 * doesn't drop precision.
 *
 * Shared by admin.ts (approve/reject/mark-paid actions, which already hold
 * the row in hand) and the advance-approval-notify Inngest function (which
 * re-reads the advance from Prisma after the settle window rather than
 * trusting a value captured at approval time) — kept in its own module,
 * separate from admin.ts's `'use server'` directive, so both a Server
 * Action file and a plain Inngest function file can import it.
 */
export function formatAmount(d: { toString(): string }): string {
  const n = Number(d.toString());
  if (!Number.isFinite(n)) return d.toString();
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
