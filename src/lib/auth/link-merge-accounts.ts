'use server';

import { mergeAdminIntoEmployee } from '@/lib/auth/merge-admin-into-employee';
import { verifyMergeToken } from '@/lib/pairing/token';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';

type Out = { ok: true } | { ok: false; code: string; message: string };

export async function linkMergeAccounts(input: { mergeToken: string }): Promise<Out> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { ok: false, code: 'no-session', message: 'ไม่พบเซสชัน กรุณาลองใหม่' };

  const lineSub = (authUser.identities ?? []).find((i) => i.provider === 'custom:line')?.id;
  if (!lineSub)
    return { ok: false, code: 'not-line', message: 'ต้องเข้าสู่ระบบด้วยบัญชี LINE ของพนักงาน' };

  // The employee User is whoever this LINE account belongs to.
  const employeeUser = await prisma.user.findUnique({
    where: { lineUserId: lineSub },
    select: { id: true, employee: { select: { id: true } } },
  });
  if (!employeeUser || !employeeUser.employee) {
    return { ok: false, code: 'not-employee', message: 'บัญชี LINE นี้ไม่ใช่พนักงานในระบบ' };
  }

  let adminUserId: string;
  try {
    ({ adminUserId } = await verifyMergeToken(input.mergeToken));
  } catch {
    return { ok: false, code: 'invalid-token', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' };
  }

  // Single-use + not-expired: the live token must still be on the admin row.
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { mergeToken: true, mergeTokenExpiresAt: true, archivedAt: true },
  });
  if (!admin || admin.archivedAt)
    return { ok: false, code: 'admin-gone', message: 'ไม่พบบัญชีผู้ดูแล' };
  if (admin.mergeToken !== input.mergeToken) {
    return { ok: false, code: 'consumed', message: 'ลิงก์ถูกใช้ไปแล้ว กรุณาสร้างใหม่' };
  }
  if (!admin.mergeTokenExpiresAt || admin.mergeTokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'expired', message: 'ลิงก์หมดอายุ กรุณาสร้างใหม่' };
  }

  const res = await mergeAdminIntoEmployee({ adminUserId, employeeUserId: employeeUser.id });
  if (!res.ok) return { ok: false, code: res.code, message: 'ไม่สามารถเชื่อมบัญชีได้' };
  return { ok: true };
}
