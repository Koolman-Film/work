'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteAdjustment } from './actions';

/**
 * "ลบรายการ" in the edit page's danger zone, behind a ConfirmDialog.
 * On success navigates back to the registry list (the edit page itself
 * 404s once the row is soft-deleted, so refreshing in place is useless).
 */
export function DeleteAdjustmentButton({ id, summary }: { id: string; summary: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={(open) => (
        <Button type="button" variant="destructive" onClick={open}>
          ลบรายการ
        </Button>
      )}
      title="ลบรายการนี้?"
      description={`${summary} — งวดที่เผยแพร่สลิปแล้วจะไม่เปลี่ยน แต่งวดถัดไปจะไม่ถูกคิดอีก`}
      confirmLabel="ลบรายการ"
      tone="danger"
      refreshOnSuccess={false}
      action={async () => {
        const result = await deleteAdjustment(id);
        if (result.ok) router.push('/admin/payroll/adjustments');
        return result;
      }}
    />
  );
}
