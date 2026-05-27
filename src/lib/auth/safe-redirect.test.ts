import { describe, expect, it } from 'vitest';
import { safeRedirect } from './safe-redirect';

describe('safeRedirect', () => {
  describe('accepts safe relative paths', () => {
    it('passes through a simple path', () => {
      expect(safeRedirect('/admin')).toBe('/admin');
    });

    it('preserves query string', () => {
      expect(safeRedirect('/admin/employees?status=archived')).toBe(
        '/admin/employees?status=archived',
      );
    });

    it('preserves fragment', () => {
      expect(safeRedirect('/admin/employees#pairing')).toBe('/admin/employees#pairing');
    });

    it('preserves deep paths', () => {
      expect(safeRedirect('/admin/settings/branches/abc-123/edit')).toBe(
        '/admin/settings/branches/abc-123/edit',
      );
    });
  });

  describe('rejects open-redirect attack vectors', () => {
    it('rejects absolute HTTPS URLs', () => {
      expect(safeRedirect('https://evil.com')).toBe('/');
      expect(safeRedirect('https://evil.com/admin')).toBe('/');
    });

    it('rejects absolute HTTP URLs', () => {
      expect(safeRedirect('http://evil.com')).toBe('/');
    });

    it('rejects protocol-relative URLs (the //evil.com classic)', () => {
      // The browser interprets //evil.com as protocol-inherited absolute
      // — this is the most common open-redirect bypass. Critical we reject it.
      expect(safeRedirect('//evil.com')).toBe('/');
      expect(safeRedirect('//evil.com/admin')).toBe('/');
    });

    it('rejects javascript: URLs', () => {
      // Wouldn't pass startsWith('/') anyway, but worth documenting intent.
      expect(safeRedirect('javascript:alert(1)')).toBe('/');
    });

    it('rejects data: URLs', () => {
      expect(safeRedirect('data:text/html,<script>alert(1)</script>')).toBe('/');
    });

    it('rejects relative paths missing leading slash', () => {
      // "admin" (no slash) could be parsed as a relative-to-current-path
      // URL; safer to refuse than to guess.
      expect(safeRedirect('admin')).toBe('/');
    });
  });

  describe('handles edge cases', () => {
    it('returns fallback for empty string', () => {
      expect(safeRedirect('')).toBe('/');
    });

    it('returns fallback for null', () => {
      expect(safeRedirect(null)).toBe('/');
    });

    it('returns fallback for undefined', () => {
      expect(safeRedirect(undefined)).toBe('/');
    });

    it('returns fallback for non-string (defensive)', () => {
      // FormData.get() can return File; we should never blow up on type mismatch
      expect(safeRedirect(42)).toBe('/');
      expect(safeRedirect({ foo: 'bar' })).toBe('/');
    });

    it('honors a custom fallback', () => {
      expect(safeRedirect('https://evil.com', '/login')).toBe('/login');
    });
  });
});
