'use client';

/**
 * Live attendance board.
 *
 * Connection model:
 *   - Subscribe to Supabase Realtime channel for postgres_changes on the
 *     Attendance table. On any INSERT/UPDATE/DELETE we refetch the day's
 *     rows via the getTodayAttendance Server Action.
 *   - In parallel, run a 30-second polling loop as a fallback. If
 *     Realtime drops silently (corporate firewall, mobile carrier
 *     WebSocket meddling), the board still self-heals within 30 seconds.
 *
 * Why refetch the full day on every change instead of diff-patching the
 * local array:
 *   - Tiny dataset (≤20 employees × 1-2 rows each); a single Postgres
 *     SELECT is cheaper than maintaining a correct local cache.
 *   - Avoids "stale row count" bugs from out-of-order Realtime payloads.
 *   - The diff-patch approach also misses the case where an UPDATE on row
 *     X needs the *joined* employee.branch row — which our select
 *     dereferences. Plain Realtime payloads don't have joins.
 *
 * UI shows a tiny status pill: "เชื่อมต่อสด" (Realtime open) /
 * "อัปเดตทุก 30 วินาที" (polling fallback) so admins know what to expect.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getTodayAttendance, type LiveAttendanceRow } from '@/lib/attendance/live';
import { createClient } from '@/lib/supabase/browser';

type Status =
  | { kind: 'realtime'; channelStatus: 'connecting' | 'connected' | 'error' }
  | { kind: 'polling-only' };

const POLL_INTERVAL_MS = 30_000;

export function LiveBoardClient({ initialRows }: { initialRows: LiveAttendanceRow[] }) {
  const [rows, setRows] = useState<LiveAttendanceRow[]>(initialRows);
  const [status, setStatus] = useState<Status>({
    kind: 'realtime',
    channelStatus: 'connecting',
  });
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Stable refetch callback (kept in a ref so the long-lived polling
  // interval doesn't capture a stale closure of `rows`).
  const refetch = useCallback(async () => {
    try {
      const next = await getTodayAttendance();
      setRows(next);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('[live-board] refetch failed', err);
    }
  }, []);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // Realtime subscription.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('attendance:live-board')
      .on(
        'postgres_changes',
        // Listen to every change on the Attendance table; we'll refetch
        // when any of them lands. Filtering server-side by today's date
        // requires Postgres RLS-grant on logical replication — easier to
        // overfetch and let the SELECT below filter to today.
        {
          event: '*',
          schema: 'public',
          table: 'Attendance',
        },
        () => {
          void refetchRef.current();
        },
      )
      .subscribe((channelStatus) => {
        // Supabase passes the channel state as a string; normalise to our
        // 3-value enum.
        if (channelStatus === 'SUBSCRIBED') {
          setStatus({ kind: 'realtime', channelStatus: 'connected' });
        } else if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
          // Connection dropped — switch the badge to "polling only" so
          // admins know the freshness model changed.
          setStatus({ kind: 'polling-only' });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // 30-second polling fallback. Runs regardless of Realtime status —
  // belt + suspenders.
  useEffect(() => {
    const id = setInterval(() => {
      void refetchRef.current();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4">
      {/* Status row */}
      <div className="flex items-center justify-between gap-3 text-xs">
        <StatusPill status={status} />
        <p className="text-gray-400">
          อัปเดตล่าสุด: {lastUpdated.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })}
        </p>
      </div>

      {/* Board */}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">ยังไม่มีพนักงานเช็คอินวันนี้</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">พนักงาน</th>
                <th className="px-4 py-3 text-left font-medium">สาขา</th>
                <th className="px-4 py-3 text-left font-medium">เช็คอิน</th>
                <th className="px-4 py-3 text-left font-medium">เช็คเอาท์</th>
                <th className="px-4 py-3 text-left font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{r.employeeName}</span>
                    {r.employeeNickname && (
                      <span className="ml-1 text-gray-500">({r.employeeNickname})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.branchName}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">
                    {r.clockInAt ? formatTimeBkk(r.clockInAt) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-700">
                    {r.clockOutAt ? formatTimeBkk(r.clockOutAt) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      status={r.checkInStatus}
                      hasCheckedOut={!!r.clockOutAt}
                      isOverridden={r.isOverridden}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  if (status.kind === 'realtime' && status.channelStatus === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-700">
        <span className="size-1.5 animate-pulse rounded-full bg-green-500" aria-hidden="true" />
        เชื่อมต่อสด
      </span>
    );
  }
  if (status.kind === 'realtime' && status.channelStatus === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600">
        <span className="size-1.5 rounded-full bg-gray-400" aria-hidden="true" />
        กำลังเชื่อมต่อ...
      </span>
    );
  }
  // polling-only or realtime/error
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
      <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      อัปเดตทุก 30 วินาที
    </span>
  );
}

function StatusBadge({
  status,
  hasCheckedOut,
  isOverridden,
}: {
  status: LiveAttendanceRow['checkInStatus'];
  hasCheckedOut: boolean;
  isOverridden: boolean;
}) {
  // Priority: explicit Disputed/Rejected status > checked-out > confirmed
  if (status === 'Disputed') {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
        ตรวจสอบ
      </span>
    );
  }
  if (status === 'Rejected') {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">
        ปฏิเสธ
      </span>
    );
  }
  if (hasCheckedOut) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
        เสร็จงาน
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">
      กำลังทำงาน
      {isOverridden && <span className="text-[8px] text-green-600">(ปรับ)</span>}
    </span>
  );
}

function formatTimeBkk(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}
