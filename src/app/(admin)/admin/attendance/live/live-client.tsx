'use client';

/**
 * Live attendance board — KPI strip + branch-grouped status chips.
 *
 * Connection model (unchanged): subscribe to Supabase Realtime for
 * postgres_changes on Attendance → refetch the day on any change; plus a
 * 30s polling fallback so the board self-heals if the socket drops.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard } from '@/components/ui/stat-card';
import {
  getTodayAttendance,
  type LiveAttendanceRow,
  type LiveBoardData,
} from '@/lib/attendance/live';
import { createClient } from '@/lib/supabase/browser';

type Status =
  | { kind: 'realtime'; channelStatus: 'connecting' | 'connected' | 'error' }
  | { kind: 'polling-only' };

const POLL_INTERVAL_MS = 30_000;

export function LiveBoardClient({ initial }: { initial: LiveBoardData }) {
  const [data, setData] = useState<LiveBoardData>(initial);
  const [status, setStatus] = useState<Status>({ kind: 'realtime', channelStatus: 'connecting' });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refetch = useCallback(async () => {
    try {
      const next = await getTodayAttendance();
      setData(next);
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Attendance' }, () => {
        void refetchRef.current();
      })
      .subscribe((channelStatus) => {
        if (channelStatus === 'SUBSCRIBED') {
          setStatus({ kind: 'realtime', channelStatus: 'connected' });
        } else if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
          setStatus({ kind: 'polling-only' });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // 30-second polling fallback.
  useEffect(() => {
    const id = setInterval(() => {
      void refetchRef.current();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const { rows, activeCount, onLeaveCount } = data;
  const present = rows.length;
  const late = rows.filter((r) => isLate(r.clockInAt)).length;
  const out = rows.filter((r) => r.clockOutAt).length;
  const notYet = Math.max(0, activeCount - present - onLeaveCount);
  const pct = activeCount > 0 ? Math.round((present / activeCount) * 100) : 0;
  const groups = groupByBranch(rows);

  return (
    <div className="space-y-5">
      {/* Status row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill status={status} />
        <div className="flex items-center gap-3 text-xs text-ink-3">
          <a
            href="/admin/attendance/manual"
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-medium text-ink-2 transition hover:bg-gray-50"
          >
            + บันทึกด้วยตนเอง
          </a>
          <span>
            ซิงค์ล่าสุด{' '}
            {lastUpdated
              ? lastUpdated.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })
              : '—'}
          </span>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="เข้างานแล้ว" value={present} hint={`${pct}% ของ ${activeCount} คน`} />
        <StatCard label="มาสาย" value={late} hint="เช็คอินหลัง 09:00" />
        <StatCard label="ยังไม่มา" value={notYet} hint="ยังไม่เช็คอินวันนี้" />
        <StatCard label="ลา/หยุด" value={onLeaveCount} hint="อนุมัติแล้ว" />
        <StatCard label="ออกแล้ว" value={out} hint="เช็คเอาท์แล้ว" />
      </div>

      {/* Branch-grouped chips */}
      {rows.length === 0 ? (
        <div className="surface">
          <EmptyState title="ยังไม่มีพนักงานเช็คอินวันนี้" hint="แผงจะอัปเดตอัตโนมัติเมื่อมีการเช็คอิน" />
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.branch}>
              <p className="mb-2 text-xs font-semibold text-ink-3">
                {g.branch} <span className="text-ink-4">· {g.rows.length} คน</span>
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {g.rows.map((r) => (
                  <Chip key={r.id} row={r} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-4">
        <Legend color="bg-emerald-400" label="กำลังทำงาน" />
        <Legend color="bg-amber-400" label="ตรวจสอบ" />
        <Legend color="bg-slate-300" label="ออกแล้ว" />
        <Legend color="bg-red-400" label="ปฏิเสธ" />
        <span className="ml-auto text-ink-5">realtime · supabase channel + 30s polling</span>
      </div>
    </div>
  );
}

function Chip({ row }: { row: LiveAttendanceRow }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border border-gray-200 border-l-4 ${chipRail(row)} bg-white px-3 py-2 shadow-sm`}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-100 font-display text-[11px] font-bold text-primary-700">
        {initials(row.employeeName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-1">
          {row.employeeName}
          {row.employeeNickname && <span className="text-ink-3"> ({row.employeeNickname})</span>}
        </p>
        <p className="mono text-[10px] text-ink-3">
          เข้า {row.clockInAt ? fmtTime(row.clockInAt) : '—'}
          {row.clockOutAt && ` · ออก ${fmtTime(row.clockOutAt)}`}
        </p>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  if (status.kind === 'realtime' && status.channelStatus === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />🟢
        LIVE — เชื่อมต่อสด
      </span>
    );
  }
  if (status.kind === 'realtime' && status.channelStatus === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-ink-3">
        <span className="size-1.5 rounded-full bg-gray-400" aria-hidden="true" />
        กำลังเชื่อมต่อ...
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
      <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      อัปเดตทุก 30 วินาที
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`size-2 rounded-full ${color}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function chipRail(row: LiveAttendanceRow): string {
  if (row.checkInStatus === 'Disputed') return 'border-l-amber-400';
  if (row.checkInStatus === 'Rejected') return 'border-l-red-400';
  if (row.clockOutAt) return 'border-l-slate-300';
  return 'border-l-emerald-400';
}

function groupByBranch(rows: LiveAttendanceRow[]): { branch: string; rows: LiveAttendanceRow[] }[] {
  const map = new Map<string, LiveAttendanceRow[]>();
  for (const r of rows) {
    const list = map.get(r.branchName);
    if (list) list.push(r);
    else map.set(r.branchName, [r]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'th'))
    .map(([branch, list]) => ({ branch, rows: list }));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function isLate(clockInIso: string | null): boolean {
  if (!clockInIso) return false;
  const hhmm = new Date(clockInIso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return hhmm > '09:00';
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}
