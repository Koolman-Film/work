import { getSupabaseAdminClient } from '@/lib/supabase/admin';

const BUCKET = 'payslips';
const TTL = 60 * 5;
const keyFor = (employeeId: string, month: string) => `${employeeId}/${month}.pdf`;

export async function getOrRenderPayslipPdf(args: {
  employeeId: string;
  month: string;
  render: () => Promise<Buffer>;
}): Promise<{ signedUrl: string; fromCache: boolean }> {
  const supabase = getSupabaseAdminClient();
  const key = keyFor(args.employeeId, args.month);

  const sign = async () => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(key, TTL, { download: true });
    if (error || !data) throw error ?? new Error('sign failed');
    return data.signedUrl;
  };

  // Probe: list the exact object to detect a cache hit.
  const { data: list } = await supabase.storage
    .from(BUCKET)
    .list(args.employeeId, { search: `${args.month}.pdf` });
  if (list?.some((f) => f.name === `${args.month}.pdf`)) {
    return { signedUrl: await sign(), fromCache: true };
  }

  const buf = await args.render();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, buf, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return { signedUrl: await sign(), fromCache: false };
}

export async function invalidatePayslipPdf(employeeId: string, month: string): Promise<void> {
  await getSupabaseAdminClient().storage.from(BUCKET).remove([keyFor(employeeId, month)]);
}
