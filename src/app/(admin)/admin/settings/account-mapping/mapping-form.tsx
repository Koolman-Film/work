'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JOURNAL_LINE_LABEL, JOURNAL_LINE_ORDER } from '@/lib/accounting/labels';
import { type MappingState, saveAccountMapping } from './actions';

/** Debit kinds come first in JOURNAL_LINE_ORDER; the split is shown so an
 *  accountant can sanity-check the shape of the entry at a glance. */
const FIRST_CREDIT = 'SsoPayable';

export function MappingForm({
  branchId,
  initial,
}: {
  branchId: string;
  initial: Record<string, { accountCode: string; accountName: string | null }>;
}) {
  const [state, action, pending] = useActionState<MappingState, FormData>(saveAccountMapping, {
    ok: false,
  });

  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="branchId" value={branchId} />

      <div className="surface overflow-hidden !p-0">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted/60 text-left font-display text-xs font-semibold text-ink-3">
            <tr>
              <th className="px-4 py-3">รายการ</th>
              <th className="px-4 py-3">รหัสบัญชี</th>
              <th className="px-4 py-3">ชื่อบัญชี (ไม่บังคับ)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-color)]">
            {JOURNAL_LINE_ORDER.map((kind) => (
              <tr key={kind} className={kind === FIRST_CREDIT ? 'border-t-2 border-line' : ''}>
                <td className="px-4 py-2.5 text-ink-2">
                  {JOURNAL_LINE_LABEL[kind]}
                  <span className="ml-2 text-xs text-ink-4">
                    {JOURNAL_LINE_ORDER.indexOf(kind) < JOURNAL_LINE_ORDER.indexOf(FIRST_CREDIT)
                      ? 'เดบิต'
                      : 'เครดิต'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <Input
                    name={`code.${kind}`}
                    defaultValue={initial[kind]?.accountCode ?? ''}
                    maxLength={40}
                    placeholder="เช่น 5100"
                    className="max-w-[10rem]"
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    name={`name.${kind}`}
                    defaultValue={initial[kind]?.accountName ?? ''}
                    maxLength={120}
                    placeholder="เช่น เงินเดือน"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'กำลังบันทึก…' : 'บันทึกผังบัญชี'}
        </Button>
        {state.ok && <span className="text-sm text-success-deep">บันทึกแล้ว</span>}
        {state.error && <span className="text-sm text-danger-deep">{state.error}</span>}
      </div>
      <p className="mt-2 text-xs text-ink-4">
        เว้นว่างไว้ = ยังไม่ผูกบัญชี — รายการที่ไม่มียอดในเดือนนั้นไม่จำเป็นต้องผูก
      </p>
    </form>
  );
}
