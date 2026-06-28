export type ParsedAssignment = { roleId: string; branchId: string | null };
export type ParseResult =
  | { ok: true; assignments: ParsedAssignment[] }
  | { ok: false; error: string };

/** Zip aligned roleId[]/branchId[] form arrays into deduped assignment rows.
 *  'global' branch maps to null. Empty-role rows are dropped. */
export function parseAssignmentRows(roleIds: string[], branchIds: string[]): ParseResult {
  if (roleIds.length !== branchIds.length) {
    return { ok: false, error: 'ข้อมูลบทบาทไม่ถูกต้อง' };
  }
  const seen = new Set<string>();
  const assignments: ParsedAssignment[] = [];
  for (let i = 0; i < roleIds.length; i++) {
    const roleId = roleIds[i]?.trim();
    if (!roleId) continue;
    const raw = branchIds[i] ?? 'global';
    const branchId = raw === 'global' ? null : raw;
    const key = `${roleId}::${branchId ?? 'global'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assignments.push({ roleId, branchId });
  }
  if (assignments.length === 0) {
    return { ok: false, error: 'กรุณาเลือกบทบาทอย่างน้อยหนึ่งรายการ' };
  }
  return { ok: true, assignments };
}
