'use server';

/**
 * Employee self-service profile actions for /liff/profile.
 *
 * Scope: an employee may edit ONLY their own contact fields. Employment
 * facts (branch, department, salary, hire date, role) are admin-managed
 * and read-only here. Name fields (firstName/lastName) are also locked —
 * if an employee's legal name changes they ask HR to update.
 *
 * The only-own-record gate uses `requireRole(['Staff'])` which
 * eagerly loads the requestor's Employee row; the update targets THAT
 * row's id, ignoring any client-supplied id. So a malicious client
 * can't update someone else's profile by sending a different employeeId
 * — they don't get to specify one.
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

export type UpdateProfileInput = {
  nickname?: string | null;
  phone?: string | null;
  personalEmail?: string | null;
  address?: string | null;
  emergencyContact?: string | null;
};

export type UpdateProfileResult =
  | { ok: true }
  | {
      ok: false;
      code: 'forbidden' | 'bad-phone' | 'bad-email' | 'too-long' | 'db-error';
      message: string;
      field?: keyof UpdateProfileInput;
    };

// Loose validators — strict regex creates UX friction in Thailand where
// users routinely paste numbers with spaces, dashes, or parentheses.
// We just check that there's a reasonable amount of structure.

const MAX_NICKNAME = 50;
const MAX_ADDRESS = 500;
const MAX_EMERGENCY = 200;
const MAX_EMAIL = 254; // RFC 5321 cap
const MIN_PHONE_DIGITS = 9;
const MAX_PHONE_DIGITS = 15;

function isValidPhone(raw: string): boolean {
  // Count digits regardless of formatting (spaces, dashes, +, parens are fine).
  const digits = raw.replace(/\D/g, '');
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
}

function isValidEmail(raw: string): boolean {
  // RFC-5322 lite — `local@domain.tld` minimum shape. Don't try to be clever
  // about TLDs / IDN — we just want to catch typos like "user@gmail" or
  // missing @, not validate that the address can receive mail.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

/**
 * Normalize an input string before persistence.
 * - trim whitespace
 * - empty string → null (so the column becomes NULL, not "")
 */
function normalize(v: string | null | undefined): string | null {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function updateOwnProfile(input: UpdateProfileInput): Promise<UpdateProfileResult> {
  const { user, employee } = await requireRole(['Staff']);
  if (!employee) {
    return { ok: false, code: 'forbidden', message: 'ไม่พบบัญชีพนักงาน' };
  }
  if (employee.archivedAt || employee.status === 'Archived') {
    return { ok: false, code: 'forbidden', message: 'บัญชีพนักงานนี้พ้นสภาพแล้ว' };
  }

  // Normalize all fields first; validation operates on the normalized form.
  const nickname = normalize(input.nickname);
  const phone = normalize(input.phone);
  const personalEmail = normalize(input.personalEmail);
  const address = normalize(input.address);
  const emergencyContact = normalize(input.emergencyContact);

  // Length caps. Done before format checks so the error message points at the
  // actual problem rather than triggering "bad-phone" on a clearly oversized
  // string of letters.
  if (nickname && nickname.length > MAX_NICKNAME) {
    return {
      ok: false,
      code: 'too-long',
      field: 'nickname',
      message: `ชื่อเล่นยาวเกิน ${MAX_NICKNAME} ตัวอักษร`,
    };
  }
  if (address && address.length > MAX_ADDRESS) {
    return {
      ok: false,
      code: 'too-long',
      field: 'address',
      message: `ที่อยู่ยาวเกิน ${MAX_ADDRESS} ตัวอักษร`,
    };
  }
  if (emergencyContact && emergencyContact.length > MAX_EMERGENCY) {
    return {
      ok: false,
      code: 'too-long',
      field: 'emergencyContact',
      message: `ผู้ติดต่อฉุกเฉินยาวเกิน ${MAX_EMERGENCY} ตัวอักษร`,
    };
  }
  if (personalEmail && personalEmail.length > MAX_EMAIL) {
    return {
      ok: false,
      code: 'too-long',
      field: 'personalEmail',
      message: 'อีเมลยาวเกินไป',
    };
  }

  // Format checks — only when the field is non-null (all are optional).
  if (phone && !isValidPhone(phone)) {
    return {
      ok: false,
      code: 'bad-phone',
      field: 'phone',
      message: 'เบอร์โทรไม่ถูกต้อง (ต้องมี 9-15 หลัก)',
    };
  }
  if (personalEmail && !isValidEmail(personalEmail)) {
    return {
      ok: false,
      code: 'bad-email',
      field: 'personalEmail',
      message: 'รูปแบบอีเมลไม่ถูกต้อง',
    };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    // Capture before-state for audit. We re-read the few fields we mutate
    // rather than the whole employee row to keep the audit payload small.
    const before = await prisma.employee.findUnique({
      where: { id: employee.id },
      select: {
        nickname: true,
        phone: true,
        personalEmail: true,
        address: true,
        emergencyContact: true,
      },
    });

    await prisma.employee.update({
      where: { id: employee.id },
      data: { nickname, phone, personalEmail, address, emergencyContact },
    });

    auditLog({
      actorId: user.id,
      action: 'employee.profile.self-update',
      entityType: 'Employee',
      entityId: employee.id,
      before: before ?? undefined,
      after: { nickname, phone, personalEmail, address, emergencyContact },
      metadata: { ip, userAgent, source: 'liff' },
    });

    revalidatePath('/liff/profile');
    return { ok: true };
  } catch (err) {
    console.error('[updateOwnProfile] db error', err);
    return {
      ok: false,
      code: 'db-error',
      message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
    };
  }
}
