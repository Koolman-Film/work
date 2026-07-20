/**
 * Serializes the two write paths that race on a payroll month —
 * `publishPayroll` (run.ts) and the penalty-settlement admin actions
 * (penalty-settlement-admin.ts) — on the MONTH itself, not on any Payroll
 * row.
 *
 * Why not a row lock: `publishPayroll`'s upsert can CREATE a Payroll row
 * that did not exist when a settlement was written — e.g. an employee added
 * or activated between "คำนวณ" and "เผยแพร่", reachable through the manual
 * attendance form, which settles without requiring a Draft row to exist
 * first. `SELECT ... FOR UPDATE` against a Payroll row locks nothing when no
 * row matches, so that case raced exactly as if there were no lock at all:
 * settle commits the leave spend, publish's already-taken snapshot misses
 * it, the upsert's `create` branch writes a Published row carrying the full
 * unsettled money charge, and `clearPenaltySettlement` then refuses with
 * `period-closed` — the employee is charged twice, with no way to recover
 * short of a direct database edit. (This was Finding 1 of the review that
 * added this file — a previous version of this comment, on both call
 * sites, incorrectly asserted that a row-existence-dependent lock was safe
 * because "an employee with no row for this month has nothing to publish."
 * That reasoning was wrong: publish's upsert can and does create the row.)
 *
 * A Postgres advisory lock has no row-existence requirement — it locks on
 * the key alone, so it protects a month with zero Payroll rows exactly as
 * well as a month with a thousand. Both call sites MUST pass the same
 * `month` string (never employeeId, never a row id) so they always compute
 * the same lock key and can never miss each other.
 *
 * Must be the FIRST statement inside the transaction, before any read that
 * decides what to write (`gatherAndCalc` on the publish side,
 * `isPeriodClosed` on the settlement side) — the ordering is what actually
 * closes the race, not merely holding the lock. See the callers for the
 * before/after reasoning.
 *
 * Month-level granularity means two admins settling different employees in
 * the same month serialize with each other too. That's accepted: settle
 * transactions are short, and correctness here outweighs the lost
 * concurrency.
 *
 * A single advisory lock per transaction (keyed on one string) can't
 * deadlock against itself the way multiple row locks taken in different
 * orders can — there is only ever one key to acquire, so the old
 * employeeId-ordering concern for the row-lock version of this code no
 * longer applies.
 */
import type { prisma } from '@/lib/db/prisma';

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function lockPayrollMonth(db: TxClient, month: string): Promise<void> {
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns `void`, and
  // Prisma's query engine can't deserialize a `void` column ("Failed to
  // deserialize column of type 'void'") — it can only run the statement and
  // report rows affected, which is all this needs.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${month}))`;
}
