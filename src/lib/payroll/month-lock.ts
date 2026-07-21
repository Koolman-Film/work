/**
 * Serializes the two write paths that race on a payroll month —
 * `publishPayroll` (run.ts) and the penalty-settlement admin actions
 * (penalty-settlement-admin.ts) — on the MONTH itself, not on any Payroll
 * row.
 *
 * NOT used by `approveLeaveRequest`'s stranded-SevereLate-settlement guard
 * (leave/admin.ts), even though that guard reads the same closed/settled
 * state this lock protects — see that guard's comment for why: locking here
 * is keyed on the month alone, not on (employee, kind), so it would make an
 * everyday leave approval contend with ANY settle in the same month for ANY
 * employee/kind, which regressed a pinned concurrency invariant when tried
 * (penalty-settlement.integration.test's entitlement-lock race test). That
 * guard accepts a narrow residual race instead.
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
 *
 * NON-BLOCKING BY DESIGN (`pg_try_advisory_xact_lock`, not
 * `pg_advisory_xact_lock`): this used to block until the lock was free,
 * which sounds harmless but isn't — it is the FIRST statement inside the
 * transaction (see above), so every millisecond spent waiting here is
 * charged against that transaction's `timeout` budget, not against
 * Prisma's separate `maxWait` (pool-acquisition) budget. Sizing `timeout`
 * to also cover an unknown, unbounded queueing delay behind however many
 * other admins are contending for the SAME month is a losing game — bump it
 * once, someone finds a scenario with one more concurrent caller than the
 * bump covered, and it's an unhandled P2028 again (this is exactly what
 * happened across the two previous fixes to this file: 5s timeout → 20s/30s
 * → still not enough once a second concurrent `runPayrollDraft` could queue
 * behind the first). `pg_try_advisory_xact_lock` returns immediately —
 * `true` if it got the lock, `false` if someone else holds it — so
 * `timeout` only ever has to cover this transaction's OWN work, never
 * someone else's. Every caller MUST check the return value and treat
 * `false` as "another operation is in progress, try again" (a `busy`
 * outcome — see the callers), never assume the lock was acquired.
 */
import type { prisma } from '@/lib/db/prisma';

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Attempt to acquire the month's advisory lock without blocking. Returns
 * `true` if this transaction now holds it, `false` if another transaction
 * holds it right now — the caller must treat `false` as "busy" and abort
 * (return a `busy` result), NOT proceed as if the lock were held.
 *
 * `$queryRaw`, not `$executeRaw`: `pg_try_advisory_xact_lock` (unlike the
 * blocking `pg_advisory_xact_lock`) returns a real `boolean` column, which
 * Prisma's query engine deserializes fine — `$executeRaw` would discard it.
 */
export async function lockPayrollMonth(db: TxClient, month: string): Promise<boolean> {
  const rows = await db.$queryRaw<
    { locked: boolean }[]
  >`SELECT pg_try_advisory_xact_lock(hashtext(${month})) AS locked`;
  return rows[0]?.locked ?? false;
}

/** How long to wait before each retry attempt in {@link withMonthLockRetry}. */
const MONTH_LOCK_RETRY_DELAYS_MS = [50, 150];

/**
 * A couple of short, bounded retries for a transaction whose FIRST statement
 * is `lockPayrollMonth`, when losing that lock race once is unlikely to mean
 * losing it again a moment later. Each attempt is a FRESH transaction
 * (`attempt` is called again from scratch, not resumed) — a failed lock
 * acquire never leaves a half-open transaction sitting around while this
 * sleeps between attempts.
 *
 * Used by:
 *   - `setPenaltySettlement`/`clearPenaltySettlement`
 *     (penalty-settlement-admin.ts) — a handful of point reads/writes on ONE
 *     employee; contention typically clears within tens of milliseconds, and
 *     an admin having to manually re-click "save" for that is worse than a
 *     couple of silent retries.
 *   - `publishPayroll` (run.ts) — same reasoning applies whenever it's
 *     scoped to ONE employee (`opts.employeeId`, the per-row "เผยแพร่" button)
 *     or a whole month with few enough employees to finish fast; races it
 *     against another equally-quick settlement are common (see the
 *     "publish-side lock race" integration tests) and a short retry turns
 *     most of them into a clean success instead of a spurious `busy`.
 *
 * Deliberately NOT used by `runPayrollDraft` (run.ts): that function's
 * per-employee write loop can hold the lock for a duration that scales with
 * headcount and is the side MORE likely to be the one already holding the
 * lock when someone else loses a race against it (see the "month-lock race"
 * integration test, which pads it to ~60 employees specifically to make this
 * true) — retrying a fixed ~200ms budget against a hold time that can run
 * well past that doesn't meaningfully raise the odds of success, only adds
 * latency before the caller finds out either way. Surfacing `busy`
 * immediately there is the more honest answer.
 */
export async function withMonthLockRetry<T>(
  attempt: () => Promise<T>,
  isBusy: (result: T) => boolean,
): Promise<T> {
  let result = await attempt();
  for (const delayMs of MONTH_LOCK_RETRY_DELAYS_MS) {
    if (!isBusy(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    result = await attempt();
  }
  return result;
}
