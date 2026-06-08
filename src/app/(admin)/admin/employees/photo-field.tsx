'use client';

/**
 * Employee photo field — preview + upload + remove.
 *
 * Lives inside the employee <form>. It compresses the picked image with the
 * shared selfie compressor, uploads it via the admin's browser Supabase
 * session, and writes the resulting storage key into a hidden `photoKey`
 * input that the server action persists.
 *
 * The hidden input is seeded with the EXISTING key on edit, so submitting
 * an unchanged form re-persists the same key (no accidental wipe). "ลบรูป"
 * sets it to '' → the action stores null and deletes the old object.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { compressToJpeg, uploadEmployeePhoto } from '@/lib/storage/upload-selfie';
import { createClient } from '@/lib/supabase/browser';

type Props = {
  /** Employee id on edit; null on the create form. */
  employeeId: string | null;
  /** Existing storage key (edit) so an unchanged save keeps the photo. */
  initialKey: string | null;
  /** Signed URL for the existing photo (edit) for the preview. */
  initialUrl: string | null;
};

function errMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'อัปโหลดรูปไม่สำเร็จ';
}

export function PhotoField({ employeeId, initialKey, initialUrl }: Props) {
  const [key, setKey] = useState<string>(initialKey ?? '');
  const [preview, setPreview] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw { kind: 'upload-failed', message: 'ไม่พบเซสชันผู้ดูแล กรุณาเข้าสู่ระบบใหม่' };
      const blob = await compressToJpeg(file);
      const { key: newKey } = await uploadEmployeePhoto(
        supabase,
        blob,
        authData.user.id,
        employeeId,
      );
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
      <input type="hidden" name="photoKey" value={key} />
      <div className="flex items-center gap-4">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-gray-100 text-ink-3">
          {preview ? (
            <img src={preview} alt="รูปพนักงาน" className="size-full object-cover" />
          ) : (
            <span className="text-xs">ไม่มีรูป</span>
          )}
        </div>
        <div className="space-y-2">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-gray-50">
            <input
              id="employee-photo-file"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void onPick(e)}
              disabled={busy}
            />
            {busy ? 'กำลังอัปโหลด...' : preview ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
          </label>
          {preview && (
            <Button type="button" variant="secondary" onClick={onRemove} disabled={busy}>
              ลบรูป
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
