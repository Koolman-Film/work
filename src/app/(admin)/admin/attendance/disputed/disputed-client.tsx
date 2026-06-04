'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import { DisputeMap } from '@/components/map/dispute-map-dynamic';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { approveDisputed, rejectDisputed } from '@/lib/attendance/admin-review';

export type DisputedVM = {
  id: string;
  name: string;
  nickname: string | null;
  branchLabel: string;
  clockInLabel: string;
  reason: string;
  selfieUrl: string | null;
  empLat: number | null;
  empLng: number | null;
  branch: { name: string; lat: number; lng: number; radiusMeters: number } | null;
  distanceMeters: number | null;
};

export function DisputedClient({ rows }: { rows: DisputedVM[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noteId = useId();

  // Keep the selection valid as the list shrinks after each decision.
  useEffect(() => {
    if (rows.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!rows.some((r) => r.id === selectedId)) setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  function select(id: string) {
    setSelectedId(id);
    setNote('');
    setError(null);
  }

  function decide(kind: 'approve' | 'reject') {
    if (!selected) return;
    if (!note.trim()) {
      setError('กรุณาระบุหมายเหตุการตัดสินใจ');
      return;
    }
    setError(null);
    startTransition(async () => {
      const fn = kind === 'approve' ? approveDisputed : rejectDisputed;
      const r = await fn({ attendanceId: selected.id, note: note.trim() });
      if (r.ok) {
        setNote('');
        router.refresh();
      } else {
        setError(r.message);
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
      {/* Master list */}
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const on = r.id === selectedId;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => select(r.id)}
                aria-current={on ? 'true' : undefined}
                className={`block w-full rounded-lg border px-3 py-2.5 text-left transition ${
                  on
                    ? 'border-primary-200 bg-primary-50 ring-1 ring-primary-200'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink-1">
                    {r.name}
                    {r.nickname && <span className="text-ink-3"> ({r.nickname})</span>}
                  </span>
                  <span className="text-ink-4">›</span>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  เช็คอิน {r.clockInLabel}
                  {r.distanceMeters != null && ` · นอก ${r.distanceMeters} ม.`}
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Detail */}
      {selected ? (
        <div className="surface space-y-4 p-5 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center gap-2">
            <StatusBadge status="pending">⏳ ต้องตรวจสอบ</StatusBadge>
            <span className="text-sm font-medium text-ink-1">
              {selected.name}
              {selected.nickname && <span className="text-ink-3"> ({selected.nickname})</span>}
            </span>
          </div>
          <p className="text-xs text-ink-3">
            {selected.branchLabel} — เช็คอิน {selected.clockInLabel}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-ink-4">เซลฟี่ตอนเช็คอิน</p>
              {selected.selfieUrl ? (
                <a href={selected.selfieUrl} target="_blank" rel="noopener noreferrer">
                  {/* biome-ignore lint/performance/noImgElement: signed-URL preview */}
                  <img
                    src={selected.selfieUrl}
                    alt="เซลฟี่ตอนเช็คอิน"
                    className="h-56 w-full rounded-lg border border-gray-200 object-cover"
                  />
                </a>
              ) : (
                <div className="grid h-56 place-items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-xs text-ink-4">
                  ไม่มีเซลฟี่
                </div>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-ink-4">ตำแหน่ง vs สาขา</p>
              {selected.branch && selected.empLat != null && selected.empLng != null ? (
                <DisputeMap
                  branch={selected.branch}
                  employee={{ lat: selected.empLat, lng: selected.empLng }}
                />
              ) : (
                <div className="grid h-56 place-items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-xs text-ink-4">
                  ไม่มีข้อมูลตำแหน่ง
                </div>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-gray-50 p-4 text-sm">
            <div>
              <dt className="text-xs text-ink-4">ระยะจากสาขา</dt>
              <dd className="font-medium text-ink-1">
                {selected.distanceMeters != null ? `${selected.distanceMeters} ม.` : '—'}
                {selected.branch && (
                  <span className="text-ink-3"> (รัศมี {selected.branch.radiusMeters} ม.)</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-4">เหตุผลระบบ</dt>
              <dd className="text-ink-2">{selected.reason}</dd>
            </div>
          </dl>

          {selected.empLat != null && selected.empLng != null && (
            <a
              href={`https://www.google.com/maps?q=${selected.empLat},${selected.empLng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs font-medium text-primary-700 underline hover:text-primary-800"
            >
              เปิดใน Google Maps →
            </a>
          )}

          <div>
            <label htmlFor={noteId} className="block text-xs font-medium text-ink-2">
              หมายเหตุการตัดสินใจ <span className="text-danger">*</span>
            </label>
            <textarea
              id={noteId}
              value={note}
              disabled={pending}
              onChange={(ev) => setNote(ev.target.value)}
              rows={2}
              placeholder="เช่น: ยืนยันตัวตนจากเซลฟี่ / ปฏิเสธ — ไม่ตรงสถานที่"
              className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
            {error && (
              <p role="alert" className="mt-1 text-xs font-medium text-danger-deep">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="reject"
              size="sm"
              onClick={() => decide('reject')}
              disabled={pending}
            >
              {pending ? '…' : 'ไม่อนุมัติ'}
            </Button>
            <Button
              type="button"
              variant="approve"
              size="sm"
              onClick={() => decide('approve')}
              disabled={pending}
            >
              {pending ? '…' : 'อนุมัติเป็นปกติ'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="surface grid place-items-center p-10 text-sm text-ink-3">
          เลือกรายการจากด้านซ้าย
        </div>
      )}
    </div>
  );
}
