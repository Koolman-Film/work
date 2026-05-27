/**
 * Translate Supabase auth errors to Thai user-facing messages.
 *
 * Strategy B (per docs/v2 design): reveal operationally-useful state
 * (account banned, rate limited) but keep credential errors generic so
 * the small admin email list can't be enumerated.
 *
 * Lives outside login/actions.ts because Server-Action modules require
 * every export to be async — this is a pure synchronous helper that's
 * also unit-testable in isolation.
 */

export function loginErrorMessage(error: {
  code?: string;
  message?: string;
  status?: number;
}): string {
  switch (error.code) {
    case 'user_banned':
      return 'บัญชีถูกระงับ — ติดต่อแอดมิน';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'พยายามล็อกอินบ่อยเกินไป รออีกสักครู่แล้วลองใหม่';
    case 'invalid_credentials':
    case 'email_not_confirmed':
      return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    default:
      // Status 5xx → Supabase internal; tell the user it's not them.
      if (error.status && error.status >= 500) {
        return 'เกิดข้อผิดพลาดของระบบ ลองอีกครั้งในอีกสักครู่';
      }
      // Default to generic credential message — defends against enumeration.
      return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  }
}
