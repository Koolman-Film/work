'use client';

import { type ReactNode, useState } from 'react';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { AttendanceDetailModal } from './attendance-detail-modal';
import type { AttendanceRowVM } from './attendance-row-vm';

/**
 * Client island for the records list: renders the ResponsiveTable from
 * server-built VMs and owns "which row's detail modal is open". Row click
 * (or Enter/Space) opens the modal; void/restore live in the modal footer.
 */
export function AttendanceRecordsTable({
  rows,
  isTrash,
  empty,
}: {
  rows: AttendanceRowVM[];
  isTrash: boolean;
  empty?: ReactNode;
}) {
  const [selected, setSelected] = useState<AttendanceRowVM | null>(null);

  const columns: Column<AttendanceRowVM>[] = [
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
        <span className="inline-flex items-center gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${r.typeCls}`}>
            {r.typeLabel}
          </span>
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
      cell: (r) => (
        <span className="text-xs text-ink-3">
          {(isTrash ? r.deleteReason : r.disputeReason) ?? '—'}
        </span>
      ),
    },
  ];

  return (
    <>
      <ResponsiveTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={empty}
        onRowClick={setSelected}
      />
      <AttendanceDetailModal row={selected} isTrash={isTrash} onClose={() => setSelected(null)} />
    </>
  );
}
