/**
 * Public pairing-link landing page.
 *
 * URL: /i/<token>
 *
 * Acts as a smart router for the LINE pairing flow:
 *   - Token invalid / expired   → render a friendly "ขอลิงก์ใหม่" page
 *   - Has LINE on this device   → redirect into LIFF with the token in the
 *                                  query string (W3 builds /liff/pair which
 *                                  reads it and runs signInWithIdToken)
 *   - No LINE                   → show install LINE prompt + a "I'm in LINE
 *                                  now" link the user can tap once they
 *                                  install + return
 *
 * UA detection is server-side via the User-Agent header. In LINE in-app
 * browser the UA includes 'Line/' followed by a version number.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { verifyPairingToken } from '@/lib/pairing/token';

type Params = Promise<{ token: string }>;

export default async function PairingLandingPage({ params }: { params: Params }) {
  const { token } = await params;

  // Decode token (cheap — local verify, no DB round-trip yet)
  let employeeId: string;
  try {
    const payload = await verifyPairingToken(token);
    employeeId = payload.employeeId;
  } catch {
    return <ExpiredLink reason="invalid" />;
  }

  // Confirm token is still the active one for this employee (single-use)
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      firstName: true,
      inviteToken: true,
      inviteExpiresAt: true,
      archivedAt: true,
      user: { select: { lineUserId: true } },
    },
  });
  if (!emp) return <ExpiredLink reason="invalid" />;
  if (emp.archivedAt) return <ExpiredLink reason="archived" />;
  if (emp.user.lineUserId) return <ExpiredLink reason="already-linked" />;
  if (emp.inviteToken !== token) return <ExpiredLink reason="revoked" />;
  if (emp.inviteExpiresAt && emp.inviteExpiresAt.getTime() < Date.now()) {
    return <ExpiredLink reason="expired" />;
  }

  // Determine if we should bounce into LIFF or show the install-LINE page
  const headerList = await headers();
  const ua = headerList.get('user-agent') ?? '';
  const inLineApp = /\bLine\//i.test(ua);

  if (inLineApp) {
    // Bounce directly into LIFF; the W3 /liff/pair page reads ?pair=... and
    // calls signInWithIdToken + linkLineToEmployee.
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? '';
    if (liffId) {
      redirect(`https://liff.line.me/${liffId}?pair=${encodeURIComponent(token)}`);
    }
  }

  // Fallback: install-LINE prompt (and a manual "I'm in LINE now" link)
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? '';
  const liffUrl = liffId ? `https://liff.line.me/${liffId}?pair=${encodeURIComponent(token)}` : '#';

  return (
    <div className="grid min-h-dvh place-items-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <p className="text-sm text-gray-500">Koolman HR</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-900">สวัสดี, {emp.firstName}</h1>
          <p className="mt-2 text-sm text-gray-600">เปิดลิงก์นี้ในแอป LINE เพื่อเริ่มเชื่อมบัญชี</p>
        </div>

        <div className="space-y-3 text-sm">
          <p>
            <strong>ยังไม่มี LINE?</strong> ติดตั้งก่อนแล้วกลับมาเปิดลิงก์นี้
          </p>
          <div className="flex justify-center gap-2">
            <a
              href="https://apps.apple.com/app/line/id443904275"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              App Store
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=jp.naver.line.android"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Google Play
            </a>
          </div>
        </div>

        {liffId && (
          <a
            href={liffUrl}
            className="block rounded-md bg-primary-600 px-4 py-2.5 text-center text-sm font-medium text-white shadow-sm hover:bg-primary-700"
          >
            เปิดในแอป LINE →
          </a>
        )}
      </div>
    </div>
  );
}

function ExpiredLink({
  reason,
}: {
  reason: 'invalid' | 'expired' | 'revoked' | 'archived' | 'already-linked';
}) {
  const messages: Record<typeof reason, { title: string; body: string }> = {
    invalid: {
      title: 'ลิงก์ไม่ถูกต้อง',
      body: 'ลิงก์นี้อาจถูกพิมพ์ผิด หรือเป็นลิงก์ปลอม โปรดติดต่อแอดมินเพื่อขอลิงก์ใหม่.',
    },
    expired: {
      title: 'ลิงก์หมดอายุ',
      body: 'ลิงก์นี้หมดอายุแล้ว (24 ชั่วโมง) โปรดติดต่อแอดมินเพื่อขอลิงก์ใหม่.',
    },
    revoked: {
      title: 'ลิงก์ถูกยกเลิก',
      body: 'แอดมินยกเลิกลิงก์นี้ หรือสร้างลิงก์ใหม่ ใช้ลิงก์ล่าสุดที่ได้รับ.',
    },
    archived: {
      title: 'ไม่สามารถเชื่อมบัญชีได้',
      body: 'บัญชีพนักงานนี้พ้นสภาพแล้ว โปรดติดต่อแอดมินหากเข้าใจผิด.',
    },
    'already-linked': {
      title: 'เชื่อมบัญชี LINE แล้ว',
      body: 'บัญชีนี้เชื่อม LINE เรียบร้อยแล้ว เปิดแอป LINE ของคุณเพื่อใช้งาน Koolman HR.',
    },
  };
  const m = messages[reason];

  return (
    <div className="grid min-h-dvh place-items-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm space-y-3 rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-gray-500">Koolman HR</p>
        <h1 className="text-xl font-semibold text-gray-900">{m.title}</h1>
        <p className="text-sm text-gray-600">{m.body}</p>
      </div>
    </div>
  );
}
