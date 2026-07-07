import { describe, expect, it } from 'vitest';
import { actionLabel, entityLabel, fieldLabel, isSensitive } from './labels';

describe('actionLabel', () => {
  it('maps a known action to its Thai label', () => {
    expect(actionLabel('payroll.publish')).toBe('เผยแพร่เงินเดือน');
    expect(actionLabel('employee.create')).toBe('เพิ่มพนักงาน');
  });
  it('falls back to the raw action string when unknown', () => {
    expect(actionLabel('something.unmapped')).toBe('something.unmapped');
  });
});

describe('entityLabel', () => {
  it('maps a known entity type to Thai', () => {
    expect(entityLabel('Employee')).toBe('พนักงาน');
    expect(entityLabel('Payroll')).toBe('เงินเดือน');
  });
  it('falls back to the raw entity type when unknown', () => {
    expect(entityLabel('Widget')).toBe('Widget');
  });
});

describe('isSensitive', () => {
  it('flags role, merge, delete, and payroll-publish actions', () => {
    expect(isSensitive('user.account-merge')).toBe(true);
    expect(isSensitive('roleAssignment.create')).toBe(true);
    expect(isSensitive('employee.delete')).toBe(true);
    expect(isSensitive('payroll.publish')).toBe(true);
  });
  it('does not flag routine reads/checkins', () => {
    expect(isSensitive('attendance.checkin')).toBe(false);
    expect(isSensitive('leave.submit')).toBe(false);
  });
});

describe('fieldLabel', () => {
  it('maps known fields and falls back to the raw key', () => {
    expect(fieldLabel('baseSalary')).toBe('เงินเดือนฐาน');
    expect(fieldLabel('someRawKey')).toBe('someRawKey');
  });
});
