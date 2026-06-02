'use client';

/**
 * "ปลดล็อก LINE" control — wraps `unlinkLineFromEmployee` in the shared styled
 * ConfirmDialog. Unlink is destructive but recoverable (admin can issue a fresh
 * QR and re-pair), so it uses the quieter outlined-red treatment, and the
 * dialog spells out the consequences before confirming. The action takes only
 * the bound id (no form data) and revalidates, so on success the dialog
 * refreshes the page to reflect the now-unlinked state.
 */

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type Props = {
  /** Pre-bound Server Action: `unlinkLineFromEmployee.bind(null, id)` */
  action: () => Promise<void>;
  /** Employee display name — shown in the confirm dialog. */
  employeeName: string;
};

export function UnlinkLineButton({ action, employeeName }: Props) {
  return (
    <ConfirmDialog
      title={`ปลดล็อก LINE จาก "${employeeName}"?`}
      description="บัญชี LINE ที่จับคู่จะถูกตัดออกจากระบบ และ Supabase auth user จะถูกลบ — QR เดิมจะใช้ไม่ได้ ต้องสร้าง QR ใหม่ให้พนักงานสแกนเพื่อเชื่อมใหม่"
      confirmLabel="ปลดล็อก LINE"
      tone="danger"
      action={async () => {
        await action();
        return { ok: true as const };
      }}
      trigger={(open) => (
        <Button
          type="button"
          variant="reject"
          size="sm"
          onClick={open}
          className="border-red-300 !text-red-700 hover:!bg-red-50"
        >
          ปลดล็อก LINE
        </Button>
      )}
    />
  );
}
