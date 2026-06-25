import { describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/(liff)/liff/payslip/pdf/route';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({
    user: { id: '00000000-0000-0000-0000-000000000001' },
    employee: { id: '00000000-0000-0000-0000-000000000002', status: 'Active' },
  })),
}));

describe('GET /liff/payslip/pdf', () => {
  it('400s on a malformed month', async () => {
    const res = await GET(new Request('http://x/liff/payslip/pdf?m=nope'));
    expect(res.status).toBe(400);
  });
  it('404s when the employee has no published slip for the month', async () => {
    const res = await GET(new Request('http://x/liff/payslip/pdf?m=2099-01'));
    expect(res.status).toBe(404);
  });
});
