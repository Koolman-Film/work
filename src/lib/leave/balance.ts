import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from './leave-config';
import { penaltyMinutes, penaltyMinutesBy } from './penalty-minutes';
import { standardDayMinutes } from './units';

/** Transaction client compatible with both the extended `prisma` client and a
 *  plain `Prisma.TransactionClient`. Mirrors the pattern used in audit/log.ts. */
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type EntitlementForBalance = {
  grantedMinutes: number | null;
  carryoverMinutes: number;
  adjustmentMinutes: number;
};

/** Remaining minutes = (granted) + carryover + adjustment − used − penalty.
 *  Returns null when granted is null (unlimited — no cap, no warning).
 *  May be negative.
 *
 *  `penalty` is REQUIRED, not optional with a zero default, on purpose. This
 *  function has five call sites; an optional parameter lets one of them be
 *  missed, and a missed call site reports a balance that is too high — the
 *  employee is then allowed to book leave they no longer have, silently. A
 *  required parameter turns that mistake into a compile error. */
export function remainingMinutes(
  ent: EntitlementForBalance,
  used: number,
  penalty: number,
): number | null {
  if (ent.grantedMinutes == null) return null;
  return ent.grantedMinutes + ent.carryoverMinutes + ent.adjustmentMinutes - used - penalty;
}

/** The effective grant for a type: the entitlement's grant if a row exists
 *  (which may itself be null = unlimited), else the type's annualQuota × std
 *  (null quota = unlimited). Pure. */
export function resolveGrantedMinutes(
  annualQuota: number | null,
  entitlement: { grantedMinutes: number | null } | null,
  std: number,
): number | null {
  if (entitlement) return entitlement.grantedMinutes;
  return annualQuota == null ? null : annualQuota * std;
}

/** Σ chargedMinutes of an employee's Approved, non-deleted leave of one type,
 *  bucketed by the request's startDate year. (Year-spanning multi-day leave
 *  counts wholly in its start year — documented limitation.)
 *
 *  Accepts an optional `db` param (a Prisma transaction client) so callers
 *  inside a transaction can reuse the same client and participate in advisory
 *  locks / consistent reads. Defaults to the module-level `prisma` client. */
export async function usedMinutes(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  db: TxClient = prisma,
): Promise<number> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const rows = await db.leaveRequest.findMany({
    where: {
      employeeId,
      leaveTypeId,
      status: 'Approved',
      deletedAt: null,
      startDate: { gte: start, lt: end },
    },
    select: { chargedMinutes: true },
  });
  return rows.reduce((sum, r) => sum + (r.chargedMinutes ?? 0), 0);
}

export type EntitlementRow = {
  leaveTypeId: string;
  leaveTypeName: string;
  grantedMinutes: number | null;
  carryoverMinutes: number;
  adjustmentMinutes: number;
  note: string | null;
  usedMinutes: number;
  remainingMinutes: number | null;
};

/**
 * Leave type ids with a LIVE (non-deleted) AttendancePenaltySettlement for
 * one of these employees in this leave year — regardless of the type's own
 * archive status.
 *
 * Defect 4 (leave-types/actions.ts's `archiveLeaveType`): archiving a leave
 * type is allowed once every settlement referencing it is in a CLOSED
 * (Published/Locked) payroll month — see that function's comment for why a
 * settlement in an open month can't be required to clear first. But
 * `penalty-settlement-load.ts` (which feeds the published slip) has no
 * archived filter, so a closed month's settlement keeps applying its money
 * offset forever, archived or not — the entitlement side must keep matching
 * that. The three balance readers below (`getOrSeedEntitlements`,
 * `remainingByTypeForEmployees`, `remainingByTypeForEmployee`) each
 * enumerate leave types filtered on `archivedAt: null` before subtracting
 * `penaltyMinutes` in their loop; without this, archiving drops the type
 * from that enumeration entirely, and its already-spent minutes stop being
 * subtracted from the balance the moment it's archived — an entitlement
 * refund nobody asked for. Union this function's ids into that enumeration
 * (see each call site) so an archived type stays counted for exactly the
 * employees/years it still has a live settlement against, and only those.
 *
 * Returns a per-employee mapping (employeeId → set of leaveTypeIds), not a
 * flat union — a batch caller (`remainingByTypeForEmployees`) must apply an
 * archived type only to the specific employees that have a live settlement
 * for it, not to every employee in the batch. A flat list would let an
 * employee with no settlement pick up a full-quota entry for a type they
 * never touched.
 */
