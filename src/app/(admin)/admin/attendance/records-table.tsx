'use client';

import { type ReactNode, useState } from 'react';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import type { AttendanceDayVM } from './attendance-day-vm';
import { AttendanceDetailModal } from './attendance-detail-modal';
import type { AttendanceRowVM } from './attendance-row-vm';

/**
 * Client island for the records list. Renders ONE LINE PER EMPLOYEE-DAY from
 * server-built VMs and owns "which day's detail modal is open".
 *
 * A day's separate rows (CheckIn + Late) are merged for display only. Clicking
 * opens the day's anchor row — the CheckIn where there is one, because that is
 * the row carrying clock times, selfie, geofence and branch. The lateness is
 * shown on the line itself, so the Late row does not need opening.
 */
export function AttendanceRecordsTable({
  days,
  isTrash,
  empty,
}: {
  days: AttendanceDayVM[];
  isTrash: boolean;
  empty?: ReactNode;
}) {
  const [selected, setSelected] = useState<AttendanceRowVM | null>(null);

  const columns: Column<AttendanceDayVM>[] = [
    { key: 'date', header: 'วันที่', cell: (r) => r.dateLabel },
    {
      key: 'employee',
      header: 'พนักงาน',
      cell: (r) => (
        <span className="font-medium text-ink-1">
          {r.name}
          {r.nickname && <span className="text-ink-3"> ({r.nickname})</span>}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'ประเภท',
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          {r.badges.map((b) => (
            <span
              key={b.id}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${b.cls}`}
            >
              {b.label}
            </span>
          ))}
          {r.lateLabel && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">
              สาย {r.lateLabel}
            </span>
          )}
          {r.isDisputed && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
              ⚠ ตรวจสอบ
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'time',
      header: 'เวลา',
      cell: (r) =>
        r.timeLabel ? <span className="mono text-xs text-ink-2">{r.timeLabel}</span> : '—',
    },
    { key: 'duration', header: 'ระยะเวลา', cell: (r) => r.durationLabel },
    {
      key: 'source',
      header: 'ที่มา',
      cell: (r) => (
        <span className="text-xs text-ink-3">
          {r.sourceLabel}
          {r.checkInBranchName && <span className="text-ink-4"> • {r.checkInBranchName}</span>}
        </span>
      ),
    },
    {
      key: 'note',
      header: 'หมายเหตุ',
      cell: (r) => <span className="text-xs text-ink-3">{r.note ?? '—'}</span>,
    },
  ];

  return (
    <>
      <ResponsiveTable
        columns={columns}
        rows={days}
        rowKey={(r) => r.key}
        empty={empty}
        onRowClick={(d) => setSelected(d.primary)}
      />
      <AttendanceDetailModal row={selected} isTrash={isTrash} onClose={() => setSelected(null)} />
    </>
  );
}
