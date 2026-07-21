import { describe, expect, it } from 'vitest';
import { isNotFoundError } from './is-not-found-error';

describe('isNotFoundError', () => {
  it("true for an Error carrying notFound()'s digest", () => {
    const err = Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;404'), {
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
    expect(isNotFoundError(err)).toBe(true);
  });

  it('false for a forbidden()/unauthorized() digest (different status)', () => {
    const err = Object.assign(new Error('x'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;403' });
    expect(isNotFoundError(err)).toBe(false);
  });

  it('false for a plain Error with no digest (e.g. a P2028 timeout)', () => {
    expect(isNotFoundError(new Error('boom'))).toBe(false);
  });

  it('false for non-object values', () => {
    expect(isNotFoundError('boom')).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
  });
});
