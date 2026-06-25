'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { formatTHB2 } from '@/lib/format';
import type { RecomputeResult } from '@/lib/leave/recompute';
import { runLeaveRecompute } from './actions';

function deductCellClass(oldV: number | null, newV: number | null): string {
  const o = oldV ?? 0;
  const n = newV ?? 0;
  if (n > o) return 'text-danger-deep'; // deduction goes up
  if (n < o) return 'text-success-deep'; // deduction goes down
  return 'text-ink-2';
}

export function RecomputePanel() {
  const [result, setResult] = useState<RecomputeResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function preview() {
    setError(null);
    setApplied(false);
    startTransition(async () => {
      try {
        setResult(await runLeaveRecompute(false));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
      }
    });
  }

  function apply() {
    if (!confirm('ยืนยันการแก้ไขการหักวันลาตามที่แสดง? การหักเงินจะถูกอัปเดต')) return;
    setError(null);
    startTransition(async () => {
      try {
        setResult(await runLeaveRecompute(true));
        setApplied(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
      }
    });
  }

  const changes = result?.changes ?? [];
  const applicable = changes.filter((c) => !c.swept);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={preview} disabled={pending} variant="secondary">
          {pending && !applied ? 'กำลังคำนวณ…' : 'ดูตัวอย่าง (Preview)'}
        </Button>
        {result && applicable.length > 0 && !applied && (
          <Button type="button" onClick={apply} disabled={pending}>
            {pending ? 'กำลังบันทึก…' : `ยืนยันแก้ไข ${applicable.length} รายการ`}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-deep">
          {error}
        </p>
      )}

      {applied && (
        <p className="rounded-md bg-success-soft px-3 py-2 text-sm text-success-deep">
          ✓ แก้ไขแล้ว {result?.applied ?? 0} รายการ — อย่าลืมกด “คำนวณใหม่” ในหน้าเงินเดือน
        </p>
      )}

      {result && (
        <>
          <p className="text-sm text-ink-3">
            ตรวจ {result.scanned} รายการ · พบที่ต้องแก้ {changes.length} ({applicable.length} ที่จะแก้,{' '}
            {changes.length - applicable.length} อยู่ในรอบที่จ่ายแล้ว/ข้าม)
          </p>
          {changes.length === 0 ? (
            <p className="text-sm text-ink-4">ไม่มีรายการที่ต้องแก้ — ข้อมูลตรงกันแล้ว</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs text-ink-4">
                  <tr>
                    <th className="px-3 py-2">พนักงาน</th>
                    <th className="px-3 py-2">ประเภท</th>
                    <th className="px-3 py-2">วันที่</th>
                    <th className="px-3 py-2 text-right">ใช้ไป (นาที)</th>
                    <th className="px-3 py-2 text-right">เกินสิทธิ (นาที)</th>
                    <th className="px-3 py-2 text-right">หักเงิน</th>
                    <th className="px-3 py-2"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {changes.map((c) => (
                    <tr key={c.leaveRequestId} className={c.swept ? 'opacity-50' : undefined}>
                      <td className="px-3 py-2">{c.employeeName}</td>
                      <td className="px-3 py-2">{c.leaveTypeName}</td>
                      <td className="px-3 py-2 tabular-nums">{c.date}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.oldChargedMinutes ?? '—'} → {c.newChargedMinutes}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.oldOverMinutes} → {c.newOverMinutes}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-medium ${deductCellClass(c.oldDeduct, c.newDeduct)}`}
                      >
                        {c.oldDeduct == null ? '—' : formatTHB2(c.oldDeduct)} →{' '}
                        {c.newDeduct == null ? '—' : formatTHB2(c.newDeduct)}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-4">
                        {c.swept ? 'จ่ายแล้ว (ข้าม)' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
