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

  it('advance.approved-and-paid keys on cashAdvanceId, same as advance.approved/advance.paid', () => {
    const combined = {
      kind: 'advance.approved-and-paid' as const,
      cashAdvanceId: 'ca1',
      employeeFirstName: 'Aung',
      amount: '1,000.00',
    };
    expect(notificationEventId(combined, 'u1')).toBe('notif:advance.approved-and-paid:ca1:u1');
  });

  it('admin.daily-digest keys on the Bangkok calendar day, not the counts', () => {
    const digest = { kind: 'admin.daily-digest' as const, leave: 1, advance: 2, attendance: 3 };
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    expect(notificationEventId(digest, 'admin-1')).toBe(
      `notif:admin.daily-digest:${today}:admin-1`,
    );
    // Different counts, same admin, same day → same id (retries dedupe).
    const digestDifferentCounts = { ...digest, leave: 9 };
    expect(notificationEventId(digestDifferentCounts, 'admin-1')).toBe(
      notificationEventId(digest, 'admin-1'),
    );
  });
});
