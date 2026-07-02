'use server';

import { ADMIN_LINE_LINK_ENABLED } from '@/lib/auth/admin-line-feature';
import { mergeAdminIntoEmployee } from '@/lib/auth/merge-admin-into-employee';
import { prisma } from '@/lib/db/prisma';
import { verifyMergeToken } from '@/lib/pairing/token';
import { createClient } from '@/lib/supabase/server';

type Out = { ok: true } | { ok: false; code: string; message: string };
type Parties = {
  adminUserId: string;
  adminEmail: string | null;
  employeeUserId: string;
  employeeName: string;
  lineUserId: string;
};

/**
 * Validate the merge token against the current LINE session and resolve both
 * parties — WITHOUT mutating anything. Shared by the preview (confirm screen)
 * and the actual link, so the same single-use / expiry / membership checks run
 * in both. The merge only proceeds once the employee taps confirm.
 *
 * Identity is STATED by the signed token (verifyMergeToken → { adminUserId,
 * employeeUserId }), never inferred from the session. The LINE session only
 * establishes consent: the scanning LINE must belong to one side of the stated
 * pair (admin row OR employee row), or be unbound. Bound to anyone else → reject.
 */
async function resolveMergeParties(
  mergeToken: string,
): Promise<{ ok: true; parties: Parties } | { ok: false; code: string; message: string }> {
  if (!ADMIN_LINE_LINK_ENABLED) {
    return { ok: false, code: 'disabled', message: 'ฟีเจอร์เชื่อมบัญชีถูกปิดใช้งานชั่วคราว' };
  }
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { ok: false, code: 'no-session', message: 'ไม่พบเซสชัน กรุณาลองใหม่' };

  const lineSub = (authUser.identities ?? []).find((i) => i.provider === 'custom:line')?.id;
  if (!lineSub) return { ok: false, code: 'not-line', message: 'ต้องเข้าสู่ระบบด้วยบัญชี LINE' };

  // Identity is STATED by the signed token, never inferred from the session.
  let adminUserId: string;
  let employeeUserId: string;
  try {
    ({ adminUserId, employeeUserId } = await verifyMergeToken(mergeToken));
  } catch {
    return { ok: false, code: 'invalid-token', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' };
  }

  // The admin must be a live, pure admin still holding this single-use token.
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: {
      email: true,
      mergeToken: true,
      mergeTokenExpiresAt: true,
      archivedAt: true,
      employee: { select: { id: true } },
    },
  });
  if (!admin || admin.archivedAt) return { ok: false, code: 'admin-gone', message: 'ไม่พบบัญชีผู้ดูแล' };
  if (admin.employee) {
    return { ok: false, code: 'admin-not-pure', message: 'บัญชีผู้ดูแลนี้เป็นพนักงานอยู่แล้ว' };
  }
  if (admin.mergeToken !== mergeToken) {
    return { ok: false, code: 'consumed', message: 'ลิงก์ถูกใช้ไปแล้ว กรุณาสร้างใหม่' };
  }
  if (!admin.mergeTokenExpiresAt || admin.mergeTokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'expired', message: 'ลิงก์หมดอายุ กรุณาสร้างใหม่' };
  }

  // The chosen employee must exist and actually be an employee.
  const employee = await prisma.user.findUnique({
    where: { id: employeeUserId },
    select: {
      employee: { select: { firstName: true, lastName: true, nickname: true } },
    },
  });
  if (!employee?.employee) {
    return { ok: false, code: 'not-employee', message: 'บัญชีพนักงานที่เลือกไม่ถูกต้อง' };
  }

  // Consent: the scanning LINE must belong to one side of the stated pair, or be
  // unbound (a fresh LINE the merge will bind to the employee). Bound to anyone
  // else means a stranger scanned the QR — refuse.
  const lineOwner = await prisma.user.findUnique({
    where: { lineUserId: lineSub },
    select: { id: true },
  });
  if (lineOwner && lineOwner.id !== adminUserId && lineOwner.id !== employeeUserId) {
    return { ok: false, code: 'not-a-party', message: 'บัญชี LINE นี้ไม่เกี่ยวข้องกับการเชื่อมบัญชีนี้' };
  }

  const e = employee.employee;
  const employeeName = e.nickname?.trim() || `${e.firstName} ${e.lastName}`.trim();
  return {
    ok: true,
    parties: {
      adminUserId,
      adminEmail: admin.email,
      employeeUserId,
      employeeName,
      lineUserId: lineSub,
    },
  };
}

/**
 * Read-only: resolve who would be linked, for the confirmation screen. Shows the
 * employee BOTH identities before any irreversible-looking action so a
 * mis-scanned QR is caught.
 */
export async function previewMergeAccounts(input: {
  mergeToken: string;
}): Promise<
  | { ok: true; adminEmail: string | null; employeeName: string }
  | { ok: false; code: string; message: string }
> {
  const resolved = await resolveMergeParties(input.mergeToken);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    adminEmail: resolved.parties.adminEmail,
    employeeName: resolved.parties.employeeName,
  };
}

/** Execute the link after the employee confirms. */
export async function linkMergeAccounts(input: { mergeToken: string }): Promise<Out> {
  const resolved = await resolveMergeParties(input.mergeToken);
  if (!resolved.ok) return resolved;

  // Atomically consume the token so concurrent double-scans race on a DB write
  // and only one proceeds. A permanent merge failure (e.g. line-conflict) after
  // this point burns the token — acceptable; admin regenerates.
  const consumed = await prisma.user.updateMany({
    where: { id: resolved.parties.adminUserId, mergeToken: input.mergeToken },
    data: { mergeToken: null, mergeTokenExpiresAt: null },
  });
  if (consumed.count === 0) {
    return { ok: false, code: 'consumed', message: 'ลิงก์ถูกใช้ไปแล้ว กรุณาสร้างใหม่' };
  }

  const res = await mergeAdminIntoEmployee({
    adminUserId: resolved.parties.adminUserId,
    employeeUserId: resolved.parties.employeeUserId,
    lineUserId: resolved.parties.lineUserId,
  });
  if (!res.ok) return { ok: false, code: res.code, message: 'ไม่สามารถเชื่อมบัญชีได้' };
  return { ok: true };
}
