import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn (class-name combiner)', () => {
  it('joins string args with spaces', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy values (clsx behavior)', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('resolves Tailwind conflicts with last-one-wins (tailwind-merge)', () => {
    // tailwind-merge is the reason we use cn() instead of plain clsx —
    // when conditional classes might override base ones, we get the right answer.
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
  });

  it('handles object syntax (clsx feature)', () => {
    expect(cn('a', { b: true, c: false, d: true })).toBe('a b d');
  });

  it('handles array nesting', () => {
    expect(cn(['a', 'b'], 'c')).toBe('a b c');
  });

  it('returns empty string for no args', () => {
    expect(cn()).toBe('');
  });
});
