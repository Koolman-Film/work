import { describe, expect, it } from 'vitest';
import { STATUS_ICON, STATUS_RAIL, statusRail } from './status-badge';

describe('status rail + icon maps', () => {
  it('covers the four approval statuses with left-border colors', () => {
    for (const k of ['pending', 'approved', 'rejected', 'cancelled'] as const) {
      expect(STATUS_RAIL[k]).toMatch(/^border-l-/);
      expect(STATUS_ICON[k]).toBeTruthy();
    }
  });

  it('statusRail falls back to a neutral border for non-approval keys', () => {
    expect(statusRail('sick')).toBe('border-l-gray-200');
    expect(statusRail('pending')).toBe('border-l-amber-400');
  });
});
