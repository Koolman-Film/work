import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { lockPayrollMonth } from '@/lib/payroll/month-lock';
import {
  type PublishResult,
  publishPayroll,
  type RunResult,
  runPayrollDraft,
} from '@/lib/payroll/run';

/**
 * Integration tests for Defect 1: `lockPayrollMonth` must acquire the
 * month's advisory lock WITHOUT blocking (`pg_try_advisory_xact_lock`, not
 * `pg_advisory_xact_lock`), returning `false` immediately on contention
 * instead of queueing — and every caller (`runPayrollDraft`, `publishPayroll`
 * here; the settlement actions are covered in penalty-settlement.integration.
 * test.ts) must surface that as a clean `busy` result rather than hanging or
 * throwing.
 *
 * These tests hold the SAME advisory lock key a real `publishPayroll`/
 * `runPayrollDraft` transaction would take (`lockPayrollMonth` itself, called
 * directly against a long-lived raw transaction) and prove the contended side
 * returns fast — bounded well under Postgres's own lock-wait behavior, which
 * would otherwise block for the lifetime of the holder.
 */

async function reset() {
  await prisma.payroll.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.payrollConfig.deleteMany({});

  await prisma.payrollConfig.create({
    data: {
      ssoRate: new Prisma.Decimal('0.05'),
      ssoSalaryCap: new Prisma.Decimal(15_000),
      ssoAmountCap: new Prisma.Decimal(750),
      otMultiplier: new Prisma.Decimal('1.5'),
      absentDeductionPerDay: new Prisma.Decimal(500),
      lateDeduction: new Prisma.Decimal(100),
      earlyLeaveDeduction: new Prisma.Decimal(100),
    },
  });
}

/** Hold `month`'s advisory lock for `holdMs`, then release (commit). Runs as
 *  its own transaction, mirroring exactly what `runPayrollDraft`/
 *  `publishPayroll` do as their first statement. */
async function holdMonthLock(month: string, holdMs: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const acquired = await lockPayrollMonth(tx, month);
    if (!acquired) throw new Error('test setup bug: expected to acquire the lock uncontended');
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('lockPayrollMonth — non-blocking acquire (Defect 1)', () => {
  it('acquires cleanly (returns true) when nothing else holds the month lock', async () => {
    const acquired = await prisma.$transaction(async (tx) => lockPayrollMonth(tx, '2026-09'));
    expect(acquired).toBe(true);
  });

  it('returns false immediately — not after waiting — when another transaction already holds the SAME month key', async () => {
    const month = '2026-09';
    const holdMs = 400;

    const holderPromise = holdMonthLock(month, holdMs);
    // Give the holder a moment to actually acquire the lock first (it has no
    // other work before the acquire, so this is generous, not tight).
    await new Promise((resolve) => setTimeout(resolve, 50));

    const start = Date.now();
    const contended = await prisma.$transaction(async (tx) => lockPayrollMonth(tx, month));
    const elapsedMs = Date.now() - start;

    expect(contended).toBe(false);
    // The whole point of `pg_try_advisory_xact_lock`: this must return long
    // before the holder releases (holdMs) — a blocking `pg_advisory_xact_lock`
    // would instead take ~holdMs (minus the 50ms head start) to resolve.
    expect(elapsedMs).toBeLessThan(holdMs / 2);

    await holderPromise;
  });

  it('does not falsely contend against a DIFFERENT month key held concurrently', async () => {
    const holderPromise = holdMonthLock('2026-10', 300);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const acquired = await prisma.$transaction(async (tx) => lockPayrollMonth(tx, '2026-11'));
    expect(acquired).toBe(true);

    await holderPromise;
  });
});

describe('runPayrollDraft / publishPayroll — surface `busy` under contention (Defect 1)', () => {
  it('runPayrollDraft returns a clean `busy` result (not a throw, not a hang) when another transaction holds the month lock', async () => {
    const month = '2026-09';
    const holdMs = 500;
    const holderPromise = holdMonthLock(month, holdMs);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const start = Date.now();
    const result: RunResult = await runPayrollDraft(month);
    const elapsedMs = Date.now() - start;

    expect(result).toEqual({
      calculated: 0,
      calculatedPayrollIds: [],
      frozen: 0,
      skipped: [],
      busy: true,
    });
    // The property that matters (Defect 3): a non-blocking try-lock plus a
    // short bounded retry returns well before the holder releases — not a
    // tight absolute bound (200ms of budgeted sleeps plus round trips) that
    // a slow/loaded CI box can blow through with almost no margin.
    expect(elapsedMs).toBeLessThan(holdMs);

    await holderPromise;
  });

  it('publishPayroll returns a clean `busy` result (not a throw, not a hang) when another transaction holds the month lock', async () => {
    const month = '2026-09';
    const holdMs = 500;
    const holderPromise = holdMonthLock(month, holdMs);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const start = Date.now();
    const result: PublishResult = await publishPayroll(month);
    const elapsedMs = Date.now() - start;

    expect(result).toEqual({ published: [], skipped: [], blocked: [], busy: true });
    // Same reasoning as the runPayrollDraft case above (Defect 3): assert
    // that it returned well before the holder released, not a tight
    // absolute millisecond bound.
    expect(elapsedMs).toBeLessThan(holdMs);

    await holderPromise;
  });

  it('runPayrollDraft succeeds normally once the contended lock is released', async () => {
    const month = '2026-09';
    await holdMonthLock(month, 100);

    const result = await runPayrollDraft(month);
    expect(result.busy).toBeUndefined();
    expect(result.calculated).toBe(0); // no employees seeded — just proving a clean, non-busy run
  });
});
