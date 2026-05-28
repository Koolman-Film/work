'use client';

/**
 * "ปลดล็อก LINE" button — Client Component wrapper around the
 * `unlinkLineFromEmployee` Server Action so we can show a confirm
 * dialog before submitting.
 *
 * The dialog spells out the consequences (employee will need a new QR,
 * the Supabase auth.users row will be deleted) because this is
 * destructive enough to warrant an extra click of certainty.
 *
 * Visual weight: outlined-on-white red, matching the "ลบถาวร" style
 * we use for irreversible-but-not-immediately-catastrophic actions.
 * Avoids the solid red used for true "อันตราย" actions like archive
 * + delete — unlink is recoverable (admin can issue a fresh QR and
 * re-pair).
 */

import { Button } from '@/components/ui/button';

type Props = {
  /** Pre-bound Server Action: `unlinkLineFromEmployee.bind(null, id)` */
  action: () => Promise<void>;
  /** Employee display name — shown in the confirm dialog. */
  employeeName: string;
};

export function UnlinkLineButton({ action, employeeName }: Props) {
  function confirmUnlink(e: React.MouseEvent<HTMLButtonElement>) {
    const ok = window.confirm(
      `ปลดล็อก LINE จาก "${employeeName}"?\n\nผลที่จะเกิด:\n  • บัญชี LINE ที่เคยจับคู่จะถูกตัดออกจากระบบ\n  • Supabase auth user ของบัญชีนี้จะถูกลบ\n  • QR เดิม (ถ้ามี) จะใช้ไม่ได้\n  • ต้องสร้าง QR ใหม่ให้พนักงานสแกนเพื่อเชื่อมใหม่\n\nใช้เมื่อ: พนักงานได้โทรศัพท์/บัญชี LINE ใหม่, จับคู่กับ LINE ผิดบัญชี, หรือต้องการรีเซ็ตการเชื่อม`,
    );
    if (!ok) e.preventDefault();
  }

  return (
    <form action={action}>
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        onClick={confirmUnlink}
        className="!bg-white !text-red-700 hover:!bg-red-50 border border-red-300"
      >
        ปลดล็อก LINE
      </Button>
    </form>
  );
}
