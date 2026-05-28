'use client';

/**
 * Archive + Delete buttons for the team-member edit page's danger zone.
 *
 * Mirrors the pattern used by `/admin/employees/[id]/edit/danger-actions.tsx`:
 *   - Two destructive actions in one Client Component (no nested <form>s)
 *   - Each button has its own form pointing at a different Server Action
 *   - Each click triggers a `window.confirm` BEFORE the form submits;
 *     cancelling the confirm calls `preventDefault` so the action never runs
 *
 * Visual hierarchy nudges toward the safer choice:
 *   - "ระงับบัญชี" — solid destructive (Archive — soft, recoverable)
 *   - "ลบถาวร" — outlined destructive (Delete — irreversible, quieter
 *     visual weight so it doesn't read as the default action)
 *
 * Why a Client Component:
 *   - `window.confirm` only runs in the browser
 *   - Disabling delete-self in JSX requires the actor's identity, which
 *     the parent (Server Component) computes and passes down as `isSelf`
 */

import { Button } from '@/components/ui/button';

type Props = {
  /** Pre-bound Server Action for archive (soft delete). */
  archiveAction: () => Promise<void>;
  /** Pre-bound Server Action for hard delete. */
  deleteAction: () => Promise<void>;
  /** Target's email — surfaces in the confirm dialog so admins double-check the right row. */
  email: string | null;
  /** True if the target is the acting user — both buttons disabled in that case. */
  isSelf: boolean;
};

export function DangerActions({ archiveAction, deleteAction, email, isSelf }: Props) {
  function confirmArchive(e: React.MouseEvent<HTMLButtonElement>) {
    if (isSelf) {
      e.preventDefault();
      return;
    }
    const ok = window.confirm(
      `ระงับบัญชี "${email ?? 'unknown'}"?\n\nบัญชีนี้จะเข้าสู่ระบบไม่ได้อีก แต่ข้อมูล Audit ยังถูกเก็บไว้ตามเดิม คุณสามารถกู้คืนได้ในภายหลัง`,
    );
    if (!ok) e.preventDefault();
  }

  function confirmDelete(e: React.MouseEvent<HTMLButtonElement>) {
    if (isSelf) {
      e.preventDefault();
      return;
    }
    const ok = window.confirm(
      `ลบบัญชี "${email ?? 'unknown'}" ออกจากระบบถาวร?\n\nการลบจะ:\n  • ลบบัญชี Supabase auth ออก\n  • ลบ User row ใน database\n  • ไม่สามารถย้อนกลับได้\n\nหากต้องการแค่ปิดการเข้าใช้งาน ให้ใช้ "ระงับบัญชี" แทน`,
    );
    if (!ok) e.preventDefault();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form action={archiveAction}>
        <Button type="submit" variant="destructive" onClick={confirmArchive} disabled={isSelf}>
          ระงับบัญชี
        </Button>
      </form>
      <form action={deleteAction}>
        <Button
          type="submit"
          variant="destructive"
          onClick={confirmDelete}
          disabled={isSelf}
          // Visually quieter than archive — same destructive color, but
          // outlined-on-white so it doesn't read as the default action.
          // Nudges admins to pick Archive when they have a choice.
          className="!bg-white !text-red-700 hover:!bg-red-50 border border-red-300"
        >
          ลบถาวร
        </Button>
      </form>
    </div>
  );
}
