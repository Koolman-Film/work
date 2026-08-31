import { describe, expect, it } from 'vitest';
import type { DayGroup } from '@/lib/attendance/day-groups';
import { buildAttendanceDayVM } from './attendance-day-vm';
import type { AttendanceRowVM } from './attendance-row-vm';

const vm = (o: Partial<AttendanceRowVM> & { id: string; type: string }): AttendanceRowVM =>
  ({
    typeLabel: o.type,
    typeCls: 'cls',
    isDisputed: false,
    checkInStatusLabel: null,
    dateLabel: '20 ส.ค. 2569',
    name: 'สมชาย ใจดี',
    nickname: 'ชาย',
    branchDeptLabel: '',
    timeLabel: null,
    clockInLabel: null,
    clockOutLabel: null,
    durationLabel: '—',
    sourceLabel: 'LINE',
    checkInBranchName: null,
    disputeReason: null,
    overrideNote: null,
    deductLabel: null,
    createdAtLabel: '',
    selfieUrl: null,
    empLat: null,
    empLng: null,
    geofence: null,
    distanceMeters: null,
    deletedAtLabel: null,
    ...o,
  }) as AttendanceRowVM;

const group = (rows: AttendanceRowVM[]): DayGroup<AttendanceRowVM> => ({
  key: 'e1|2026-08-20',
  employeeId: 'e1',
  ymd: '2026-08-20',
  rows,
});

describe('buildAttendanceDayVM', () => {
  it('shows the lateness ON the merged line, so the Late row need not be opened', () => {
    const d = buildAttendanceDayVM(
      group([
        vm({ id: 'a', type: 'CheckIn', timeLabel: '09:30 – 18:00', durationLabel: '8 ชม.' }),
        vm({ id: 'b', type: 'Late', durationLabel: '30 นาที' }),
      ]),
      { isTrash: false },
    );
    expect(d.lateLabel).toBe('30 นาที');
    expect(d.timeLabel).toBe('09:30 – 18:00');
  });

  it('does not show the Late duration twice under two meanings', () => {
    // durationLabel is the WORKED span; lateLabel is the lateness. Taking
    // duration from the Late row would print "30 นาที" in both columns.
    const d = buildAttendanceDayVM(
      group([
        vm({ id: 'a', type: 'CheckIn', durationLabel: '8 ชม.' }),
        vm({ id: 'b', type: 'Late', durationLabel: '30 นาที' }),
      ]),
      { isTrash: false },
    );
    expect(d.durationLabel).toBe('8 ชม.');
    expect(d.lateLabel).toBe('30 นาที');
  });

  it('anchors on the CheckIn row even when it is not first', () => {
    const d = buildAttendanceDayVM(
      group([vm({ id: 'b', type: 'Late' }), vm({ id: 'a', type: 'CheckIn' })]),
      { isTrash: false },
    );
    expect(d.primary.id).toBe('a');
  });

  it('a day with no CheckIn anchors on its first row', () => {
    const d = buildAttendanceDayVM(group([vm({ id: 'x', type: 'OnLeave' })]), { isTrash: false });
    expect(d.primary.id).toBe('x');
    expect(d.lateLabel).toBeNull();
  });

  it('carries a badge per row, in row order', () => {
    const d = buildAttendanceDayVM(
      group([
        vm({ id: 'a', type: 'CheckIn', typeLabel: 'เข้างาน' }),
        vm({ id: 'b', type: 'Late', typeLabel: 'มาสาย' }),
      ]),
      { isTrash: false },
    );
    expect(d.badges.map((b) => b.label)).toEqual(['เข้างาน', 'มาสาย']);
  });

  it('a disputed row anywhere in the day flags the whole line', () => {
    const d = buildAttendanceDayVM(
      group([vm({ id: 'a', type: 'CheckIn', isDisputed: true }), vm({ id: 'b', type: 'Late' })]),
      { isTrash: false },
    );
    expect(d.isDisputed).toBe(true);
  });

  it('surfaces the first non-empty note, and the delete reason in trash view', () => {
    const rows = [
      vm({ id: 'a', type: 'CheckIn', disputeReason: null, deleteReason: 'ลบผิด' }),
      vm({ id: 'b', type: 'Late', disputeReason: 'ขอตรวจสอบ', deleteReason: null }),
    ];
    expect(buildAttendanceDayVM(group(rows), { isTrash: false }).note).toBe('ขอตรวจสอบ');
    expect(buildAttendanceDayVM(group(rows), { isTrash: true }).note).toBe('ลบผิด');
  });
});
