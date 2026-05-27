import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from './copy-button';
import { generatePairingLink, revokePairingLink } from './pairing-actions';

type Props = {
  employeeId: string;
  inviteToken: string | null;
  inviteExpiresAt: Date | null;
  lineUserId: string | null;
  baseUrl: string; // e.g. https://hr.koolman.co (from request headers in caller)
};

/**
 * Server-rendered pairing card. Generates the QR PNG as a data URL on
 * the server so we never round-trip the token to the browser as anything
 * other than the visible UI.
 */
export async function PairingCard({
  employeeId,
  inviteToken,
  inviteExpiresAt,
  lineUserId,
  baseUrl,
}: Props) {
  // Already linked: show "linked" state with unlink option (W3 will add the
  // unlink Server Action; for now this state is read-only display).
  if (lineUserId) {
    return (
      <Card id="pairing">
        <CardHeader>
          <CardTitle>การเชื่อม LINE</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            ✅ พนักงานเชื่อมบัญชี LINE แล้ว
          </div>
          <p className="text-xs text-gray-500">
            LINE userId: <span className="font-mono">{lineUserId}</span>
          </p>
        </CardBody>
      </Card>
    );
  }

  // No outstanding token: show "Generate" CTA
  if (!inviteToken) {
    return (
      <Card id="pairing">
        <CardHeader>
          <CardTitle>การเชื่อม LINE</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-gray-600">ยังไม่ได้ส่งลิงก์ — สร้างลิงก์เพื่อให้พนักงานเชื่อมบัญชี LINE</p>
          <form action={generatePairingLink.bind(null, employeeId)}>
            <Button type="submit">📩 สร้างลิงก์ LINE</Button>
          </form>
        </CardBody>
      </Card>
    );
  }

  // Has an outstanding token: show URL + QR + regenerate/revoke
  const expired = inviteExpiresAt && inviteExpiresAt.getTime() < Date.now();
  const url = `${baseUrl}/i/${inviteToken}`;
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: 256,
    margin: 2,
    errorCorrectionLevel: 'M',
  });

  const expiresLabel = inviteExpiresAt
    ? new Intl.DateTimeFormat('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(inviteExpiresAt)
    : '—';

  return (
    <Card id="pairing">
      <CardHeader>
        <CardTitle>การเชื่อม LINE</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {expired ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            ⚠️ ลิงก์หมดอายุแล้ว — สร้างใหม่ด้านล่าง
          </p>
        ) : (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⏳ รอพนักงานเปิดลิงก์ใน LINE — หมดอายุ <strong>{expiresLabel}</strong>
          </p>
        )}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">ลิงก์</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs">
                  {url}
                </code>
                <CopyButton text={url} />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              ส่งให้พนักงานทาง LINE / SMS / email หรือพิมพ์ QR แล้วให้สแกน
            </p>
          </div>

          <div className="flex flex-col items-center gap-2">
            {/* biome-ignore lint/performance/noImgElement: data: URL QR codes can't go through next/image (no remote loader needed) */}
            <img
              src={qrDataUrl}
              alt="QR สำหรับเชื่อม LINE"
              width={160}
              height={160}
              className="rounded border border-gray-200"
            />
            <a
              href={qrDataUrl}
              download={`koolman-work-pair-${employeeId.slice(0, 8)}.png`}
              className="text-xs text-primary-600 hover:text-primary-700"
            >
              ดาวน์โหลด QR
            </a>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
          <form action={revokePairingLink.bind(null, employeeId)}>
            <Button type="submit" variant="ghost" size="sm">
              ยกเลิกลิงก์
            </Button>
          </form>
          <form action={generatePairingLink.bind(null, employeeId)}>
            <Button type="submit" variant="secondary" size="sm">
              🔄 สร้างลิงก์ใหม่
            </Button>
          </form>
        </div>
      </CardBody>
    </Card>
  );
}
