# Shared Patterns

Cross-cutting components used across all roles — common modals, toasts, empty/error/loading states, confirm dialogs.

**Section prefix:** `C` (e.g., M-C1, T-C1)

---

## Index

### Common modals (4)
- [M-C1: Confirm destructive action](#m-c1-confirm-destructive)
- [M-C2: Discard unsaved changes](#m-c2-discard-changes)
- [M-C3: Image preview](#m-c3-image-preview)
- [M-C4: Generic info / FYI](#m-c4-generic-info)

### Common toasts (8)
- [T-C1: Generic success](#t-c1-generic-success)
- [T-C2: Generic error](#t-c2-generic-error)
- [T-C3: Network offline](#t-c3-network-offline)
- [T-C4: Saved](#t-c4-saved)
- [T-C5: Copied to clipboard](#t-c5-copied)
- [T-C6: New notification](#t-c6-new-notification)
- [T-C7: File upload progress](#t-c7-upload-progress)
- [T-C8: Server time-out / retry](#t-c8-timeout-retry)

### State catalogs
- [Empty states](#empty-states)
- [Error states](#error-states)
- [Loading states](#loading-states)
- [Permission denied state](#permission-denied)
- [404 not found state](#404-not-found)

### Drawers
- [D-C1: Notification drawer](#d-c1-notification-drawer)
- [D-C2: Help / what's new](#d-c2-help-drawer)

### Cross-cutting components
- [Status badges color map](#status-badges-color-map)
- [Money formatter](#money-component)
- [Thai date formatter](#thai-date-component)
- [Skip link](#skip-link)

---

# Common modals

## M-C1: Confirm destructive

Generic destructive action confirmation. Used by:
- Archive employee
- Delete branch / department / setting
- Cancel leave/advance request
- Reject any request
- Sign out (M-A2 specifically)

### Pattern

```
┌─────────────────────────────────┐
│  ลบรายการนี้?                       │  ← title (action verb)
│                                 │
│  รายการนี้จะถูกลบถาวร —             │  ← body (consequence)
│  ไม่สามารถกู้คืนได้                  │
│                                 │
│             [ยกเลิก] [ลบ]        │  ← actions (cancel + danger)
└─────────────────────────────────┘
```

### Props

```ts
type Props = {
  open: boolean;
  title: string;        // action-oriented: "ลบ?", "Archive?", "Cancel?"
  description: string;  // consequence explanation
  confirmText?: string; // default "ยืนยัน"
  cancelText?: string;  // default "ยกเลิก"
  variant?: 'danger' | 'warning' | 'primary';  // default danger
  onConfirm: () => void;
  onCancel: () => void;
};
```

### Conventions

- Title = action verb form ("ลบ?", "ปิด?", "ออกจากระบบ?")
- Body = explains what happens + reversibility
- Confirm button = action verb ("ลบ" not "OK"), color matches variant
- Cancel always present, secondary style
- Default keyboard: Esc = cancel, Enter = confirm (focus on confirm by default for fast workflow)

---

## M-C2: Discard changes

When user navigates away from form with unsaved changes.

### Pattern

```
┌─────────────────────────────────┐
│  ทิ้งการแก้ไข?                       │
│                                 │
│  การแก้ไขจะไม่ถูกบันทึก —           │
│  คุณจะสูญเสียข้อมูลที่กรอกไว้           │
│                                 │
│      [กลับไปแก้ไข] [ทิ้ง]          │
└─────────────────────────────────┘
```

### Trigger sources
- Click "Cancel" button on dirty form
- Browser back button
- Click sidebar nav while form dirty
- `beforeunload` browser event (best-effort)

### Props

```ts
type Props = {
  open: boolean;
  onDiscard: () => void;  // proceed with leaving
  onKeepEditing: () => void;  // dismiss modal, stay
};
```

---

## M-C3: Image preview

Click thumbnail → open full-screen image overlay.

### Pattern

```
┌────────────────────────────────────────┐
│   [✕]                          [📥]    │  ← close + download
│                                        │
│         [          IMAGE          ]    │  ← centered, fit
│                                        │
│                                        │
│   receipt-2026-04-28.jpg · 2.3 MB     │  ← filename + size
└────────────────────────────────────────┘
```

### Features
- Click outside or Esc → close
- Pinch zoom on mobile, scroll-zoom desktop
- Download button = presigned URL → browser download
- For PDF: open in iframe instead of img

### Used in
- Cash advance receipt (S-N8, S-E8)
- Leave attachment preview (S-E5, S-N6 drawer)

---

## M-C4: Generic info / FYI

When system needs to communicate non-actionable info.

### Pattern

```
┌─────────────────────────────────┐
│  ℹ ข้อมูล                          │
│                                 │
│  ระบบกำลัง maintenance —          │
│  ฟีเจอร์บางส่วนจะใช้งานไม่ได้         │
│  ตั้งแต่ 22:00 ถึง 02:00             │
│                                 │
│              [เข้าใจแล้ว]            │
└─────────────────────────────────┘
```

Single dismiss button (no choice).

---

# Common toasts

## T-C1: Generic success
- **Type:** success (green)
- **Message:** "บันทึกเรียบร้อย" / contextual specific message
- **Duration:** 3s
- **Position:** bottom-right (desktop), top-center (mobile)

## T-C2: Generic error
- **Type:** error (red)
- **Message:** "เกิดข้อผิดพลาด — กรุณาลองใหม่" / specific
- **Duration:** 6s (errors longer)
- **Action:** optional [ลองใหม่] button

## T-C3: Network offline
- **Type:** warning (orange)
- **Message:** "ไม่ได้เชื่อมต่ออินเทอร์เน็ต — ระบบจะ sync เมื่อ online"
- **Duration:** sticky (until online)
- **Trigger:** `navigator.onLine` change to false

## T-C4: Saved
- **Type:** success
- **Message:** "บันทึกแล้ว"
- **Duration:** 2s (quick feedback)

## T-C5: Copied
- **Type:** info
- **Message:** "คัดลอกแล้ว"
- **Duration:** 1.5s
- **Trigger:** Click copy button (employee ID, link, etc.)

## T-C6: New notification (live push)
- **Type:** info
- **Message:** dynamic based on event
- **Duration:** 5s
- **Action:** [ดู] → navigate to source

## T-C7: File upload progress
- **Type:** info, progress style (with bar)
- **Message:** "อัปโหลด... 78%"
- **Duration:** sticky until done

## T-C8: Server timeout / retry
- **Type:** error
- **Message:** "เซิร์ฟเวอร์ไม่ตอบสนอง — กำลังลองใหม่... (2/3)"
- **Duration:** sticky, auto-dismisses on success
- **Action:** [ยกเลิก] manual abort

### Toast component code

```tsx
import { toast } from 'sonner';

// Common helpers
export function toastSuccess(msg: string) { toast.success(msg, { duration: 3000 }); }
export function toastError(msg: string, retry?: () => void) {
  toast.error(msg, {
    duration: 6000,
    action: retry ? { label: 'ลองใหม่', onClick: retry } : undefined,
  });
}
export function toastInfo(msg: string) { toast.info(msg, { duration: 4000 }); }
```

---

# Empty states

Generic component used across all list pages:

```tsx
<EmptyState
  icon={<Inbox />}
  title="ยังไม่มีข้อมูล"
  description="สร้างรายการแรกของคุณ"
  action={<Button>+ สร้าง</Button>}
/>
```

### Pattern

```
┌────────────────────────────┐
│                            │
│         📭                 │  ← icon (Lucide, 48px, muted)
│                            │
│   ยังไม่มีคำขอลา               │  ← title (bold, 16px)
│                            │
│   ส่งคำขอแรกของคุณ              │  ← description (muted, 14px)
│   ใช้เวลาแค่ 30 วินาที          │
│                            │
│      [+ ส่งคำขอลา]          │  ← optional CTA
│                            │
└────────────────────────────┘
```

### Catalog (per page)

| Page | Title | Description | CTA |
|---|---|---|---|
| /attendance | ยังไม่มีบันทึก | บันทึกการลงเวลาจะแสดงที่นี่ | (none) |
| /leave | ยังไม่มีคำขอลา | ส่งคำขอแรกของคุณ — 30 วินาที | + ส่งคำขอลา |
| /advance | ยังไม่มีคำขอเบิก | ส่งคำขอเบิกครั้งแรก | + ขอเบิก |
| /payslip | ยังไม่มีสลิป | Admin จะเผยแพร่สลิปประจำเดือน | (none) |
| /admin/employees | ยังไม่มีพนักงาน | เริ่มเพิ่มพนักงานหรือ bulk import | + เพิ่ม / Import |
| /admin/leave | ไม่มีคำขอรออนุมัติ | ทุกคำขอจัดการเรียบร้อย ✓ | (none) |
| /admin/advance | ไม่มีคำขอรออนุมัติ | ทุกคำขอจัดการเรียบร้อย ✓ | (none) |
| /admin/audit | ไม่มี log ในช่วงเวลานี้ | ลองเปลี่ยน filter | ล้าง filter |
| /owner/calendar (no events) | ไม่มีรายการเดือนนี้ | สถานะการมาทำงานปกติทุกคน 👍 | (none) |
| Notification drawer | ไม่มีการแจ้งเตือน | คุณจัดการเรียบร้อยแล้ว | (none) |
| Search no results | ไม่พบ "{query}" | ลองคำค้นอื่น | ล้าง search |

### Tone guide

- **Helpful empty:** suggest action ("ส่งคำขอแรก")
- **Achievement empty:** celebrate ("เรียบร้อย ✓")
- **Filter empty:** offer way out ("ลองเปลี่ยน filter")

---

# Error states

When data load fails (network, server error, permission).

### Pattern

```
┌────────────────────────────┐
│                            │
│         ⚠                   │  ← warning icon (red/orange)
│                            │
│   เกิดข้อผิดพลาด               │
│                            │
│   ไม่สามารถโหลดข้อมูลได้      │
│   ลองใหม่อีกครั้ง                │
│                            │
│       [ลองใหม่]               │
│                            │
└────────────────────────────┘
```

### Variants

| Type | Title | Description | CTA |
|---|---|---|---|
| Network | เชื่อมต่ออินเทอร์เน็ตไม่ได้ | ตรวจสอบสัญญาณแล้วลองใหม่ | ลองใหม่ |
| Server | เกิดข้อผิดพลาด | ระบบขัดข้องชั่วคราว — โปรดลองใหม่ | ลองใหม่ |
| Permission | คุณไม่มีสิทธิ์เข้าถึง | ติดต่อแอดมินหากเชื่อว่าผิดพลาด | กลับหน้าหลัก |
| Stale data | ข้อมูลล้าสมัย | กรุณา refresh เพื่อดูข้อมูลล่าสุด | Refresh |

---

# Loading states

3 patterns by context:

## Skeleton (preferred)

For known layout — replicate structure with animated shimmer:

```tsx
<Skeleton className="h-12 w-full rounded-lg mb-4" />
<Skeleton className="h-4 w-32 mb-2" />
<Skeleton className="h-4 w-48" />
```

Use:
- Page initial load
- Tab switch
- Pagination

## Spinner (button-level)

For action feedback (within button):

```tsx
<Button disabled>
  <Spinner size="sm" />
  กำลังบันทึก...
</Button>
```

Use:
- Form submit
- Approve/reject action
- Trigger payroll

## Progress bar

For long-running operations with measurable progress:

```tsx
<ProgressBar value={78} max={100} label="กำลังประมวลผล... 78%" />
```

Use:
- Excel upload parse
- Payroll calculation
- Email batch send
- File upload to Supabase Storage

---

# Permission denied

When server detects role mismatch on protected route.

### Strategy

V1 = treat as 404 (don't reveal existence). See [navigation.md §13](./navigation.md#13-404--not-authorized-handling).

V2 — consider explicit "permission denied" page if customer wants:

```
┌────────────────────────────┐
│         🔒                  │
│                            │
│   ไม่มีสิทธิ์เข้าถึงหน้านี้      │
│                            │
│   หน้านี้สงวนสำหรับ {role}    │
│   เท่านั้น                    │
│                            │
│       [กลับหน้าหลัก]          │
└────────────────────────────┘
```

---

# 404 not found

```
┌────────────────────────────┐
│         🔍                  │
│                            │
│   ไม่พบหน้าที่คุณค้นหา        │
│                            │
│   ลิงก์อาจจะเก่าหรือผิด       │
│                            │
│       [กลับหน้าหลัก]          │
│                            │
└────────────────────────────┘
```

Per-role group: each `(employee)/not-found.tsx`, `(admin)/not-found.tsx`, `(owner)/not-found.tsx` — back button goes to role-appropriate home.

---

# Drawers

## D-C1: Notification drawer

Used in topbar across all roles (Owner/Admin/Employee).

### Pattern

```
┌─────────────────────────────────┐
│ การแจ้งเตือน          [ปิด ✕]    │
├─────────────────────────────────┤
│ [ทั้งหมด] [ที่ยังไม่อ่าน (3)]      │
│                       Mark read │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ 🔵 คำขอลาใหม่จาก ส้ม         │ │  ← unread blue dot
│ │ 2 ชม.ที่แล้ว                │ │
│ ├─────────────────────────────┤ │
│ │  สลิปเงินเดือน เม.ย. พร้อมแล้ว │ │  ← read no dot
│ │ เมื่อวาน                    │ │
│ ├─────────────────────────────┤ │
│ │ 🔵 คำขอเบิกอนุมัติแล้ว        │ │
│ │ 3 ชม.ที่แล้ว                │ │
│ └─────────────────────────────┘ │
│                                 │
│ [ดูทั้งหมด →]                    │
└─────────────────────────────────┘
```

### Features

- Trigger: click bell in topbar
- Width: 360px desktop, full-screen mobile
- Tabs: ทั้งหมด / ที่ยังไม่อ่าน
- Click item → mark read + navigate to source page
- "Mark all read" link top right
- "ดูทั้งหมด" → /notifications full-page list (V2 — V1 = drawer-only)
- Realtime updates via Supabase Realtime subscription

See [navigation.md §9](./navigation.md#9-notification-bell--drawer) for full spec.

---

## D-C2: Help / what's new

Optional — V2 nice-to-have. Per-role help drawer with:
- Onboarding tips
- Recent updates
- FAQ
- Contact support

V1 skip — replace with simple `/help` static page if needed.

---

# Cross-cutting components

## Status badges color map

Single source of truth for `<StatusBadge>` colors. Used everywhere status displayed.

```ts
const STATUS_COLORS = {
  // Approval states
  pending:     { bg: '#fef3c7', fg: '#92400e', dark: { bg: '#78350f', fg: '#fde68a' } },
  approved:    { bg: '#d1fae5', fg: '#065f46', dark: { bg: '#064e3b', fg: '#a7f3d0' } },
  rejected:    { bg: '#fee2e2', fg: '#991b1b', dark: { bg: '#7f1d1d', fg: '#fecaca' } },
  cancelled:   { bg: '#e2e8f0', fg: '#475569', dark: { bg: '#334155', fg: '#cbd5e1' } },

  // Leave types
  sick:        { bg: '#dbeafe', fg: '#1e40af', dark: { bg: '#1e3a8a', fg: '#bfdbfe' } },
  personal:    { bg: '#ede9fe', fg: '#6b21a8', dark: { bg: '#581c87', fg: '#d8b4fe' } },
  vacation:    { bg: '#d1fae5', fg: '#065f46', dark: { bg: '#064e3b', fg: '#a7f3d0' } },
  maternity:   { bg: '#fce7f3', fg: '#9d174d', dark: { bg: '#831843', fg: '#fbcfe8' } },

  // Attendance
  late:        { bg: '#fed7aa', fg: '#9a3412', dark: { bg: '#7c2d12', fg: '#fdba74' } },
  absent:      { bg: '#fee2e2', fg: '#991b1b', dark: { bg: '#7f1d1d', fg: '#fecaca' } },
  noscan:      { bg: '#e2e8f0', fg: '#475569', dark: { bg: '#334155', fg: '#cbd5e1' } },

  // Payroll
  draft:       { bg: '#fef3c7', fg: '#92400e', dark: { bg: '#78350f', fg: '#fde68a' } },
  reviewed:    { bg: '#d1fae5', fg: '#065f46', dark: { bg: '#064e3b', fg: '#a7f3d0' } },
  published:   { bg: '#d1fae5', fg: '#065f46', dark: { bg: '#064e3b', fg: '#a7f3d0' } },
  override:    { bg: '#fed7aa', fg: '#9a3412', dark: { bg: '#7c2d12', fg: '#fdba74' } },
};
```

---

## Money component

```tsx
<Money amount={31417.50} />
// → "฿ 31,417.50"

<Money amount={31417.50} decimals={0} />
// → "฿ 31,418"

<Money amount={-833} />
// → "−฿ 833.00"  (minus prefix, danger color)
```

```ts
const formatMoney = (amount: number, decimals = 2) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
```

Always uses `tabular-nums` class for table alignment.

---

## Thai date component

```tsx
<ThaiDate date="2026-05-12" format="long" />
// → "12 พฤษภาคม 2569"

<ThaiDate date="2026-05-12" format="short" />
// → "12 พ.ค. 2569"

<ThaiDate date="2026-05-12T08:00:00" format="relative" />
// → "เมื่อ 2 ชั่วโมงที่แล้ว"

<ThaiDate date="2026-05-12T08:00:00" format="datetime" />
// → "12 พ.ค. 2569 08:00"
```

Uses `date-fns` with `th` locale + Buddhist Era +543 conversion.

---

## Skip link

For keyboard / screen reader accessibility:

```tsx
// Top of every page layout
<a href="#main-content" className="skip-link">
  ข้าม navigation
</a>
```

```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--color-primary-600);
  color: white;
  padding: 8px 16px;
  z-index: 100;
  border-radius: 0 0 var(--radius) 0;
}
.skip-link:focus { top: 0; }
```

Visible only when focused via Tab.

---

# Implementation reference

## Sonner toast setup

```tsx
// src/app/layout.tsx
import { Toaster } from 'sonner';

<Toaster
  position={isMobile ? 'top-center' : 'bottom-right'}
  closeButton
  richColors
  duration={4000}
  theme="system"
/>
```

## shadcn dialogs

```bash
pnpm dlx shadcn@latest add dialog alert-dialog drawer sheet
```

Use `<AlertDialog>` for destructive confirmations (M-C1) — has built-in title/description/action structure.

Use `<Dialog>` for general-purpose modals.

Use `<Sheet>` for drawers (D-C1, D-N1, etc.) — slide-in from edges.

---

## Error boundary pattern

```tsx
// src/app/(employee)/error.tsx
'use client';
import { ErrorState } from '@/components/shared/error-state';

export default function Error({ error, reset }) {
  return (
    <ErrorState
      title="เกิดข้อผิดพลาด"
      description="ระบบขัดข้องชั่วคราว"
      action={<Button onClick={reset}>ลองใหม่</Button>}
    />
  );
}
```

Per route group — same pattern, different "back home" link.

---

# Cross-references

- Tokens: [design-system.md §2-§9](../design-system.md#2-color-tokens)
- Component catalog: [design-system.md §10](../design-system.md#10-component-catalog)
- Navigation: [navigation.md](./navigation.md)
- Per-role specs: [auth.md](./auth.md), [employee.md](./employee.md), [admin.md](./admin.md), [owner.md](./owner.md)
