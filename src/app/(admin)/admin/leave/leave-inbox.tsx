'use client';

import { useState } from 'react';
import { STATUS_ICON, StatusBadge, statusRail } from '@/components/ui/status-badge';
import { LeaveReviewModal, type LeaveRowVM } from './leave-review-modal';

export type { LeaveRowVM };

function Badge({ row }: { row: LeaveRowVM }) {
  return (
    <StatusBadge status={row.statusKey}>
      {STATUS_ICON[row.statusKey] ?? ''} {row.statusLabel}
    </StatusBadge>
  );
}

export function LeaveInbox({ rows }: { rows: LeaveRowVM[] }) {
  const [open, setOpen] = useState<LeaveRowVM | null>(null);

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => setOpen(row)}
              aria-label={`ตรวจสอบคำขอลาของ ${row.name}`}
              className={`block w-full border-l-4 ${statusRail(row.statusKey)} px-5 py-4 text-left transition hover:bg-gray-50/70`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge row={row} />
                    <span className="truncate text-sm font-medium text-ink-1">
                      {row.name}
                      {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    {row.branch}
                    {row.department ? ` • ${row.department}` : ''}
                  </p>
                  <p className="mt-0.5 text-[10px] text-ink-4">ส่งเมื่อ {row.submitted}</p>
                </div>
                <div className="text-left text-xs text-ink-2 sm:max-w-[300px] sm:text-right">
                  <p>
                    <strong>{row.leaveType}</strong>{' '}
                    {row.isPaid ? '' : <span className="text-ink-3">(ไม่จ่าย)</span>}
                  </p>
                  <p className="mt-0.5 text-ink-3">
                    {row.range} • {row.durationLabel}
                  </p>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <LeaveReviewModal row={open} onClose={() => setOpen(null)} />
    </>
  );
}