async function settledLeaveTypeIds(
  employeeIds: readonly string[],
  year: number,
  db: TxClient = prisma,
): Promise<Map<string, Set<string>>> {
  const byEmployee = new Map<string, Set<string>>();
  if (employeeIds.length === 0) return byEmployee;
  const rows = await db.attendancePenaltySettlement.findMany({
    where: { employeeId: { in: [...employeeIds] }, periodYear: year, deletedAt: null },
    select: { employeeId: true, leaveTypeId: true },
    distinct: ['employeeId', 'leaveTypeId'],
  });
  for (const r of rows) {
    let set = byEmployee.get(r.employeeId);
    if (!set) {
      set = new Set<string>();
      byEmployee.set(r.employeeId, set);
    }
    set.add(r.leaveTypeId);
  }
  return byEmployee;
}

/** Ensure an entitlement row exists for every active leave type for this
 *  employee/year (seeded from annualQuota × std), then return the rows
 *  enriched with used + remaining. Idempotent; NOT audit-logged (seeding the
 *  policy default is not a manual change — only edits via upsertEntitlement
 *  are audited). */
export async function getOrSeedEntitlements(
  employeeId: string,
  year: number,
): Promise<EntitlementRow[]> {
  const std = standardDayMinutes(await getLeaveConfig());
  const types = await prisma.leaveType.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, annualQuota: true },
  });
  const existing = await prisma.leaveEntitlement.findMany({
    where: { employeeId, periodYear: year },
    select: { leaveTypeId: true },
  });
  const have = new Set(existing.map((e) => e.leaveTypeId));
  const toCreate = types
    .filter((t) => !have.has(t.id))
    .map((t) => ({
      employeeId,
      leaveTypeId: t.id,
      periodYear: year,
      grantedMinutes: t.annualQuota == null ? null : t.annualQuota * std,
    }));
  if (toCreate.length > 0) {
    await prisma.leaveEntitlement.createMany({ data: toCreate, skipDuplicates: true });
  }

  // Defect 4: keep an archived type's row here when this employee still has
  // a live settlement against it this year — see settledLeaveTypeIds above.
  const settledTypeIds = [
    ...((await settledLeaveTypeIds([employeeId], year)).get(employeeId) ?? []),
  ];

  const ents = await prisma.leaveEntitlement.findMany({
    where: {
      employeeId,
      periodYear: year,
      OR: [{ leaveType: { archivedAt: null } }, { leaveTypeId: { in: settledTypeIds } }],
    },
    orderBy: { leaveType: { name: 'asc' } },
    select: {
      leaveTypeId: true,
      grantedMinutes: true,
      carryoverMinutes: true,
      adjustmentMinutes: true,
      note: true,
      leaveType: { select: { name: true } },
    },
  });

  const rows: EntitlementRow[] = [];
  for (const e of ents) {
    const used = await usedMinutes(employeeId, e.leaveTypeId, year);
    const penalty = await penaltyMinutes(employeeId, e.leaveTypeId, year);
    rows.push({
      leaveTypeId: e.leaveTypeId,
      leaveTypeName: e.leaveType.name,
      grantedMinutes: e.grantedMinutes,
      carryoverMinutes: e.carryoverMinutes,
      adjustmentMinutes: e.adjustmentMinutes,
      note: e.note,
      usedMinutes: used,
      remainingMinutes: remainingMinutes(e, used, penalty),
    });
  }
  return rows;
}

/** Bulk variant of remainingByTypeForEmployee for report pages: one groupBy
 *  for the whole year's used minutes instead of employees × types queries.
 *  Returns employeeId → (leaveTypeId → remaining minutes | null). */
