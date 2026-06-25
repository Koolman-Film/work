import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getOrRenderPayslipPdf, invalidatePayslipPdf } from '@/lib/payslip/storage';

const EID = '00000000-0000-0000-0000-0000000000aa';
const MONTH = '2026-06';
const fakePdf = () => Promise.resolve(Buffer.from('%PDF-1.4 test'));

beforeAll(async () => {
  const { error } = await getSupabaseAdminClient().storage.createBucket('payslips', {
    public: false,
  });
  if (error && !/exist/i.test(error.message)) throw error; // ignore "already exists"
});

describe('payslip storage cache', () => {
  it('renders on miss then serves from cache on hit', async () => {
    await invalidatePayslipPdf(EID, MONTH);
    let rendered = 0;
    const render = () => {
      rendered++;
      return fakePdf();
    };
    const a = await getOrRenderPayslipPdf({ employeeId: EID, month: MONTH, render });
    expect(a.fromCache).toBe(false);
    expect(a.signedUrl).toContain('token=');
    const b = await getOrRenderPayslipPdf({ employeeId: EID, month: MONTH, render });
    expect(b.fromCache).toBe(true);
    expect(rendered).toBe(1);
    await invalidatePayslipPdf(EID, MONTH);
  });
  it('invalidate removes the cached object so the next call re-renders', async () => {
    const EID2 = '00000000-0000-0000-0000-0000000000ab';
    let rendered = 0;
    const render = () => {
      rendered++;
      return Promise.resolve(Buffer.from('%PDF-1.4 x'));
    };
    await getOrRenderPayslipPdf({ employeeId: EID2, month: MONTH, render }); // miss → 1
    await invalidatePayslipPdf(EID2, MONTH);
    await getOrRenderPayslipPdf({ employeeId: EID2, month: MONTH, render }); // miss again → 2
    expect(rendered).toBe(2);
    await invalidatePayslipPdf(EID2, MONTH);
  });

  afterAll(async () => {
    await invalidatePayslipPdf(EID, MONTH);
  });
});
