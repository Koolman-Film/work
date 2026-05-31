import { describe, expect, it } from 'vitest';
import { assertAdvanceVoidable } from './void-guards';

describe('assertAdvanceVoidable', () => {
  it('allows voiding a non-deducted, live advance', () => {
    expect(assertAdvanceVoidable({ isDeducted: false, deletedAt: null })).toEqual({ ok: true });
  });

  it('blocks voiding an already-deducted advance', () => {
    const r = assertAdvanceVoidable({ isDeducted: true, deletedAt: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('already-deducted');
  });

  it('blocks voiding an already-voided advance', () => {
    const r = assertAdvanceVoidable({ isDeducted: false, deletedAt: new Date() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('already-voided');
  });

  it('reports already-voided even when also deducted (voided takes precedence)', () => {
    const r = assertAdvanceVoidable({ isDeducted: true, deletedAt: new Date() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('already-voided');
  });
});