export async function remainingByTypeForEmployees(
  employeeIds: readonly string[],
  year: number,
): Promise<Record<string, Record<string, number | null>>> {
  if (employeeIds.length === 0) return {};

  const std = standardDayMinutes(await getLeaveConfig());
  const activeTypes = await prisma.leaveType.findMany({
    where: { archivedAt: null },
    select: { id: true, annualQuota: true },
  });
  const activeTypeIds = new Set(activeTypes.map((t) => t.id));

  // Defect 4: bring back any archived type that still has a live settlement
  // for one of these employees this year, so its penalty keeps being
  // subtracted for THAT employee — see settledLeaveTypeIds above. Kept
  // per-employee (settledByEmployee), not unioned into one flat list, so the
  // per-employee loop below applies each archived type only to the
  // employees that actually have a live settlement against it — an employee
  // with none must not pick up an entry for it. Fetched as a separate query
  // (rather than folding into `activeTypes`' own filter) because these ids
  // need their own `leaveType.findMany` for `annualQuota` — `activeTypes`'
  // `archivedAt: null` filter would otherwise exclude them.
  const settledByEmployee = await settledLeaveTypeIds(employeeIds, year);
  const archivedIdsNeeded = new Set<string>();
  for (const settledIds of settledByEmployee.values()) {
    for (const id of settledIds) {
      if (!activeTypeIds.has(id)) archivedIdsNeeded.add(id);
    }
  }
  const archivedTypesStillNeeded =
    archivedIdsNeeded.size > 0
      ? await prisma.leaveType.findMany({
          where: { id: { in: [...archivedIdsNeeded] } },
          select: { id: true, annualQuota: true },
        })
      : [];
  const archivedTypesById = new Map(archivedTypesStillNeeded.map((t) => [t.id, t]));

  const ents = await prisma.leaveEntitlement.findMany({
    where: { employeeId: { in: [...employeeIds] }, periodYear: year },
    select: {
      employeeId: true,
      leaveTypeId: true,
      grantedMinutes: true,
      carryoverMinutes: true,
      adjustmentMinutes: true,
    },
  });

  const jan1 = new Date(Date.UTC(year, 0, 1));
  const nextJan1 = new Date(Date.UTC(year + 1, 0, 1));
  // NOTE: groupBy bypasses the soft-delete Prisma extension — the explicit
  // deletedAt: null filter below is load-bearing (not just defence-in-depth).
  const usedRows = await prisma.leaveRequest.groupBy({
    by: ['employeeId', 'leaveTypeId'],
    where: {
      employeeId: { in: [...employeeIds] },
      status: 'Approved',
      deletedAt: null,
      startDate: { gte: jan1, lt: nextJan1 },
    },
    _sum: { chargedMinutes: true },
  });

  // Build lookup: employeeId:leaveTypeId → used minutes
  const usedBy = new Map<string, number>();
  for (const r of usedRows) {
    usedBy.set(`${r.employeeId}:${r.leaveTypeId}`, r._sum.chargedMinutes ?? 0);
  }

  // Build lookup: employeeId:leaveTypeId → entitlement row
  const entBy = new Map<string, (typeof ents)[number]>();
  for (const e of ents) {
    entBy.set(`${e.employeeId}:${e.leaveTypeId}`, e);
  }

  const penaltyBy = await penaltyMinutesBy(employeeIds, year);

  function remainingFor(
    empId: string,
    t: { id: string; annualQuota: number | null },
  ): number | null {
    const ent = entBy.get(`${empId}:${t.id}`) ?? null;
    const granted = resolveGrantedMinutes(t.annualQuota, ent, std);
    const used = usedBy.get(`${empId}:${t.id}`) ?? 0;
    const penalty = penaltyBy.get(`${empId}:${t.id}`) ?? 0;
    return remainingMinutes(
      {
        grantedMinutes: granted,
        carryoverMinutes: ent?.carryoverMinutes ?? 0,
        adjustmentMinutes: ent?.adjustmentMinutes ?? 0,
      },
      used,
      penalty,
    );
  }

  const out: Record<string, Record<string, number | null>> = {};
  for (const empId of employeeIds) {
    const byType: Record<string, number | null> = {};
    // Active types apply to every employee.
    for (const t of activeTypes) {
      byType[t.id] = remainingFor(empId, t);
    }
    // Defect 4: an archived type applies ONLY to the employees that have a
    // live settlement against it this year — not to the whole batch.
    const settledIds = settledByEmployee.get(empId);
    if (settledIds) {
      for (const typeId of settledIds) {
        if (activeTypeIds.has(typeId)) continue; // already covered above
        const t = archivedTypesById.get(typeId);
        if (!t) continue; // settlement references a type row that vanished — defensive only
        byType[t.id] = remainingFor(empId, t);
      }
    }
    out[empId] = byType;
  }
  return out;
}

