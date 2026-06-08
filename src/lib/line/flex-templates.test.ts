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
];

describe('buildFlexMessage covers every kind without missing keys', () => {
  for (const locale of ['th', 'en'] as const) {
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
