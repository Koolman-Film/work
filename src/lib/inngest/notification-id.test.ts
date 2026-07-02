import { describe, expect, it } from 'vitest';
import { notificationEventId } from './notification-id';

const published = {
  kind: 'payroll.published' as const,
  payrollId: 'p1',
  month: '2026-06',
  employeeFirstName: 'Aung',
  netPay: '28,500.00',
};

describe('notificationEventId', () => {
  it('default id is idempotency key + recipient (unchanged dedup behavior)', () => {
    expect(notificationEventId(published, 'u1')).toBe('notif:payroll.published:p1:u1');
  });

  it('a dedupeSuffix yields a DISTINCT id so a resend bypasses the 24h dedup window', () => {
    const base = notificationEventId(published, 'u1');
    const resend = notificationEventId(published, 'u1', 'r-abc');
    expect(resend).toBe('notif:payroll.published:p1:u1:r-abc');
    expect(resend).not.toBe(base);
  });
});