/** Advisory-lock key shared by every writer that can spend or free a
 *  specific (employee, leaveType, year) entitlement balance —
 *  `approveLeaveRequest` (leave/admin.ts) and `setPenaltySettlement`
 *  (payroll/penalty-settlement-admin.ts). Both MUST derive the key from
 *  this ONE function rather than each formatting their own string: two
 *  independently-written format strings can drift (field order, a stray
 *  separator) and silently stop colliding on the same advisory lock, which
 *  reopens the exact race this exists to close — one side reads the
 *  balance, the other reads it too before either commits, and together
 *  they overdraw it. Must be the FIRST statement in the caller's
 *  transaction that decides what to write, before any read of the balance
 *  it protects — same ordering rule as `lockPayrollMonth`
 *  (payroll/month-lock.ts), and for the same reason: the lock only closes
 *  the race if it's held before the read, not merely held. */
export async function lockEntitlement(
  db: TxClient,
  employeeId: string,
  leaveTypeId: string,
  year: number,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${employeeId}:${leaveTypeId}:${year}`}))`;
}

/** Read-only remaining-per-type for the LIFF form. Does NOT seed rows (an
 *  employee viewing the form shouldn't write). Falls back to the type's
 *  annualQuota default when no entitlement row exists. Returns a record
 *  leaveTypeId → remaining minutes (null = unlimited).
 *
 *  Accepts an optional `db` param (a Prisma transaction client) so a caller
 *  that has already locked rows inside a transaction — e.g.
 *  penalty-settlement-admin.ts's balance check — reads through the same
 *  client instead of a separate, unlocked connection. Defaults to the
 *  module-level `prisma` client for read-only callers. */
export async function remainingByTypeForEmployee(
  employeeId: string,
  year: number,
  db: TxClient = prisma,
): Promise<Record<string, number | null>> {
  const std = standardDayMinutes(await getLeaveConfig());
  // Defect 4: keep an archived type here when this employee still has a live
  // settlement against it this year — see settledLeaveTypeIds above.
  const settledTypeIds = [
    ...((await settledLeaveTypeIds([employeeId], year, db)).get(employeeId) ?? []),
  ];
  const types = await db.leaveType.findMany({
    where: { OR: [{ archivedAt: null }, { id: { in: settledTypeIds } }] },
    select: { id: true, annualQuota: true },
  });
  const ents = await db.leaveEntitlement.findMany({
    where: { employeeId, periodYear: year },
    select: {
      leaveTypeId: true,
      grantedMinutes: true,
      carryoverMinutes: true,
      adjustmentMinutes: true,
    },
  });
  const entByType = new Map(ents.map((e) => [e.leaveTypeId, e]));

  const out: Record<string, number | null> = {};
  for (const t of types) {
    const ent = entByType.get(t.id) ?? null;
    const granted = resolveGrantedMinutes(t.annualQuota, ent, std);
    const used = await usedMinutes(employeeId, t.id, year, db);
    const penalty = await penaltyMinutes(employeeId, t.id, year, db);
    out[t.id] = remainingMinutes(
      {
        grantedMinutes: granted,
        carryoverMinutes: ent?.carryoverMinutes ?? 0,
        adjustmentMinutes: ent?.adjustmentMinutes ?? 0,
      },
      used,
      penalty,
    );
  }
  return out;
}
