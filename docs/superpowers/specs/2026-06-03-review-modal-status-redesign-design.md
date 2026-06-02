# Design — Review modal + status clarity for leave / advance inboxes

**Date:** 2026-06-03
**Status:** Approved (pending spec review)
**Context:** Refinement inside the Sapphire production redesign (master plan
`2026-06-02-sapphire-production-redesign.md`, PR-4/PR-5 already shipped). The
admin asked for two fixes after QА'ing the ported `/admin/leave` and
`/admin/advance` inboxes.

## Problems

1. **Status is hard to distinguish.** The only status signal is a small
   `StatusBadge` pill inline with the employee name. In the history/all views
   every row is an identical white card, so scanning means *reading* each pill.
2. **The `ตรวจสอบ` inline accordion feels bad.** It shifts the whole list down,
   is cramped at row width, and — because its "settled" confirmation lives
   inside the row — forced the no-`revalidatePath` workaround, so the list never
   auto-updates (admin must manually refresh).

## Locked decisions (from mockup review)

- **Status look = A:** a status-colored **left rail** (`border-l-4`) + a status
  **icon** in the badge. No row tint.
- **Review interaction = modal + money confirm:** the row opens a focused modal
  (centered desktop / bottom-sheet mobile, via the existing `Dialog`).
  Leave approve/reject and advance reject commit directly from the modal; **advance
  approve** adds an in-modal "confirm ฿amount?" step (money safety).
- **Trigger = whole row** opens the modal; the **void/delete** action moves into
  the modal footer (rows get no inline buttons).

## Status rail + icon (single source of truth)

Add two maps co-located with `StatusBadge` (the existing spec-locked color map),
keyed by the same `StatusKey`:

| Status | Rail (`border-l-4`) | Badge icon |
|---|---|---|
| pending | `border-l-amber-400` | ⏳ |
| approved | `border-l-emerald-400` | ✓ |
| rejected | `border-l-red-400` | ✕ |
| cancelled | `border-l-slate-300` | ⊘ |

Rows render as `border-l-4 <rail>` and the badge shows `<icon> <label>`. Because
the maps live next to `StatusBadge`, the attendance disputed inbox (PR-6) and the
dashboard pending lists can adopt the same treatment for free.

## Component architecture

One shared shell, page-specific bodies — this is the "unify on shared
components" goal applied to the review surface.

### `ReviewModal` (new shared client component, `src/components/ui/`)

The shell. Owns: the `Dialog`, the footer action bar, pending/error state, the
optional required-note field, the optional in-modal money-confirm two-step, and
**success → `onClose()` + `router.refresh()`** (so the list re-queries and the
row updates/drops — this is what lets us delete the in-row "settled" hack).

Props (sketch):

```ts
type ReviewModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;                 // page-specific detail body
  note?: { required: boolean; placeholder?: string };
  /** When set, approve shows an in-modal "ยืนยัน ฿amount?" step first. */
  moneyConfirm?: { amountLabel: string };
  approveLabel: string;                // e.g. "อนุมัติ" or "อนุมัติ ฿4,321.00"
  onApprove: (note: string) => Promise<ActionResult>;
  onReject: (note: string) => Promise<ActionResult>;
  onVoid?: (reason: string) => Promise<ActionResult>; // footer "ลบรายการ" → reason prompt
};
```

Footer: `ลบรายการ` (left, danger text) · `ปฏิเสธ` (reject variant) · `อนุมัติ…`
(approve variant). The note field (when `note.required`) sits above the footer and
its value is passed to `onApprove`/`onReject`; empty note blocks submit.

**Two-step steps stay in-modal (no modal-on-modal).** Both the advance money
confirm and the void-reason prompt swap the footer/body in place rather than
stacking a second `Dialog`:
- Money confirm → footer becomes `[กลับ] [ยืนยันอนุมัติ ฿amount]`.
- Void → body swaps to a required-reason textarea + `[กลับ] [ยืนยันลบ]`.

This reuses the same in-place transform and avoids the focus-trap/z-index
complexity of nesting our `fixed inset-0` `Dialog` inside itself.

### Per page

- **Leave** (`/admin/leave`): a client wrapper renders the rows (rail + badge,
  whole-row button) and one `ReviewModal`. Body = detail grid (type, สังกัด, date
  range, working-day count) + the employee's reason. `note.required = true`.
  Handlers call `approveLeaveRequest` / `rejectLeaveRequest` / `voidLeaveRequest`.
- **Advance** (`/admin/advance`): same shape. Body = ฿amount (prominent) + meta +
  receipt `Dropzone`. `note` omitted. `moneyConfirm = { amountLabel: ฿X }` so
  approve runs the two-step. `onApprove` uploads the receipt (compress → Storage)
  *then* calls `approveCashAdvance` (unchanged contract). `onReject` →
  `rejectCashAdvance`; `onVoid` → `voidCashAdvance`.
- **Decided rows (both pages):** clicking opens the modal in a **read-only**
  variant — no approve/reject footer; shows the decision, reviewer note, and
  who/when (advance also shows the `ดูใบเสร็จ` link). Void stays available so a
  bad record can still be removed.

## What this replaces / changes

- **Deletes** the inline panels `leave-review-panel.tsx` and
  `advance-review-panel.tsx` (their logic moves into the modal bodies/handlers).
- **Folds in** the advance approve `ConfirmDialog` — the money confirm is now the
  modal's in-modal two-step, so there's no separate dialog.
- **Rows** become buttons (no inline `ตรวจสอบ` link, no inline `ลบ`); void lives in
  the modal footer (still a required-reason prompt, matching the confirm map).
- **Refresh:** restore success → `router.refresh()` (client, from `ReviewModal`).
  The server actions stay non-revalidating (refresh is a UI concern); the in-row
  "settled / please refresh" message is removed.
- **Void dialog** primitive (`VoidDialog`/`ConfirmDialog` with reason) is reused
  inside the modal footer — not rebuilt.

## Accessibility / mobile

- Each row is a `<button>` with an aria-label (e.g. "ตรวจสอบคำขอลาของ <name>").
- `Dialog` renders centered on desktop and as a bottom-sheet < md, with
  Esc-to-close, click-backdrop-to-close, scroll-lock, and focus moved into the
  panel on open — inherited for free.
- **Close button:** an explicit top-right `✕` (aria-label "ปิด") now lives on the
  shared `Dialog` primitive, so every modal (ConfirmDialog, FilterBar sheet,
  ReviewModal) gets a consistent close affordance. It's rendered last in the DOM
  (so focus-on-open still lands on the first meaningful control) and hidden while
  the dialog is non-dismissable (a mutation is pending).
- Touch targets: the whole row + ≥44px footer buttons.

## Testing

- **Unit/component:** rail + icon render per status; row click opens the modal.
- **e2e (rework `confirm-dialog.spec.ts` → `review-modal.spec.ts`):**
  - leave: row → modal → fill note → approve → row leaves Pending (refresh);
    reject path likewise.
  - advance: row → modal → approve → in-modal "ยืนยัน ฿amount" → commit; cancel
    of the money step aborts with no mutation; reject path.
  - void from the modal footer (reason required) — keep the existing void
    coverage intent.
- Keep `admin-leave-approval.spec.ts` / `admin-advance-approval.spec.ts` green by
  updating their interaction steps to the modal flow.

## Out of scope (now) / reuse later

- No row tint (decision A). No right-drawer.
- The rail + icon maps and `ReviewModal` are intended for later reuse by the
  attendance **disputed** inbox (PR-6) and the dashboard pending lists — adopt
  there when those PRs land, not in this change.
