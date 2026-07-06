import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilterParams = {
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string; // 'YYYY-MM-DD', interpreted in Asia/Bangkok
  dateTo?: string; // 'YYYY-MM-DD', inclusive
};

export type AuditRow = Prisma.AuditLogGetPayload<Record<string, never>>;

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrUndefined(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && UUID_RE.test(t) ? t : undefined;
}

/** Pure: build a Prisma where-clause from parsed filter params. */
export function buildAuditWhere(p: AuditFilterParams): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  const actor = uuidOrUndefined(p.actor);
  const action = clean(p.action);
  const entityType = clean(p.entityType);
  const entityId = uuidOrUndefined(p.entityId);
  const from = clean(p.dateFrom);
  const to = clean(p.dateTo);

  if (actor) where.actorId = actor;
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;

  const range: Prisma.DateTimeFilter = {};
  if (from) {
    const gte = new Date(`${from}T00:00:00+07:00`);
    if (!Number.isNaN(gte.getTime())) range.gte = gte;
  }
  if (to) {
    const lte = new Date(`${to}T23:59:59.999+07:00`);
    if (!Number.isNaN(lte.getTime())) range.lte = lte;
  }
  if (range.gte || range.lte) where.createdAt = range;

  return where;
}

/**
 * Keyset page over AuditLog, newest first. Fetches PAGE_SIZE+1 to detect a next
 * page; returns the id of the last row as the next cursor (or null at the end).
 */
export async function fetchAuditPage(
  where: Prisma.AuditLogWhereInput,
  cursorId?: string,
): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: AUDIT_PAGE_SIZE + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });
  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;
  // hasMore implies page.length === AUDIT_PAGE_SIZE (> 0), so the last element exists.
  return { rows: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

/** Bulk-resolve actor ids to display names. Nulls are skipped (caller shows 'ระบบ'). */
export async function resolveActors(actorIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(actorIds.filter((v): v is string => v !== null)));
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
  });
  return new Map(
    users.map((u) => [
      u.id,
      u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : (u.email ?? u.id.slice(0, 8)),
    ]),
  );
}
