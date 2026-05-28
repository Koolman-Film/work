'use server';

/**
 * Self-service password change for the logged-in Admin / Owner.
 *
 * Why this exists as a third password-change path (on top of /update-password
 * and the admin team-edit reset):
 *
 *   - `/update-password` (auth flow): proves email ownership via the
 *     recovery-token session that arrived from a reset-email link. No
 *     current-password check because the link itself was the proof.
 *
 *   - `/admin/settings/team/[id]/edit`: an admin/owner overriding ANOTHER
 *     user's password (forgot-the-temp-password rescue, or password leak
 *     forcing a rotation). The actor isn't proving identity of the
 *     target — they're authorized to act on the target's behalf.
 *
 *   - This action (`changeMyPassword`): the caller IS the target, they
 *     have a live session (because they're submitting an admin form),
 *     but we still demand the *current* password. Reason: a hijacked or
 *     forgotten-unlocked session shouldn't be able to lock the real
 *     owner out by setting a new password. Re-auth via
 *     `signInWithPassword` is the well-trodden way to confirm "yes,
 *     you still know the secret" without forcing a full logout/login
 *     round-trip.
 *
 * Implementation note: `supabase.auth.signInWithPassword` issues a
 * brand-new session if it succeeds, but the SSR client's cookie store
 * just updates the existing cookies in-place — no logout/login from
 * the user's perspective. After the re-auth succeeds we call
 * `updateUser({ password })` against the same session.
 *
 * Audit: emits `user.password-change` (distinct from `user.password-reset`
 * so the audit viewer can show "self-service" vs "admin-issued" cleanly).
 * We NEVER log the passwords themselves — only the actor + outcome.
 */

import { headers } from 'next/headers';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';

// ─── Result shape ──────────────────────────────────────────────────────────

export type ChangePasswordResult =
  | { ok: true; message: string }
  | {
      ok: false;
      // Field-level error key so the form can highlight the right input.
      field: 'currentPassword' | 'newPassword' | 'confirmPassword' | 'form';
      message: string;
    };

// ─── Validation ────────────────────────────────────────────────────────────

const Schema = z
  .object({
    currentPassword: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน'),
    newPassword: z.string().min(8, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร').max(72, 'รหัสผ่านยาวเกินไป'),
    confirmPassword: z.string().min(1, 'กรุณายืนยันรหัสผ่านใหม่'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'รหัสผ่านใหม่ต้องไม่เหมือนรหัสผ่านปัจจุบัน',
    path: ['newPassword'],
  });

// ─── Action ────────────────────────────────────────────────────────────────

export async function changeMyPassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<ChangePasswordResult> {
  const { user } = await requireRole(['Admin', 'Owner']);

  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // Zod's `path[0]` for our schema is one of our field names; if it's
    // something else (cross-field refine with no path, etc.) we fall
    // back to 'form' which renders the message at the top of the form.
    const path = first?.path[0];
    const field: ChangePasswordResult & { ok: false } extends { field: infer F } ? F : never =
      path === 'currentPassword' || path === 'newPassword' || path === 'confirmPassword'
        ? path
        : 'form';
    return {
      ok: false,
      field,
      message: first?.message ?? 'ข้อมูลไม่ถูกต้อง',
    };
  }

  if (!user.email) {
    // Admin/Owner accounts always have an email (it's how they log in).
    // Defensive — if somehow null, we can't re-auth.
    return {
      ok: false,
      field: 'form',
      message: 'บัญชีของคุณไม่มีอีเมล — ติดต่อทีมพัฒนา',
    };
  }

  const supabase = await createClient();

  // Step 1: re-authenticate to prove they know the current password.
  // signInWithPassword refreshes the session cookies in place — no
  // perceptible logout/login from the user's perspective.
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });

  if (signInErr) {
    // Distinguish "wrong current password" from other failures.
    // Supabase returns code 'invalid_credentials' for bad password.
    if (signInErr.code === 'invalid_credentials' || signInErr.status === 400) {
      return {
        ok: false,
        field: 'currentPassword',
        message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
      };
    }
    console.error('[changeMyPassword] re-auth failed', {
      code: signInErr.code,
      status: signInErr.status,
      message: signInErr.message,
    });
    return {
      ok: false,
      field: 'form',
      message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
    };
  }

  // Step 2: update the password on the now-confirmed session.
  const { error: updateErr } = await supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });

  if (updateErr) {
    if (updateErr.code === 'same_password') {
      return {
        ok: false,
        field: 'newPassword',
        message: 'รหัสผ่านใหม่ต้องไม่เหมือนเดิม',
      };
    }
    if (updateErr.code === 'weak_password') {
      return {
        ok: false,
        field: 'newPassword',
        message: 'รหัสผ่านอ่อนเกินไป — ลองยาวขึ้นหรือผสมตัวเลข/สัญลักษณ์',
      };
    }
    console.error('[changeMyPassword] updateUser failed', {
      code: updateErr.code,
      message: updateErr.message,
    });
    return {
      ok: false,
      field: 'form',
      message: 'ไม่สามารถอัปเดตรหัสผ่านได้ ลองอีกครั้ง',
    };
  }

  // Audit — never include the passwords themselves.
  const headerList = await headers();
  auditLog({
    actorId: user.id,
    action: 'user.password-change',
    entityType: 'User',
    entityId: user.id,
    metadata: {
      ip:
        headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        headerList.get('x-real-ip') ??
        undefined,
      userAgent: headerList.get('user-agent') ?? undefined,
      source: 'admin-ui',
      selfService: true,
    },
  });

  return {
    ok: true,
    message: 'เปลี่ยนรหัสผ่านเรียบร้อย ครั้งหน้าให้ใช้รหัสผ่านใหม่ในการล็อกอิน',
  };
}
