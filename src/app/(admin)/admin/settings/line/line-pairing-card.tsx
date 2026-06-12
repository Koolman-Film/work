'use client';

/**
 * LINE pairing card (client) for /admin/settings/line.
 *
 * Two states from the server:
 *   - paired   → show "เชื่อมต่อแล้ว" + unpair (ConfirmDialog → unpairMyLine)
 *   - unpaired → "สร้างลิงก์เชื่อมต่อ LINE" button → createMyLinePairingLink()
 *                → readonly URL + copy button + open-on-phone hint.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { createMyLinePairingLink, unpairMyLine } from '@/lib/auth/admin-line-pairing-actions';

export function LinePairingCard({ paired }: { paired: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ url: string; qrDataUrl: string; expiresAt: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function createLink() {
    setError(null);
    startTransition(async () => {
      const result = await createMyLinePairingLink();
      if (result.ok) {
        setLink({ url: result.url, qrDataUrl: result.qrDataUrl, expiresAt: result.expiresAt });
      } else {
        setError(result.message);
      }
    });
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('คัดลอกไม่สำเร็จ — กรุณาเลือกข้อความและคัดลอกเอง');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>บัญชี LINE ของฉัน</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {paired ? (
          <>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-success-deep" aria-hidden />
              <p className="text-sm font-medium text-ink-1">เชื่อมต่อแล้ว</p>
            </div>
            <p className="text-sm text-ink-3">
              เมนูแอดมินใช้งานได้ในแชท OA — หากต้องการเปลี่ยนบัญชี LINE ให้ยกเลิกการเชื่อมต่อก่อน แล้วสร้างลิงก์ใหม่
            </p>
            <ConfirmDialog
              trigger={(open) => (
                <Button type="button" variant="destructive" onClick={open}>
                  ยกเลิกการเชื่อมต่อ
                </Button>
              )}
              title="ยกเลิกการเชื่อมต่อ LINE?"
              description="เมนูแอดมินในแชท OA จะถูกถอดออก และจะไม่ได้รับการแจ้งเตือนทาง LINE จนกว่าจะเชื่อมต่อใหม่"
              confirmLabel="ยกเลิกการเชื่อมต่อ"
              tone="danger"
              action={async () => {
                // ConfirmDialog shows `{ ok:false, message }` inline — convert
                // thrown server-action failures into that shape so unpair
                // errors surface instead of rejecting silently.
                try {
                  return await unpairMyLine();
                } catch {
                  return { ok: false, message: 'ยกเลิกการเชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
                }
              }}
            />
          </>
        ) : (
          <>
            <p className="text-sm text-ink-3">ยังไม่ได้เชื่อมต่อ LINE — สร้างลิงก์แล้วเปิดบนมือถือเพื่อเชื่อมบัญชี</p>
            {link ? (
              <div className="space-y-2">
                {/* QR first — the common case is admin-at-desktop scanning
                    with the phone (LINE scanner or camera both work; the
                    liff.line.me URL opens straight into the LIFF app). */}
                <div className="flex justify-center">
                  {/* biome-ignore lint/performance/noImgElement: data URL — next/image adds nothing */}
                  <img
                    src={link.qrDataUrl}
                    alt="QR code สำหรับเชื่อมต่อ LINE"
                    width={224}
                    height={224}
                    className="rounded-lg border border-gray-200 bg-white p-2"
                  />
                </div>
                <p className="text-center text-xs text-ink-4">
                  สแกน QR ด้วยมือถือ (กล้อง หรือ LINE → สแกน QR) — หรือคัดลอกลิงก์ด้านล่าง
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={link.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-ink-2"
                    aria-label="ลิงก์เชื่อมต่อ LINE"
                  />
                  <Button type="button" variant="secondary" onClick={copyLink}>
                    {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
                  </Button>
                </div>
                <p className="text-xs text-ink-4">
                  เปิดลิงก์นี้บนมือถือในแอป LINE (ส่งลิงก์เข้าแชทตัวเองได้) — ลิงก์ใช้ได้ครั้งเดียว หมดอายุ{' '}
                  {new Date(link.expiresAt).toLocaleTimeString('th-TH', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  น.
                </p>
                <p className="text-xs text-ink-4">เชื่อมต่อเสร็จแล้ว กด refresh หน้านี้เพื่ออัปเดตสถานะ</p>
                <Button type="button" variant="secondary" onClick={() => router.refresh()}>
                  รีเฟรชสถานะ
                </Button>
              </div>
            ) : (
              <Button type="button" onClick={createLink} disabled={pending}>
                {pending ? 'กำลังสร้างลิงก์…' : 'สร้างลิงก์เชื่อมต่อ LINE'}
              </Button>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger-deep">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
