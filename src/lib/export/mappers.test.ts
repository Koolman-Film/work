import { describe, expect, it } from 'vitest';
import type { AdvanceReportRow, AttendanceReportRow, LeaveReportRow } from '@/lib/reports/queries';
import { advanceTable, attendanceTable, leaveTable } from './mappers';

const period = { from: '2026-06-01', to: '2026-06-30', month: '2026-06' };

const attRows: AttendanceReportRow[] = [
  {
    employeeId: 'e1',
    name: 'สมชาย',
    lateCount: 2,
    lateMinutes: 30,
    earlyCount: 1,
    earlyMinutes: 15,
    absentDays: 1,
    otMinutes: 120,
  },
  {
    employeeId: 'e2',
    name: 'สมหญิง',
    lateCount: 0,
    lateMinutes: 0,
    earlyCount: 0,
    earlyMinutes: 0,
    absentDays: 0,
    otMinutes: 60,
  },
];

describe('attendanceTable', () => {
  const t = attendanceTable(attRows, period);
  it('has the 7 on-screen columns in order', () => {
    expect(t.columns.map((c) => c.label)).toEqual([
      'พนักงาน',
      'มาสาย (ครั้ง)',
      'สาย (นาที)',
      'ออกก่อน (ครั้ง)',
      'ออกก่อน (นาที)',
      'ขาดงาน (วัน)',
      'OT (นาที)',
    ]);
  });
  it('totals match page footer semantics (sums + headcount label)', () => {
    expect(t.totals).toMatchObject({
      name: 'รวม 2 คน',
      lateMinutes: 30,
      earlyMinutes: 15,
      absentDays: 1,
      otMinutes: 180,
    });
  });
  it('carries Buddhist-era period label', () => {
    expect(t.periodLabel).toBe('มิ.ย. 2569');
  });
});

describe('advanceTable', () => {
  const rows: AdvanceReportRow[] = [
    {
      employeeId: 'e1',
      name: 'สมชาย',
      approvedInPeriod: 1000,
      outstandingNow: 500,
      availableNow: 1500,
    },
    { employeeId: 'e2', name: 'สมหญิง', approvedInPeriod: 0, outstandingNow: 0, availableNow: null },
  ];
  const t = advanceTable(rows, period);
  it('formats null availableNow as em-dash', () => {
    expect(t.rows[1]!.availableNow).toBe('—');
  });
  it('totals approved + outstanding only', () => {
    expect(t.totals).toMatchObject({
      name: 'รวม 2 คน',
      approvedInPeriod: 1000,
      outstandingNow: 500,
    });
    expect(t.totals!.availableNow).toBeUndefined();
  });
});

describe('leaveTable', () => {
  const types = [{ id: 't1', name: 'ลาป่วย' }];
  const rows: LeaveReportRow[] = [
    {
      employeeId: 'e1',
      name: 'สมชาย',
      byType: { t1: { usedMinutes: 420, overQuotaMinutes: 60, deductAmount: 100 } },
      remainingByType: { t1: 840 },
      penaltyByType: { t1: 420 },
    },
  ];
  // 420 min/day: morning 09:00-12:00 (180 min) + afternoon 13:00-17:00 (240 min)
  const cfg = {
    morningStart: '09:00',
    morningEnd: '12:00',
    afternoonStart: '13:00',
    afternoonEnd: '17:00',
  };
  const t = leaveTable(rows, types, cfg, period, 2026);
  it('generates used/remaining/over/penalty columns per type', () => {
    expect(t.columns.map((c) => c.label)).toEqual([
      'พนักงาน',
      'ลาป่วย — ใช้ไป',
      'ลาป่วย — คงเหลือ (ปี 2569)',
      'ลาป่วย — เกิน (หักเงิน)',
      'ลาป่วย — หักเป็นค่าปรับ',
    ]);
  });
  it('formats durations via formatDaysHours and deductions as THB', () => {
    const r = t.rows[0]!;
    expect(r['t1:used']).toBe('1 วัน');
    expect(r['t1:remaining']).toBe('2 วัน');
    expect(r['t1:over']).toBe('1 ชม. (฿100.00)');
    expect(r['t1:penalty']).toBe('1 วัน');
  });
  it('renders unlimited remaining, empty over, and empty penalty as placeholders', () => {
    const t2 = leaveTable(
      [
        {
          employeeId: 'e2',
          name: 'สมหญิง',
          byType: { t1: { usedMinutes: 0, overQuotaMinutes: 0, deductAmount: 0 } },
          remainingByType: {},
          penaltyByType: {},
        },
      ],
      types,
      cfg,
      period,
      2026,
    );
    const r = t2.rows[0]!;
    expect(r['t1:remaining']).toBe('ไม่จำกัด');
    expect(r['t1:over']).toBe('—');
    expect(r['t1:penalty']).toBe('—');
  });
});
