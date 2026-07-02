import { describe, expect, it } from 'vitest';
import { pickPreviewSource } from './preview';

describe('pickPreviewSource', () => {
  it('Draft → recompute (live engine, may still change)', () => {
    expect(pickPreviewSource('Draft')).toBe('recompute');
  });
  it('Published → frozen (exactly what the employee received)', () => {
    expect(pickPreviewSource('Published')).toBe('frozen');
  });
  it('Locked → frozen', () => {
    expect(pickPreviewSource('Locked')).toBe('frozen');
  });
});
