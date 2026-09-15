'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { JOURNAL_LINE_ORDER } from '@/lib/accounting/labels';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

const KINDS = JOURNAL_LINE_ORDER;

const Schema = z.object({
  branchId: z.string().uuid(),
  // Blank clears the mapping. `.trim()` matters: a code of " " would satisfy a
  // non-empty check and then post to an account that does not exist.
  codes: z.record(z.string(), z.string().trim().max(40)),
  names: z.record(z.string(), z.string().trim().max(120)),
});

export type MappingState = { ok: boolean; error?: string };

export async function saveAccountMapping(
  _prev: MappingState,
  formData: FormData,
): Promise<MappingState> {
  const { user } = await requirePermission('accounting.map');

  const branchId = String(formData.get('branchId') ?? '');
  const codes: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const kind of KINDS) {
    codes[kind] = String(formData.get(`code.${kind}`) ?? '');
    names[kind] = String(formData.get(`name.${kind}`) ?? '');
  }

  const parsed = Schema.safeParse({ branchId, codes, names });
  if (!parsed.success) return { ok: false, error: 'ข้อมูลไม่ถูกต้อง' };

  // Branch scope is not decoration here: a wrong account code silently
  // misposts every future month, so who may set one is a real boundary.
  const permitted = await getPermittedBranches(user, 'accounting.map');
  if (permitted !== 'all' && !permitted.includes(parsed.data.branchId)) {
    return { ok: false, error: 'ไม่มีสิทธิ์เข้าถึงสาขานี้' };
  }

  await prisma.$transaction(async (tx) => {
    for (const kind of KINDS) {
      const code = parsed.data.codes[kind] ?? '';
      const name = parsed.data.names[kind] ?? '';
      if (!code) {
        // Blank means "not mapped". Delete rather than store an empty string,
        // so the export's own "is this mapped?" check stays a null check.
        await tx.accountMapping.deleteMany({
          where: { branchId: parsed.data.branchId, lineKind: kind },
        });
        continue;
      }
      await tx.accountMapping.upsert({
        where: { branchId_lineKind: { branchId: parsed.data.branchId, lineKind: kind } },
        create: {
          branchId: parsed.data.branchId,
          lineKind: kind,
          accountCode: code,
          accountName: name || null,
        },
        update: { accountCode: code, accountName: name || null },
      });
    }
  });

  revalidatePath('/admin/settings/account-mapping');
  revalidatePath('/admin/accounting');
  return { ok: true };
}
