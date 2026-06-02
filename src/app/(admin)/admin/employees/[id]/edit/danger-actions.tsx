'use client';

/**
 * Archive + Delete controls for the Employee edit page — each gated by the
 * shared styled ConfirmDialog (replacing the old window.confirm).
 *
 * The bound server actions take only the employee id (no form data), so these
 * are plain `type="button"` triggers that call the action directly on confirm
 * — no `formAction`/nested-form trick needed. Each action `redirect()`s on
 * completion (to the list on success, or back with ?error= when a hard delete
 * is blocked), so the dialog doesn't need to refresh.
 */

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type Props = {
  /** Already-bound Server Action — caller does .bind(null, id). */
  archiveAction: () => Promise<void>;
  /** Already-bound Server Action for hard delete. */
  deleteAction: () => Promise<void>;
  /** For the confirm dialog Thai message. */
  employeeName: string;
};

export function DangerActions({ archiveAction, deleteAction, employeeName }: Props) {
  return (
    <>
      <ConfirmDialog
        title={`พ้นสภาพ "${employeeName}"?`}
        description="พนักงานจะไม่สามารถเช็คอินหรือใช้ระบบได้อีก แต่ข้อมูลทั้งหมดยังถูกเก็บไว้"
        confirmLabel="พ้นสภาพ"
        tone="danger"
        refreshOnSuccess={false}
        action={async () => {
          await archiveAction();
          return { ok: true as const };
        }}
        trigger={(open) => (
          <Button type="button" variant="destructive" onClick={open}>
            พ้นสภาพ
          </Button>
        )}
      />
      <ConfirmDialog
        title={`ลบ "${employeeName}" ออกจากระบบถาวร?`}
        description={
          'หากพนักงานมีข้อมูลเช็คอิน ลา เบิก หรือเงินเดือนแล้ว ระบบจะไม่อนุญาตให้ลบ — ให้ใช้ "พ้นสภาพ" แทน'
        }
        confirmLabel="ลบถาวร"
        tone="danger"
        refreshOnSuccess={false}
        action={async () => {
          await deleteAction();
          return { ok: true as const };
        }}
        trigger={(open) => (
          <Button
            type="button"
            variant="reject"
            onClick={open}
            className="border-red-300 !text-red-700 hover:!bg-red-50"
          >
            ลบถาวร
          </Button>
        )}
      />
    </>
  );
}
