/**
 * Pure mappers: report query rows → ExportTable. Column labels mirror the
 * on-screen tables (src/app/(admin)/admin/reports/*). Pages and exports
 * share the query layer, so numbers can never disagree.
 */
import { formatTHB2 } from '@/lib/format';
import { formatDaysHours, type LeaveUnitConfig } from '@/lib/leave/units';
import type { ReportPeriod } from '@/lib/reports/period';
import type { AdvanceReportRow, AttendanceReportRow, LeaveReportRow } from '@/lib/reports/queries';
import { type ExportTable, generatedAtLabel, thaiPeriodLabel } from './export-table';

export function attendanceTable(rows: AttendanceReportRow[], period: ReportPeriod): ExportTable {
  const totals = rows.reduce(
    (a, r) => ({
      lateMinutes: a.lateMinutes + r.lateMinutes,
      earlyMinutes: a.earlyMinutes + r.earlyMinutes,
      absentDays: a.absentDays + r.absentDays,
      otMinutes: a.otMinutes + r.otMinutes,
    }),
    { lateMinutes: 0, earlyMinutes: 0, absentDays: 0, otMinutes: 0 },
  );
  return {
    title: 'รายงานการมาทำงาน',
    periodLabel: thaiPeriodLabel(period),
    generatedAt: generatedAtLabel(),
    columns: [
      { key: 'name', label: 'พนักงาน' },
      { key: 'lateCount', label: 'มาสาย (ครั้ง)', align: 'right', format: 'int' },
      { key: 'lateMinutes', label: 'สาย (นาที)', align: 'right', format: 'int' },
      { key: 'earlyCount', label: 'ออกก่อน (ครั้ง)', align: 'right', format: 'int' },
      { key: 'earlyMinutes', label: 'ออกก่อน (นาที)', align: 'right', format: 'int' },
      { key: 'absentDays', label: 'ขาดงาน (วัน)', align: 'right', format: 'int' },
      { key: 'otMinutes', label: 'OT (นาที)', align: 'right', format: 'int' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      lateCount: r.lateCount,
      lateMinutes: r.lateMinutes,
      earlyCount: r.earlyCount,
      earlyMinutes: r.earlyMinutes,
      absentDays: r.absentDays,
      otMinutes: r.otMinutes,
    })),
    totals: { name: `รวม ${rows.length} คน`, ...totals },
  };
}

export function advanceTable(rows: AdvanceReportRow[], period: ReportPeriod): ExportTable {
  const totals = rows.reduce(
    (a, r) => ({
      approvedInPeriod: a.approvedInPeriod + r.approvedInPeriod,
      outstandingNow: a.outstandingNow + r.outstandingNow,
    }),
    { approvedInPeriod: 0, outstandingNow: 0 },
  );
  return {
    title: 'รายงานการเบิกเงิน',
    periodLabel: thaiPeriodLabel(period),
    generatedAt: generatedAtLabel(),
    columns: [
      { key: 'name', label: 'พนักงาน' },
      { key: 'approvedInPeriod', label: 'เบิกอนุมัติในช่วง', align: 'right', format: 'thb' },
      { key: 'outstandingNow', label: 'ค้างหัก', align: 'right', format: 'thb' },
      { key: 'availableNow', label: 'วงเงินคงเหลือ', align: 'right', format: 'thb' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      approvedInPeriod: r.approvedInPeriod,
      outstandingNow: r.outstandingNow,
      availableNow: r.availableNow == null ? '—' : r.availableNow,
    })),
    totals: { name: `รวม ${rows.length} คน`, ...totals },
  };
}

export function leaveTable(
  rows: LeaveReportRow[],
  types: Array<{ id: string; name: string }>,
  cfg: LeaveUnitConfig,
  period: ReportPeriod,
  year: number,
): ExportTable {
  const columns = [
    { key: 'name', label: 'พนักงาน' },
    ...types.flatMap((t) => [
      { key: `${t.id}:used`, label: `${t.name} — ใช้ไป`, align: 'right' as const },
      {
        key: `${t.id}:remaining`,
        label: `${t.name} — คงเหลือ (ปี ${year + 543})`,
        align: 'right' as const,
      },
      { key: `${t.id}:over`, label: `${t.name} — เกิน (หักเงิน)`, align: 'right' as const },
    ]),
  ];
  return {
    title: 'รายงานวันลา',
    periodLabel: thaiPeriodLabel(period),
    generatedAt: generatedAtLabel(),
    columns,
    rows: rows.map((r) => {
      const out: Record<string, string> = { name: r.name };
      for (const t of types) {
        const cell = r.byType[t.id];
        const remaining = r.remainingByType[t.id];
        out[`${t.id}:used`] = cell ? formatDaysHours(cell.usedMinutes, cfg) : '—';
        out[`${t.id}:remaining`] =
          remaining === undefined || remaining === null
            ? 'ไม่จำกัด'
            : formatDaysHours(remaining, cfg);
        out[`${t.id}:over`] =
          cell && cell.overQuotaMinutes > 0
            ? `${formatDaysHours(cell.overQuotaMinutes, cfg)} (${formatTHB2(cell.deductAmount)})`
            : '—';
      }
      return out;
    }),
    totals: undefined, // page shows no totals footer for leave — mirror it
  };
}
