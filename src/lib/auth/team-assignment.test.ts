import { describe, expect, it } from 'vitest';
import { parseAssignmentRows } from './team-assignment';

describe('parseAssignmentRows', () => {
  it('zips role+branch, maps global→null', () => {
    const r = parseAssignmentRows(['r1', 'r2'], ['global', 'b1']);
    expect(r).toEqual({
      ok: true,
      assignments: [
        { roleId: 'r1', branchId: null },
        { roleId: 'r2', branchId: 'b1' },
      ],
    });
  });
  it('dedupes identical (role,branch) pairs', () => {
    const r = parseAssignmentRows(['r1', 'r1'], ['b1', 'b1']);
    expect(r).toEqual({ ok: true, assignments: [{ roleId: 'r1', branchId: 'b1' }] });
  });
  it('drops empty-role rows', () => {
    const r = parseAssignmentRows(['', 'r1'], ['global', 'b1']);
    expect(r).toEqual({ ok: true, assignments: [{ roleId: 'r1', branchId: 'b1' }] });
  });
  it('errors when no valid rows', () => {
    expect(parseAssignmentRows([''], ['global'])).toEqual({
      ok: false,
      error: 'กรุณาเลือกบทบาทอย่างน้อยหนึ่งรายการ',
    });
  });
  it('errors on length mismatch', () => {
    expect(parseAssignmentRows(['r1'], [])).toEqual({ ok: false, error: 'ข้อมูลบทบาทไม่ถูกต้อง' });
  });
});
