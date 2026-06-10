'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DisputeMap } from '@/components/map/dispute-map-dynamic';
import { Button } from '@/components/ui/button';
import { ReviewModal } from '@/components/ui/review-modal';
import { restoreAttendance, voidAttendance } from '@/lib/attendance/void';
import type { AttendanceRowVM } from './attendance-row-vm';

/**
 * Detail modal for one attendance record. `row === null` keeps it closed.
 * Body mirrors the disputed-inbox detail pane (selfie + geofence map +
 * facts grid); the footer carries the row's mutation — void with reason
 * (live view, via ReviewModal's built-in step) or one-tap restore (trash).
 */
export function AttendanceDetailModal({
  row,
  isTrash,
  onClose,
}: {
  row: AttendanceRowVM | null;
  isTrash: boolean;
  onClose: () => void;
}) {
  const hasEvidence = row?.type === 'CheckIn' && (row.selfieUrl || row.empLat != null);

  return (
    <ReviewModal
      open={row !== null}
      onClose={onClose}
      title="รายละเอียดการลงเวลา"
      panelClassName={hasEvidence ? 'sm:max-w-2xl' : undefined}
      onVoid={!isTrash && row ? (reason) => voidAttendance(row.id, reason) : undefined}
    >
      {row && (
        <div className="space-y-4">
          {/* Who + what + when */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${row.typeCls}`}>
                {row.typeLabel}
              </span>
              {row.isDisputed && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                  ⚠ ตรวจสอบ
                </span>
              )}
              <span className="text-sm font-medium text-ink-1">
                {row.name}
                {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
              </span>
            </div>
            <p className="text-sm font-semibold text-ink-1">{row.dateLabel}</p>
          </div>
          <p className="text-xs text-ink-3">
            {row.branchDeptLabel} — บันทึกเมื่อ {row.createdAtLabel}
          </p>

          {/* Check-in evidence: selfie + position vs geofence (as on /disputed) */}
          {hasEvidence && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium text-ink-4">เซลฟี่ตอนเช็คอิน</p>
                {row.selfieUrl ? (
                  <a href={row.selfieUrl} target="_blank" rel="noopener noreferrer">
                    {/* biome-ignore lint/performance/noImgElement: signed-URL preview */}
                    <img
                      src={row.selfieUrl}
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
                {row.geofence && row.empLat != null && row.empLng != null ? (
                  <DisputeMap
                    key={row.id}
                    branch={row.geofence}
                    employee={{ lat: row.empLat, lng: row.empLng }}
                  />
                ) : (
                  <div className="grid h-56 place-items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-xs text-ink-4">
                    ไม่มีข้อมูลตำแหน่ง
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Facts grid */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-gray-50 p-4 text-sm">
            <Fact label="เวลาเข้า" value={row.clockInLabel} />
            <Fact label="เวลาออก" value={row.clockOutLabel} />
            <Fact label="ระยะเวลา" value={row.durationLabel} />
            <Fact
              label="ที่มา"
              value={
                row.checkInBranchName
                  ? `${row.sourceLabel} • ${row.checkInBranchName}`
                  : row.sourceLabel
              }
            />
            {row.distanceMeters != null && (
              <Fact
                label="ระยะจากสาขา"
                value={`${row.distanceMeters} ม.${row.geofence ? ` (รัศมี ${row.geofence.radiusMeters} ม.)` : ''}`}
              />
            )}
            {row.checkInStatusLabel && <Fact label="สถานะตรวจสอบ" value={row.checkInStatusLabel} />}
            {row.deductLabel && <Fact label="ยอดหัก" value={row.deductLabel} />}
            {row.disputeReason && <Fact label="เหตุผลระบบ" value={row.disputeReason} wide />}
            {row.overrideNote != null && (
              <Fact label="หมายเหตุการแก้ไข" value={row.overrideNote || '—'} wide />
            )}
          </dl>

          {row.empLat != null && row.empLng != null && (
            <a
              href={`https://www.google.com/maps?q=${row.empLat},${row.empLng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs font-medium text-primary-700 underline hover:text-primary-800"
            >
              เปิดใน Google Maps →
            </a>
          )}

          {/* Trash: deletion info + restore */}
          {isTrash && (
            <div className="rounded-lg border border-red-100 bg-red-50/60 p-3">
              <p className="text-xs text-ink-2">
                ลบเมื่อ {row.deletedAtLabel ?? '—'}
                {row.deleteReason && <span className="text-ink-3"> — {row.deleteReason}</span>}
              </p>
              <RestoreAction id={row.id} onDone={onClose} />
            </div>
          )}
        </div>
      )}
    </ReviewModal>
  );
}

function Fact({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  if (value == null) return null;
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-xs text-ink-4">{label}</dt>
      <dd className="font-medium text-ink-1">{value}</dd>
    </div>
  );
}

/** One-tap restore (non-destructive, so no confirm) — closes the modal and refreshes the list. */
function RestoreAction({ id, onDone }: { id: string; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const r = await restoreAttendance(id);
      if (r.ok) {
        onDone();
        router.refresh();
      } else {
        setError(r.message);
      }
    });
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={onClick} disabled={pending}>
        {pending ? 'กำลังกู้คืน…' : 'กู้คืนรายการนี้'}
      </Button>
      {error && (
        <span role="alert" className="text-xs font-medium text-danger-deep">
          {error}
        </span>
      )}
    </div>
  );
}
