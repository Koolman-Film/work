import { describe, expect, it } from 'vitest';
import { firstAccessibleAdminPath } from './admin-landing';
import type { Permission } from './permissions';

const s = (...p: Permission[]) => new Set<Permission>(p);

describe('firstAccessibleAdminPath', () => {
  it('dashboard.read → /admin', () => {
    expect(firstAccessibleAdminPath(s('dashboard.read', 'attendance.read'))).toBe('/admin');
  });
  it('live-board only → the live board', () => {
    expect(firstAccessibleAdminPath(s('attendance.live-board'))).toBe('/admin/attendance/live');
  });
  it('no dashboard, has leave.read → /admin/leave (nav order)', () => {
    expect(firstAccessibleAdminPath(s('leave.read', 'advance.read'))).toBe('/admin/leave');
  });
  it('settings-only → first settings section', () => {
    expect(firstAccessibleAdminPath(s('settings.holiday.manage'))).toBe('/admin/settings/holidays');
  });
  it('empty set → /admin fallback', () => {
    expect(firstAccessibleAdminPath(s())).toBe('/admin');
  });
});
