'use client';

/**
 * Archive + Delete buttons for the Employee edit page.
 *
 * Why a Client Component:
 *   - Confirm dialogs use the browser's `window.confirm` — needs to run
 *     client-side
 *   - The buttons live INSIDE the EmployeeForm's <form>, using the HTML
 *     `formAction` attribute to override the form's main action — no
 *     nested forms (which React 19 rejects with "form was unexpectedly
 *     submitted")
 *
 * Why `formAction` instead of separate <form>s:
 *   - Single form, three submit destinations:
 *     - Default → updateEmployee (set on the <form action=...>)
 *     - Archive button → archiveEmployee via formAction
 *     - Delete button → deleteEmployee via formAction
 *   - This is the HTML spec's intended pattern for multi-destination forms
 *
 * Both buttons confirm BEFORE submitting since they're destructive:
 *   - Archive: "พ้นสภาพพนักงาน X? พนักงานจะไม่สามารถเช็คอินได้อีก"
 *   - Delete:  "ลบพนักงาน X ออกจากระบบถาวร? ถ้าพนักงานมีข้อมูล ระบบจะให้ใช้พ้นสภาพแทน"
 */

import { Button } from '@/components/ui/button';

type Props = {
  /** Already-bound Server Action — caller does .bind(null, id). */
  archiveAction: () => Promise<void>;
  /** Already-bound Server Action for hard delete. */
  deleteAction: () => Promise<void>;
  /** For the confirm dialog Thai message. */
  employeeName: string;
};

export function DangerActions({ archiveAction, deleteAction, employeeName }: Props) {
  function confirmArchive(e: React.MouseEvent<HTMLButtonElement>) {
    const ok = window.confirm(
      `พ้นสภาพ "${employeeName}"?\n\nพนักงานจะไม่สามารถเช็คอินหรือใช้ระบบได้อีก แต่ข้อมูลทั้งหมดยังถูกเก็บไว้`,
    );
    if (!ok) e.preventDefault();
  }

  function confirmDelete(e: React.MouseEvent<HTMLButtonElement>) {
    const ok = window.confirm(
      `ลบ "${employeeName}" ออกจากระบบถาวร?\n\nหากพนักงานมีข้อมูลเช็คอิน, ลา, เบิก, หรือเงินเดือนแล้ว ระบบจะไม่อนุญาตให้ลบ — ให้ใช้ "พ้นสภาพ" แทน`,
    );
    if (!ok) e.preventDefault();
  }

  return (
    <>
      <Button
        type="submit"
        variant="destructive"
        formAction={archiveAction}
        onClick={confirmArchive}
      >
        พ้นสภาพ
      </Button>
      <Button
        type="submit"
        variant="destructive"
        formAction={deleteAction}
        onClick={confirmDelete}
        // Visually quieter than archive — same color but with outline,
        // to nudge admins toward the safer Archive when they have a
        // choice.
        className="!bg-white !text-red-700 hover:!bg-red-50 border border-red-300"
      >
        ลบถาวร
      </Button>
    </>
  );
}
