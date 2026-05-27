'use client';

/**
 * Expandable review panel for a single Disputed Attendance row.
 *
 * Closed state: a single "ตรวจสอบ" button.
 * Open state: shows the GPS lat/lng + computed distance from the system-
 * matched branch, plus a required-note textarea and Approve / Reject
 * buttons.
 *
 * After a successful action, the component switches to a "settled" state
 * showing the decision, then prompts the admin to refresh (server actions
 * mutate; the parent list re-fetches on the next page load).
 *
 * Why no auto-redirect after action:
 *   - The admin is likely working through a queue of 3-5 disputes. Yanking
 *     them to a fresh list resets their position. We mark this row as
 *     settled in-place and they can continue down the list.
 */

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approveDisputed, rejectDisputed } from '@/lib/attendance/admin-review';
import { haversineMeters } from '@/lib/attendance/haversine';

type Branch = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

type Props = {
  attendanceId: string;
  employeeName: string;
  clockInAtIso: string | null;
  latitude: number | null;
  longitude: number | null;
  /** System's would-be-matched branch, if any. */
  candidateBranch: Branch | null;
};

type LocalState =
  | { kind: 'closed' }
  | { kind: 'open' }
  | { kind: 'settled'; outcome: 'Confirmed' | 'Rejected' }
  | { kind: 'error'; message: string };

export function DisputedReviewPanel(props: Props) {
  const [local, setLocal] = useState<LocalState>({ kind: 'closed' });
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();

  // Compute distance client-side (cheap, no extra fetch). The same math
  // ran server-side at submitCheckIn time — this is just to *show* it to
  // the admin during review.
  const distanceMeters =
    props.candidateBranch && props.latitude != null && props.longitude != null
      ? haversineMeters(
          props.latitude,
          props.longitude,
          props.candidateBranch.latitude,
          props.candidateBranch.longitude,
        )
      : null;

  function act(decision: 'approve' | 'reject') {
    const action = decision === 'approve' ? approveDisputed : rejectDisputed;
    startTransition(async () => {
      const result = await action({ attendanceId: props.attendanceId, note });
      if (result.ok) {
        setLocal({ kind: 'settled', outcome: result.nextStatus });
      } else {
        setLocal({ kind: 'error', message: result.message });
      }
    });
  }

  if (local.kind === 'closed') {
    return (
      <div className="border-t border-amber-200/70 bg-white px-5 py-3">
        <button
          type="button"
          onClick={() => setLocal({ kind: 'open' })}
          className="text-sm font-medium text-primary-700 hover:text-primary-800"
        >
          ตรวจสอบ →
        </button>
      </div>
    );
  }

  if (local.kind === 'settled') {
    return (
      <div className="border-t border-amber-200/70 bg-white px-5 py-4">
        <p
          className={
            local.outcome === 'Confirmed' ? 'text-sm text-green-700' : 'text-sm text-gray-600'
          }
        >
          {local.outcome === 'Confirmed' ? '✓ อนุมัติแล้ว' : '✕ ปฏิเสธแล้ว'} — รีเฟรชเพื่อดูรายการที่เหลือ
        </p>
      </div>
    );
  }

  // Open or error
  return (
    <div className="space-y-4 border-t border-amber-200/70 bg-white px-5 py-4">
      {/* GPS facts */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <Fact label="พิกัด">
          {props.latitude != null && props.longitude != null
            ? `${props.latitude.toFixed(6)}, ${props.longitude.toFixed(6)}`
            : '—'}
        </Fact>
        <Fact label="สาขาที่ตรวจ">{props.candidateBranch?.name ?? '—'}</Fact>
        <Fact label="ระยะห่างจากสาขา">
          {distanceMeters != null
            ? `${distanceMeters < 1000 ? `${Math.round(distanceMeters)} ม.` : `${(distanceMeters / 1000).toFixed(2)} กม.`}`
            : '—'}
        </Fact>
        <Fact label="รัศมี geofence">
          {props.candidateBranch ? `${props.candidateBranch.radiusMeters} ม.` : '—'}
        </Fact>
      </div>

      {/* Optional: tap to open Google Maps */}
      {props.latitude != null && props.longitude != null && (
        <a
          href={`https://maps.google.com/?q=${props.latitude},${props.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs text-primary-700 underline hover:text-primary-800"
        >
          เปิดใน Google Maps →
        </a>
      )}

      {/* Note + actions */}
      <div className="space-y-2">
        <label
          htmlFor={`note-${props.attendanceId}`}
          className="block text-xs font-medium text-gray-700"
        >
          เหตุผลของการตัดสินใจ <span className="text-red-600">*</span>
        </label>
        <textarea
          id={`note-${props.attendanceId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="เช่น: ตรวจสอบกับหัวหน้าแล้ว, GPS เพี้ยน, อนุมัติ"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        {local.kind === 'error' && <p className="text-xs text-red-700">{local.message}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => setLocal({ kind: 'closed' })}
            disabled={pending}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            ยกเลิก
          </button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => act('reject')}
              disabled={pending || note.trim().length === 0}
            >
              {pending ? '...' : 'ปฏิเสธ'}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => act('approve')}
              disabled={pending || note.trim().length === 0}
            >
              {pending ? '...' : 'อนุมัติ'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-gray-500">{label}</p>
      <p className="mt-0.5 font-mono text-gray-900">{children}</p>
    </div>
  );
}
