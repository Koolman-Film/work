import type { messagingApi } from '@line/bot-sdk';
import { describe, expect, it } from 'vitest';
import { buildFlexMessage } from './flex-templates';

type Bubble = messagingApi.FlexBubble;
const headerText = (m: messagingApi.FlexMessage): string => {
  const b = m.contents as Bubble;
  const box = b.header as messagingApi.FlexBox;
  const t = box.contents?.[0] as messagingApi.FlexText;
  return t.text ?? '';
};

const leaveApproved = {
  kind: 'leave.approved' as const,
  leaveRequestId: 'r1',
  employeeFirstName: 'Aung',
  leaveTypeName: 'ลาป่วย',
  startDate: '2026-05-12',
  endDate: '2026-05-12',
  workingDays: 1,
  durationLabel: null,
  reviewNote: null,
};

describe('buildFlexMessage localization', () => {
  it('renders Thai chrome for th', () => {
    const m = buildFlexMessage(leaveApproved, 'https://x', 'th');
    expect(headerText(m)).toContain('อนุมัติคำขอลา');
    expect(m.altText).toContain('ได้รับการอนุมัติ');
  });

  it('renders English chrome for en', () => {
    const m = buildFlexMessage(leaveApproved, 'https://x', 'en');
    expect(headerText(m)).toContain('Leave approved');
    expect(m.altText).toContain('approved');
  });

  it('falls back to English chrome for an untranslated locale (km)', () => {
    const m = buildFlexMessage(leaveApproved, 'https://x', 'km');
    expect(headerText(m)).toContain('Leave approved');
  });

  it('passes the dynamic leaveTypeName through untranslated', () => {
    const m = buildFlexMessage(leaveApproved, 'https://x', 'en');
    expect(m.altText).toContain('ลาป่วย');
  });
});

describe('buildFlexMessage deduction notice', () => {
  it('includes the formatted deductAmount when provided', () => {
    const m = buildFlexMessage({ ...leaveApproved, deductAmount: 123.45 }, 'https://x', 'en');
    expect(JSON.stringify(m)).toContain('123.45');
  });

  it('does not include a deduction string when deductAmount is absent', () => {
    const m = buildFlexMessage(leaveApproved, 'https://x', 'en');
    expect(JSON.stringify(m)).not.toContain('deducted');
  });
});

// Regression guard: every notification kind must render non-empty, fully
// resolved chrome in both th and en (no missing-key fallout — a missing
// key would surface as a raw dotted path like "leaveApproved.header").
const allKinds = [
  leaveApproved,
  { ...leaveApproved, kind: 'leave.rejected' as const, workingDays: null },
  {
    kind: 'advance.approved' as const,
    cashAdvanceId: 'a1',
    employeeFirstName: 'Aung',
    amount: '12,500.00',
  },
  {
    kind: 'advance.rejected' as const,
    cashAdvanceId: 'a2',
    employeeFirstName: 'Aung',
    amount: '500.00',
  },
  {
    kind: 'attendance.dispute-approved' as const,
    attendanceId: 'at1',
    employeeFirstName: 'Aung',
    date: '2026-05-12',
    reviewNote: 'ok',
  },
  {
    kind: 'attendance.dispute-rejected' as const,
    attendanceId: 'at2',
    employeeFirstName: 'Aung',
    date: '2026-05-12',
    reviewNote: 'no',
  },
  {
    kind: 'payroll.published' as const,
    payrollId: 'p1',
    month: '2026-06',
    employeeFirstName: 'Aung',
    netPay: '28,500.00',
  },
  {
    kind: 'advance.paid' as const,
    cashAdvanceId: 'a3',
    employeeFirstName: 'Aung',
    amount: '3,000.00',
  },
  {
    kind: 'admin.leave-submitted' as const,
    leaveRequestId: 'r9',
    employeeName: 'Aung Min',
    leaveTypeName: 'ลาป่วย',
    startDate: '2026-06-15',
    endDate: '2026-06-16',
  },
  {
    kind: 'admin.advance-submitted' as const,
    cashAdvanceId: 'a9',
    employeeName: 'Aung Min',
    amount: '2,000.00',
  },
  {
    kind: 'admin.dispute-submitted' as const,
    attendanceId: 'at9',
    employeeName: 'Aung Min',
    date: '2026-06-10',
    reason: 'ลืมเช็คอิน',
  },
];

const footerActionUri = (m: messagingApi.FlexMessage): string => {
  const b = m.contents as Bubble;
  const footer = b.footer as messagingApi.FlexBox;
  const button = footer.contents?.[0] as messagingApi.FlexButton;
  return (button.action as messagingApi.URIAction).uri ?? '';
};

describe('buildFlexMessage new kinds (advance.paid + admin.*)', () => {
  it('advance.paid deep-links to the advance LIFF page with a green header', () => {
    const m = buildFlexMessage(allKinds[7] as (typeof allKinds)[number], 'https://x', 'th');
    expect(footerActionUri(m)).toBe('https://x/liff/advance/a3');
    const header = (m.contents as Bubble).header as messagingApi.FlexBox;
    expect(header.backgroundColor).toBe('#16a34a');
  });

  it('admin.leave-submitted deep-links to the admin leave review page', () => {
    const m = buildFlexMessage(allKinds[8] as (typeof allKinds)[number], 'https://x', 'th');
    expect(footerActionUri(m)).toBe('https://x/liff/admin/leave/r9');
  });

  it('admin.advance-submitted deep-links to the admin advance review page', () => {
    const m = buildFlexMessage(allKinds[9] as (typeof allKinds)[number], 'https://x', 'th');
    expect(footerActionUri(m)).toBe('https://x/liff/admin/advance/a9');
  });

  it('admin.dispute-submitted deep-links to the admin inbox', () => {
    const m = buildFlexMessage(allKinds[10] as (typeof allKinds)[number], 'https://x', 'th');
    expect(footerActionUri(m)).toBe('https://x/liff/admin/inbox');
  });
});

describe('buildFlexMessage payroll.published', () => {
  it('shows net pay and deep-links to the LIFF payslip for the month', () => {
    const m = buildFlexMessage(allKinds[6] as (typeof allKinds)[number], 'https://x', 'th');
    const b = m.contents as Bubble;
    const footer = b.footer as messagingApi.FlexBox;
    const button = footer.contents?.[0] as messagingApi.FlexButton;
    const action = button.action as messagingApi.URIAction;
    expect(action.uri).toBe('https://x/liff/payslip?m=2026-06');
    expect(m.altText).toContain('28,500.00');
    // Thai month label with Buddhist year.
    expect(m.altText).toContain('มิถุนายน 2569');
  });
});

describe('buildFlexMessage covers every kind without missing keys', () => {
  for (const locale of ['th', 'en', 'my', 'zh-CN'] as const) {
    for (const payload of allKinds) {
      it(`${payload.kind} renders resolved chrome in ${locale}`, () => {
        const m = buildFlexMessage(payload, 'https://x', locale);
        const header = headerText(m);
        expect(header.length).toBeGreaterThan(0);
        expect(m.altText.length).toBeGreaterThan(0);
        // A failed lookup would echo the dotted key path — assert it doesn't.
        expect(header).not.toMatch(/^[a-z]+\.[a-zA-Z.]+$/);
        expect(m.altText).not.toContain('.alt');
      });
    }
  }
});
