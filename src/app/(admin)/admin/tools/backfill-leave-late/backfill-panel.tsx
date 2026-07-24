'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { BackfillReport } from '@/lib/attendance/backfill-leave-late';
import { runBackfillLeaveLateRows } from './actions';

const ACTION_LABEL: Record<string, string> = {
  delete: 'ลบ (สายทั้งหมดเป็นของปลอม)',
  lower: 'ลดนาทีสาย',
  'skip-finalized': 'ข้าม — ปิดงวดเงินเดือนแล้ว',
  'missing-checkin': 'ข้าม — ไม่พบเวลาเช็คอิน',
};

const ACTION_CLASS: Record<string, string> = {
  delete: 'text-success-deep',
  lower: 'text-success-deep',
  'skip-finalized': 'text-ink-4',
  'missing-checkin': 'text-ink-4',
};

export function BackfillPanel() {
  const [report, setReport] = useState<BackfillReport | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function preview() {
    setError(null);
    setApplied(false);
    startTransition(async () => {
      try {
        setReport(await runBackfillLeaveLateRows(false));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
      }
    });
  }

  function apply() {
    const n = (report?.counts.delete ?? 0) + (report?.counts.lower ?? 0);
    if (!confirm(`ยืนยันแก้ไข "มาสาย" ${n} รายการตามที่แสดง? การกระทำนี้ย้อนกลับไม่ได้ทันที`)) return;
    setError(null);
    startTransition(async () => {
      try {
        setReport(await runBackfillLeaveLateRows(true));
        setApplied(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
      }
    });
  }

  const changes = report?.changes ?? [];
  const applicable = changes.filter((c) => c.action === 'delete' || c.action === 'lower');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={preview} disabled={pending} variant="secondary">
          {pending && !applied ? 'กำลังตรวจ…' : 'ดูตัวอย่าง (Preview)'}
        </Button>
        {report && applicable.length > 0 && !applied && (
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
          ✓ แก้ไขแล้ว {(report?.counts.delete ?? 0) + (report?.counts.lower ?? 0)} รายการ
        </p>
      )}

      {report && (
        <>
          <p className="text-sm text-ink-3">
            พบ {changes.length} รายการที่มีทั้งใบลาอนุมัติแล้วและ "มาสาย" ในวันเดียวกัน — จะแก้{' '}
            {applicable.length} รายการ, ข้าม {changes.length - applicable.length} รายการ
          </p>
          {changes.length === 0 ? (
            <p className="text-sm text-ink-4">ไม่พบรายการที่ต้องแก้ — ข้อมูลถูกต้องแล้ว</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs text-ink-4">
                  <tr>
                    <th className="px-3 py-2">พนักงาน (id)</th>
                    <th className="px-3 py-2">วันที่</th>
                    <th className="px-3 py-2 text-right">สาย (นาที) เดิม → ใหม่</th>
                    <th className="px-3 py-2">การกระทำ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {changes.map((c) => (
                    <tr key={c.attendanceId}>
                      <td className="px-3 py-2 font-mono text-xs">{c.employeeId}</td>
                      <td className="px-3 py-2 tabular-nums">{c.date}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.storedMinutes} → {c.recomputedMinutes}
                      </td>
                      <td className={`px-3 py-2 text-xs font-medium ${ACTION_CLASS[c.action]}`}>
                        {ACTION_LABEL[c.action]}
                        {c.action === 'skip-finalized' && c.payrollStatus
                          ? ` (${c.payrollStatus})`
                          : ''}
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
