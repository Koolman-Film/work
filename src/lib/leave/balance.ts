import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from './leave-config';
import { standardDayMinutes } from './units';

/** Transaction client compatible with both the extended `prisma` client and a
 *  plain `Prisma.TransactionClient`. Mirrors the pattern used in audit/log.ts. */
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type EntitlementForBalance = {
  grantedMinutes: number | null;
  carryoverMinutes: number;
  adjustmentMinutes: number;
};

/** Remaining minutes = (granted) + carryover + adjustment − used. Returns null
 *  when granted is null (unlimited — no cap, no warning). May be negative. */
export function remainingMinutes(ent: EntitlementForBalance, used: number): number | null {
  if (ent.grantedMinutes == null) return null;
  return ent.grantedMinutes + ent.carryoverMinutes + ent.adjustmentMinutes - used;
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

  const ents = await prisma.leaveEntitlement.findMany({
    where: { employeeId, periodYear: year, leaveType: { archivedAt: null } },
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
    rows.push({
      leaveTypeId: e.leaveTypeId,
      leaveTypeName: e.leaveType.name,
      grantedMinutes: e.grantedMinutes,
      carryoverMinutes: e.carryoverMinutes,
      adjustmentMinutes: e.adjustmentMinutes,
      note: e.note,
      usedMinutes: used,
      remainingMinutes: remainingMinutes(e, used),
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
  const types = await prisma.leaveType.findMany({
    where: { archivedAt: null },
    select: { id: true, annualQuota: true },
  });
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

  const out: Record<string, Record<string, number | null>> = {};
  for (const empId of employeeIds) {
    const byType: Record<string, number | null> = {};
    for (const t of types) {
      const ent = entBy.get(`${empId}:${t.id}`) ?? null;
      const granted = resolveGrantedMinutes(t.annualQuota, ent, std);
      const used = usedBy.get(`${empId}:${t.id}`) ?? 0;
      byType[t.id] = remainingMinutes(
        {
          grantedMinutes: granted,
          carryoverMinutes: ent?.carryoverMinutes ?? 0,
          adjustmentMinutes: ent?.adjustmentMinutes ?? 0,
        },
        used,
      );
    }
    out[empId] = byType;
  }
  return out;
}

/** Read-only remaining-per-type for the LIFF form. Does NOT seed rows (an
 *  employee viewing the form shouldn't write). Falls back to the type's
 *  annualQuota default when no entitlement row exists. Returns a record
 *  leaveTypeId → remaining minutes (null = unlimited). */
export async function remainingByTypeForEmployee(
  employeeId: string,
  year: number,
): Promise<Record<string, number | null>> {
  const std = standardDayMinutes(await getLeaveConfig());
  const types = await prisma.leaveType.findMany({
    where: { archivedAt: null },
    select: { id: true, annualQuota: true },
  });
  const ents = await prisma.leaveEntitlement.findMany({
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
    const used = await usedMinutes(employeeId, t.id, year);
    out[t.id] = remainingMinutes(
      {
        grantedMinutes: granted,
        carryoverMinutes: ent?.carryoverMinutes ?? 0,
        adjustmentMinutes: ent?.adjustmentMinutes ?? 0,
      },
      used,
    );
  }
  return out;
}
