'use client';

import { useState, useTransition } from 'react';
import {
  type CorrectionPreview,
  correctLeaveType,
  previewLeaveTypeCorrection,
} from '@/lib/leave/correct-type';

type TypeOption = { id: string; name: string };

export function CorrectTypeSection({
  leaveRequestId,
  currentTypeId,
  options,
  onDone,
}: {
  leaveRequestId: string;
  currentTypeId: string;
  options: TypeOption[];
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CorrectionPreview | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const targets = options.filter((o) => o.id !== currentTypeId);

  function choose(id: string) {
    setTargetId(id);
    setPreview(null);
    setError(null);
    start(async () => setPreview(await previewLeaveTypeCorrection(leaveRequestId, id)));
  }

  function confirm() {
    if (!targetId) return;
    start(async () => {
      const r = await correctLeaveType({ leaveRequestId, newLeaveTypeId: targetId, note });
      if (r.ok) {
        setOpen(false);
        onDone?.();
      } else {
        setError(r.message);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-primary-600 hover:text-primary-700"
      >
        เปลี่ยนประเภทการลา
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3">
      <p className="text-xs font-medium text-ink-4">เปลี่ยนเป็นประเภท</p>
      <div className="flex flex-wrap gap-2">
        {targets.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => choose(o.id)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              targetId === o.id
                ? 'border-primary-600 bg-primary-50 text-primary-700'
                : 'border-gray-300 text-ink-2'
            }`}
          >
            {o.name}
          </button>
        ))}
      </div>

      {pending && !preview && <p className="text-sm text-ink-4">กำลังคำนวณ…</p>}

      {preview?.ok && (
        <div className="space-y-2 rounded-md bg-gray-50 p-3 text-sm">
          <p className="font-medium text-ink-1">
            {preview.oldTypeName} → {preview.newTypeName}
          </p>
          <ul className="space-y-1">
            {preview.ripple.displayRows.map((row) => (
              <li key={row.leaveRequestId} className="flex justify-between text-ink-2">
                <span>{row.group === 'moved' ? 'ใบนี้' : 'ใบเกี่ยวเนื่อง'}</span>
                <span>
                  ฿{(row.oldDeduct ?? 0).toLocaleString('th-TH')} → ฿
                  {(row.newDeduct ?? 0).toLocaleString('th-TH')}
                </span>
              </li>
            ))}
          </ul>
          <p
            className={`font-medium ${preview.ripple.netDeductDelta <= 0 ? 'text-green-700' : 'text-red-700'}`}
          >
            รวมการหักเงินเปลี่ยน: ฿{preview.ripple.netDeductDelta.toLocaleString('th-TH')}
          </p>
        </div>
      )}

      {preview && !preview.ok && <p className="text-sm text-red-700">{preview.message}</p>}

      {preview?.ok && (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เหตุผลการแก้ประเภท (บังคับ)"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            rows={2}
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-ink-2"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending || note.trim() === ''}
              className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              ยืนยันการแก้ประเภท
            </button>
          </div>
        </>
      )}
    </div>
  );
}
