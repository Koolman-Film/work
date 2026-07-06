'use client';

import { useState } from 'react';
import { StatusBadge } from '@/components/ui/status-badge';
import { diffValues } from '@/lib/audit/diff';
import { actionLabel, entityLabel, isSensitive } from '@/lib/audit/labels';
import { formatThaiDate } from '@/lib/format';

export type AuditRowData = {
  id: string;
  actorLabel: string; // resolved on the server ('ระบบ' for null actor)
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string; // ISO
  before: unknown;
  after: unknown;
  metadata: unknown;
};

export function AuditRow({ row }: { row: AuditRowData }) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const diff = diffValues(row.before, row.after);
  const when = formatThaiDate(new Date(row.createdAt));
  const entityHref = `/admin/audit?entityType=${encodeURIComponent(row.entityType)}&entityId=${encodeURIComponent(row.entityId)}`;

  return (
    <li className="surface px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink-1">{row.actorLabel}</span>
          <span className="text-ink-3">{actionLabel(row.action)}</span>
          {isSensitive(row.action) && <StatusBadge status="rejected">สำคัญ</StatusBadge>}
          <span className="text-xs text-ink-4">· {entityLabel(row.entityType)}</span>
        </span>
        <span className="whitespace-nowrap text-xs text-ink-4">{when}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 text-sm">
          <a href={entityHref} className="text-primary-700 hover:text-primary-800">
            ดูประวัติของรายการนี้ →
          </a>

          {diff.length > 0 ? (
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {diff.map((d) => (
                  <tr key={d.field} className={d.changed ? '' : 'text-ink-4'}>
                    <td className="py-1 pr-4 font-medium text-ink-2">{d.label}</td>
                    <td className="py-1 pr-2 text-ink-3">{d.before}</td>
                    <td className="py-1 pr-2">→</td>
                    <td className="py-1 text-ink-1">{d.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-ink-4">ไม่มีรายละเอียดการเปลี่ยนแปลง</p>
          )}

          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-xs text-ink-4 underline"
          >
            {showRaw ? 'ซ่อน JSON ดิบ' : 'ดู JSON ดิบ'}
          </button>
          {showRaw && (
            <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs text-ink-2">
              {JSON.stringify(
                { before: row.before, after: row.after, metadata: row.metadata },
                null,
                2,
              )}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
