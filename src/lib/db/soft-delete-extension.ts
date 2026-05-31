import { Prisma } from '@prisma/client';

/**
 * Backstop filter: excludes voided rows from top-level reads on the three
 * soft-deletable models. This is defence-in-depth — load-bearing read sites
 * (payroll, balance, lists) ALSO add explicit `deletedAt: null`, because this
 * extension does NOT filter nested `include`d relations (a known Prisma
 * limitation). See spec §5.
 *
 * Bypass: code that must SEE voided rows (void/restore actions, trash views)
 * uses `prismaRaw` from ./prisma, which is unextended.
 */
const SOFT_DELETE_MODELS = new Set(['Attendance', 'LeaveRequest', 'CashAdvance']);
const READ_OPS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate']);

export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete-filter',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (model && SOFT_DELETE_MODELS.has(model) && READ_OPS.has(operation)) {
          const a = (args ?? {}) as { where?: Record<string, unknown> };
          a.where = { ...a.where, deletedAt: a.where?.deletedAt ?? null };
          return query(a);
        }
        return query(args);
      },
    },
  },
});
