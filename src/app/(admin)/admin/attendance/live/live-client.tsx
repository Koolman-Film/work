'use client';

/**
 * Live attendance board — KPI strip (clickable filters) + branch-grouped list.
 *
 * Connection model (unchanged): subscribe to Supabase Realtime for
 * postgres_changes on Attendance → refetch the day on any change; plus a
 * 30s polling fallback so the board self-heals if the socket drops.
 *
 * Filtering: the five KPI cards are filter toggles. The active filter lives in
 * the URL (`?filter=`) so it's shareable and the dashboard can deep-link in;
 * the client seeds from `initialFilter` and updates the URL via router.replace.
 */

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard } from '@/components/ui/stat-card';
import { getTodayAttendance } from '@/lib/attendance/live';
import type {
  LiveAttendanceRow,
  LiveBoardData,
  OnLeaveEmployee,
  RosterEmployee,
} from '@/lib/attendance/live-shape';
import { createClient } from '@/lib/supabase/browser';
import { type AttendanceFilter, isLate, selectView } from './filter';

type Status =
  | { kind: 'realtime'; channelStatus: 'connecting' | 'connected' | 'error' }
  | { kind: 'polling-only' };

const POLL_INTERVAL_MS = 30_000;
const LIVE_PATH = '/admin/attendance/live';

export function LiveBoardClient({
  initial,
  initialFilter,
}: {
  initial: LiveBoardData;
  initialFilter: AttendanceFilter | null;
}) {
  const router = useRouter();
  const [data, setData] = useState<LiveBoardData>(initial);
  const [filter, setFilter] = useState<AttendanceFilter | null>(initialFilter);
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

  // Toggle a filter: clicking the active card clears it. Mirror the change to
  // the URL (replace, so we don't pile up history entries) for shareability.
  const toggleFilter = useCallback(
    (next: AttendanceFilter) => {
      setFilter((cur) => {
        const value = cur === next ? null : next;
        router.replace(value ? `${LIVE_PATH}?filter=${value}` : LIVE_PATH, { scroll: false });
        return value;
      });
    },
    [router],
  );

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

  const { rows, notCheckedIn, activeCount, onLeaveCount } = data;
  const present = rows.length;
  const late = rows.filter((r) => isLate(r.clockInAt)).length;
  const out = rows.filter((r) => r.clockOutAt).length;
  const notYet = notCheckedIn.length;
  const pct = activeCount > 0 ? Math.round((present / activeCount) * 100) : 0;

  const view = selectView(data, filter);

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

      {/* KPI strip — clickable filters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="เข้างานแล้ว"
          value={present}
          hint={`${pct}% ของ ${activeCount} คน`}
          active={filter === 'checkedin'}
          onClick={() => toggleFilter('checkedin')}
        />
        <StatCard
          label="มาสาย"
          value={late}
          hint="เช็คอินหลัง 09:00"
          active={filter === 'late'}
          onClick={() => toggleFilter('late')}
        />
        <StatCard
          label="ยังไม่มา"
          value={notYet}
          hint="ยังไม่เช็คอินวันนี้"
          active={filter === 'notcheckedin'}
          onClick={() => toggleFilter('notcheckedin')}
        />
        <StatCard
          label="ลา/หยุด"
          value={onLeaveCount}
          hint="อนุมัติแล้ว"
          active={filter === 'onleave'}
          onClick={() => toggleFilter('onleave')}
        />
        <StatCard
          label="ออกแล้ว"
          value={out}
          hint="เช็คเอาท์แล้ว"
          active={filter === 'checkedout'}
          onClick={() => toggleFilter('checkedout')}
        />
      </div>

      {/* List area — content depends on the active filter */}
      <FilteredList view={view} />

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

function FilteredList({ view }: { view: ReturnType<typeof selectView> }) {
  if (view.kind === 'checkin') {
    if (view.rows.length === 0) {
      return (
        <div className="surface">
          <EmptyState title="ไม่มีรายการในมุมมองนี้" hint="แผงจะอัปเดตอัตโนมัติเมื่อมีการเปลี่ยนแปลง" />
        </div>
      );
    }
    return (
      <BranchGroups groups={groupByBranch(view.rows)} render={(r) => <Chip key={r.id} row={r} />} />
    );
  }

  if (view.kind === 'roster') {
    if (view.rows.length === 0) {
      return (
        <div className="surface">
          <EmptyState title="ทุกคนเช็คอินแล้ว ✨" hint="ไม่มีพนักงานที่ยังไม่เข้างานวันนี้" />
        </div>
      );
    }
    return (
      <BranchGroups
        groups={groupByBranch(view.rows)}
        render={(r) => <RosterChip key={r.id} person={r} />}
      />
    );
  }

  // view.kind === 'leave'
  if (view.rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState title="ไม่มีพนักงานลาวันนี้" hint="รายการลาที่อนุมัติแล้วจะแสดงที่นี่" />
      </div>
    );
  }
  return (
    <BranchGroups
      groups={groupByBranch(view.rows)}
      render={(r) => <LeaveChip key={r.id} person={r} />}
    />
  );
}

function BranchGroups<T extends { branchName: string }>({
  groups,
  render,
}: {
  groups: { branch: string; rows: T[] }[];
  render: (item: T) => ReactNode;
}) {
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.branch}>
          <p className="mb-2 text-xs font-semibold text-ink-3">
            {g.branch} <span className="text-ink-4">· {g.rows.length} คน</span>
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.rows.map(render)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Chip({ row }: { row: LiveAttendanceRow }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border border-gray-200 border-l-4 ${chipRail(row)} bg-white px-3 py-2 shadow-sm`}
    >
      <Avatar name={row.employeeName} />
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

function RosterChip({ person }: { person: RosterEmployee }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-gray-200 border-l-4 border-l-slate-300 bg-white px-3 py-2 shadow-sm">
      <Avatar name={person.employeeName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-1">
          {person.employeeName}
          {person.employeeNickname && (
            <span className="text-ink-3"> ({person.employeeNickname})</span>
          )}
        </p>
        <p className="text-[10px] text-ink-4">ยังไม่เช็คอิน</p>
      </div>
    </div>
  );
}

function LeaveChip({ person }: { person: OnLeaveEmployee }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-gray-200 border-l-4 border-l-amber-400 bg-white px-3 py-2 shadow-sm">
      <Avatar name={person.employeeName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-1">
          {person.employeeName}
          {person.employeeNickname && (
            <span className="text-ink-3"> ({person.employeeNickname})</span>
          )}
        </p>
        <p className="text-[10px] text-ink-3">
          {person.leaveTypeName ?? 'ลา'}
          {person.startDate && person.endDate && ` · ${fmtRange(person.startDate, person.endDate)}`}
        </p>
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-100 font-display text-[11px] font-bold text-primary-700">
      {initials(name)}
    </span>
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

function groupByBranch<T extends { branchName: string }>(
  rows: T[],
): { branch: string; rows: T[] }[] {
  const map = new Map<string, T[]>();
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

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

function fmtRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC', day: 'numeric', month: 'short' };
  const start = new Date(startIso);
  const end = new Date(endIso);
  const same =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();
  if (same) return start.toLocaleDateString('th-TH', opts);
  return `${start.toLocaleDateString('th-TH', opts)}–${end.toLocaleDateString('th-TH', opts)}`;
}
