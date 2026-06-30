'use client';

/**
 * Branch logo field — preview + upload + remove. Lives inside the branch
 * <form>; compresses the picked image to PNG, uploads via the admin's browser
 * Supabase session, and writes the storage key into a hidden `payslipLogoKey`
 * input the server action persists. Mirrors the employee PhotoField.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { compressToPng, uploadBranchLogo } from '@/lib/storage/upload-selfie';
import { createClient } from '@/lib/supabase/browser';

type Props = {
  branchId: string | null;
  initialKey: string | null;
  initialUrl: string | null;
};

function errMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'อัปโหลดโลโก้ไม่สำเร็จ';
}

export function BranchLogoField({ branchId, initialKey, initialUrl }: Props) {
  const [key, setKey] = useState<string>(initialKey ?? '');
  const [preview, setPreview] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        throw { kind: 'upload-failed', message: 'ไม่พบเซสชันผู้ดูแล กรุณาเข้าสู่ระบบใหม่' };
      }
      const blob = await compressToPng(file);
      const { key: newKey } = await uploadBranchLogo(supabase, blob, authData.user.id, branchId);
      setKey(newKey);
      setPreview(URL.createObjectURL(blob));
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onRemove() {
    setKey('');
    setPreview(null);
    setError(null);
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name="payslipLogoKey" value={key} />
      <div className="flex items-center gap-4">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-gray-100 text-ink-3">
          {preview ? (
            // biome-ignore lint/performance/noImgElement: client preview is an object-URL / signed URL next/image can't optimize
            <img src={preview} alt="โลโก้สาขา" className="size-full object-contain" />
          ) : (
            <span className="text-xs">ไม่มีโลโก้</span>
          )}
        </div>
        <div className="space-y-2">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-gray-50">
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={(e) => void onPick(e)}
              disabled={busy}
            />
            {busy ? 'กำลังอัปโหลด...' : preview ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'}
          </label>
          {preview && (
            <Button type="button" variant="secondary" onClick={onRemove} disabled={busy}>
              ลบโลโก้
            </Button>
          )}
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
