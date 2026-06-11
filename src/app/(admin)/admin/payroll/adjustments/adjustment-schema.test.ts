import { describe, expect, it } from 'vitest';
import { frequencyOf, readForm } from './adjustment-schema';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const BASE = {
  employeeId: '7d4f9e60-0000-4000-8000-000000000001',
  kind: 'Income',
  reason: 'ค่าคอมมิชชั่น',
  amount: '1500.50',
  frequency: 'once',
  startMonth: '2026-06',
};

describe('adjustment readForm', () => {
  it('once → endMonth = startMonth', () => {
    const r = readForm(fd(BASE));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.endMonth).toBe('2026-06');
      expect(r.data.amount).toBe('1500.50');
    }
  });

  it('monthly → endMonth = null', () => {
    const r = readForm(fd({ ...BASE, frequency: 'monthly' }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.endMonth).toBeNull();
  });

  it('range → keeps endMonth, validates order', () => {
    const ok = readForm(fd({ ...BASE, frequency: 'range', endMonth: '2026-08' }));
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.endMonth).toBe('2026-08');

    const bad = readForm(fd({ ...BASE, frequency: 'range', endMonth: '2026-05' }));
    expect(bad.success).toBe(false);

    const missing = readForm(fd({ ...BASE, frequency: 'range' }));
    expect(missing.success).toBe(false);
  });

  it('rejects zero/negative/malformed amounts', () => {
    expect(readForm(fd({ ...BASE, amount: '0' })).success).toBe(false);
    expect(readForm(fd({ ...BASE, amount: '-50' })).success).toBe(false);
    expect(readForm(fd({ ...BASE, amount: '1.234' })).success).toBe(false);
  });

  it('rejects malformed month strings', () => {
    expect(readForm(fd({ ...BASE, startMonth: '2026-13' })).success).toBe(false);
    expect(readForm(fd({ ...BASE, startMonth: '06-2026' })).success).toBe(false);
  });
});

describe('frequencyOf', () => {
  it('round-trips the three storage shapes', () => {
    expect(frequencyOf('2026-06', '2026-06')).toBe('once');
    expect(frequencyOf('2026-06', null)).toBe('monthly');
    expect(frequencyOf('2026-06', '2026-08')).toBe('range');
  });
});
