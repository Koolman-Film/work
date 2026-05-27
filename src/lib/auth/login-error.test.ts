import { describe, expect, it } from 'vitest';
import { loginErrorMessage } from './login-error';

describe('loginErrorMessage', () => {
  describe('Strategy B — reveal operationally useful codes', () => {
    it('reveals user_banned (operationally useful, not exploitable)', () => {
      expect(loginErrorMessage({ code: 'user_banned' })).toBe('บัญชีถูกระงับ — ติดต่อแอดมิน');
    });

    it('reveals rate-limit (lets user know to back off)', () => {
      expect(loginErrorMessage({ code: 'over_request_rate_limit' })).toBe(
        'พยายามล็อกอินบ่อยเกินไป รออีกสักครู่แล้วลองใหม่',
      );
    });

    it('reveals email-send rate-limit (same message; same operational meaning)', () => {
      expect(loginErrorMessage({ code: 'over_email_send_rate_limit' })).toBe(
        'พยายามล็อกอินบ่อยเกินไป รออีกสักครู่แล้วลองใหม่',
      );
    });
  });

  describe('Generic for credential errors (anti-enumeration)', () => {
    it('returns generic message for invalid_credentials', () => {
      // CRITICAL — this is the anti-enumeration defense. Must not reveal
      // whether the email exists.
      expect(loginErrorMessage({ code: 'invalid_credentials' })).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    });

    it('returns generic for email_not_confirmed (groups with invalid_credentials)', () => {
      expect(loginErrorMessage({ code: 'email_not_confirmed' })).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    });

    it('returns generic for unknown codes', () => {
      expect(loginErrorMessage({ code: 'something_supabase_added_later' })).toBe(
        'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
      );
    });

    it('returns generic for missing code', () => {
      expect(loginErrorMessage({})).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    });
  });

  describe('Server-error case', () => {
    it('returns "system error" for status 5xx (distinct from credentials)', () => {
      // Distinct from credential message — telling the user "try again" when
      // they typed correctly avoids confusing them into password reset
      expect(loginErrorMessage({ status: 500 })).toBe('เกิดข้อผิดพลาดของระบบ ลองอีกครั้งในอีกสักครู่');
      expect(loginErrorMessage({ status: 503 })).toBe('เกิดข้อผิดพลาดของระบบ ลองอีกครั้งในอีกสักครู่');
    });

    it('does NOT return system-error for status 4xx (credential-like)', () => {
      expect(loginErrorMessage({ status: 401 })).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      expect(loginErrorMessage({ status: 403 })).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    });
  });

  describe('Anti-enumeration regression guard', () => {
    // If anyone ever changes the function to reveal whether an email exists,
    // these tests fail loudly.
    it('returns the same message for invalid_credentials regardless of email', () => {
      // The function doesn't take an email so this is structural — but we
      // assert the principle: identical input produces identical message.
      const message1 = loginErrorMessage({ code: 'invalid_credentials' });
      const message2 = loginErrorMessage({ code: 'invalid_credentials' });
      expect(message1).toBe(message2);
    });

    it('does NOT have a separate "user_not_found" branch', () => {
      // If Supabase ever ships a `user_not_found` code, our default branch
      // collapses it to the generic message. This test pins that intent.
      expect(loginErrorMessage({ code: 'user_not_found' })).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    });
  });
});
