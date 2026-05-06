# Koolman HR — Design System (V1)

Implementation-ready design system spec. Tokens, components, patterns, and code-ready Tailwind 4 config.

---

## ✅ Locked decisions

| Aspect | Choice | Why |
|---|---|---|
| **Color** | Theme 1: Finnix Blue Tech (Blue + Amber) | Modern automotive-tech, neutral professional, blue = trust |
| **Font** | IBM Plex Sans Thai | Geometric professional, balanced, Latin+Thai consistent, Stripe/Atlassian feel |
| **Style** | C. Soft Modern (radius 12-20px, brand-glow shadows, generous padding) | Premium friendly tool feel, mobile-friendly, Linear/Notion vibe |
| **Density override** | Admin tables can use `data-density="dense"` | Best of both worlds — soft for employees, dense for admin data |

---

## 1. Design principles

1. **Clarity over cleverness** — text labels not icon-only; explicit Thai
2. **Mobile-first for Employee** — touch targets ≥ 44×44px, single-column
3. **Density configurable for Admin** — switch via `data-density` attribute
4. **Read-only delight for Owner** — calendar + dashboards, no clutter
5. **Forgiving errors** — clear Thai messages, allow undo
6. **Skeleton + optimistic UI** — perceived performance > actual
7. **Trust signals** — show approval status, timestamps, "อัปเดตล่าสุด"
8. **Restrained motion** — subtle transitions, no parallax/distraction

---

## 2. Color tokens

### Primary scale (Finnix Blue)

| Token | Hex | Use |
|---|---|---|
| `primary-50` | `#eff6ff` | Subtle bg highlight, focus ring outer |
| `primary-100` | `#dbeafe` | Hover bg, info badge bg |
| `primary-200` | `#bfdbfe` | Selected state, divider accent |
| `primary-300` | `#93c5fd` | Tertiary action, link variant |
| `primary-400` | `#60a5fa` | (rare) |
| `primary-500` | `#3b82f6` | Primary mid (interactive on dark) |
| `primary-600` | `#2563eb` | **Main button bg, link, active** ⭐ |
| `primary-700` | `#1d4ed8` | Hover state for primary buttons |
| `primary-800` | `#1e40af` | Pressed state, dark headings |
| `primary-900` | `#1e3a8a` | Text on light bg if needed |

### Accent (Amber — sparingly)

| Token | Hex | Use |
|---|---|---|
| `accent-500` | `#f59e0b` | Highlights, badges, "tips", override warning bg |
| `accent-600` | `#d97706` | Hover state |

### Status colors (semantic)

| Token | Hex | Use |
|---|---|---|
| `success` | `#16a34a` | Approved, success toast |
| `warning` | `#ea580c` | Warning, late, pending |
| `danger` | `#dc2626` | Error, rejected, destructive |
| `info` | `#0891b2` | Informational |

### Neutrals (light + dark mode)

| Token | Light | Dark |
|---|---|---|
| `bg` | `#ffffff` | `#0f172a` |
| `bg-muted` | `#f8fafc` | `#1e293b` |
| `bg-elevated` | `#ffffff` | `#1e293b` |
| `fg` | `#0f172a` | `#f1f5f9` |
| `fg-muted` | `#64748b` | `#94a3b8` |
| `border` | `#e2e8f0` | `#334155` |
| `border-strong` | `#cbd5e1` | `#475569` |

### Status badges palette (each leave/attendance type)

| Type | Light bg | Light text | Dark bg | Dark text |
|---|---|---|---|---|
| `pending` (รออนุมัติ) | `#fef3c7` | `#92400e` | `#78350f` | `#fde68a` |
| `approved` (อนุมัติ) | `#d1fae5` | `#065f46` | `#064e3b` | `#a7f3d0` |
| `rejected` (ปฏิเสธ) | `#fee2e2` | `#991b1b` | `#7f1d1d` | `#fecaca` |
| `sick` (ลาป่วย) | `#dbeafe` | `#1e40af` | `#1e3a8a` | `#bfdbfe` |
| `personal` (ลากิจ) | `#e9d5ff` | `#6b21a8` | `#581c87` | `#d8b4fe` |
| `vacation` (พักร้อน) | `#d1fae5` | `#065f46` | `#064e3b` | `#a7f3d0` |
| `late` (สาย) | `#fed7aa` | `#9a3412` | `#7c2d12` | `#fdba74` |
| `absent` (ขาด) | `#fee2e2` | `#991b1b` | `#7f1d1d` | `#fecaca` |
| `noscan` (ไม่สแกน) | `#e2e8f0` | `#475569` | `#334155` | `#cbd5e1` |

---

## 3. Typography

### Font stack

```css
--font-sans: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif;
--font-mono: 'IBM Plex Mono', monospace;
```

Loaded via `next/font/google`:

```ts
// src/app/layout.tsx
import { IBM_Plex_Sans_Thai, IBM_Plex_Mono } from 'next/font/google';

const ibmPlexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${ibmPlexThai.variable} ${ibmPlexMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
```

### Type scale (Thai-tuned line-heights)

| Class | Size | Line-height | Weight | Use |
|---|---|---|---|---|
| `text-xs` | 12px | 1.5 | 400/500 | Meta, captions, labels |
| `text-sm` | 14px | 1.55 | 400/500 | Body small, table cells, helper text |
| `text-base` | 16px | 1.65 | 400 | Body default — Thai needs extra line-height |
| `text-lg` | 18px | 1.55 | 500/600 | Section heading |
| `text-xl` | 20px | 1.5 | 600 | Subsection |
| `text-2xl` | 24px | 1.4 | 600/700 | Page title |
| `text-3xl` | 30px | 1.35 | 700 | Hero heading |
| `text-4xl` | 36px | 1.3 | 700 | Big numerals (NetPay) |
| `text-5xl` | 48px | 1.2 | 700 | Marketing hero (rare) |

### Letter spacing

- Default body: `-0.005em` (slight tightening)
- Heading 24px+: `-0.02em`
- Heading 30px+: `-0.03em`
- Labels uppercase: `0.05em` to `0.08em`

### Numerals

```css
.tabular { font-variant-numeric: tabular-nums; }
```

Apply to:
- Pay slip amounts
- Table money columns (right-aligned)
- KPI dashboard numbers
- Time/date columns

### Thai-specific notes

- Thai descenders + diacritics need ~20% more line-height than Latin
- Avoid `text-decoration: underline` on Thai (clashes with diacritics) → use `border-bottom` instead
- Thai text in narrow columns: prefer `text-wrap: balance` for headings

---

## 4. Spacing scale (Soft Modern — generous)

Tailwind default scale + Soft Modern preference for **larger gaps**:

| Token | Px | Common use |
|---|---|---|
| `space-1` | 4px | Tight inline gaps |
| `space-2` | 8px | Default chip/badge gap |
| `space-3` | 12px | Form field spacing |
| `space-4` | 16px | Card content gap |
| `space-5` | 20px | Section breathing |
| `space-6` | 24px | **Default card padding** ⭐ |
| `space-8` | 32px | **Soft Modern card padding** ⭐ |
| `space-10` | 40px | Section margin |
| `space-12` | 48px | Large section gap |
| `space-16` | 64px | Page-level gap |

**Soft Modern defaults:**
- Card padding: `space-8` (32px)
- Page padding: `space-6` lateral + `space-10` vertical
- Form field gap: `space-4` (16px)
- Section gap: `space-12` (48px)

---

## 5. Border radius

Soft Modern = larger, more friendly:

| Token | Px | Use |
|---|---|---|
| `radius-sm` | 6px | Small controls (badges, mini buttons) |
| `radius` | 10px | **Default — inputs, buttons, small cards** ⭐ |
| `radius-lg` | 16px | Cards, modal frames |
| `radius-xl` | 20px | Hero card, large dialogs |
| `radius-full` | 999px | Avatars, pills, status dots |

**Application:**
- Buttons: `radius` (10px)
- Inputs: `radius` (10px)
- Cards: `radius-lg` (16px)
- Hero card: `radius-xl` (20px)
- Pay slip card: `radius-lg`
- Avatar: `radius-full`
- Status badges: `radius-full`

---

## 6. Shadow scale (brand-glow flavor)

Soft Modern uses **brand-color glow shadows** — not pure black:

| Token | Value | Use |
|---|---|---|
| `shadow-sm` | `0 2px 4px 0 rgb(0 0 0 / 0.04)` | Subtle border replacement |
| `shadow` | `0 4px 8px -2px rgb(0 0 0 / 0.05), 0 2px 4px -1px rgb(0 0 0 / 0.03)` | Default card |
| `shadow-md` | `0 8px 16px -4px rgb(37 99 235 / 0.12), 0 4px 8px -2px rgb(0 0 0 / 0.05)` | **Hero card, modal** ⭐ |
| `shadow-lg` | `0 16px 32px -8px rgb(37 99 235 / 0.15), 0 8px 16px -4px rgb(0 0 0 / 0.06)` | Floating elements (popovers) |
| `shadow-glow` | `0 0 0 4px rgb(37 99 235 / 0.15)` | Focus ring |
| `shadow-none` | `none` | Print, dense pro override |

**Dark mode adjustments:** reduce shadow opacity to 0.4-0.6 (dark bg absorbs more).

---

## 7. Motion tokens

| Token | Value | Use |
|---|---|---|
| `duration-fast` | 100ms | Hover ring, focus appear |
| `duration-base` | 150ms | **Default — bg color, opacity** ⭐ |
| `duration-slow` | 250ms | Modal/drawer, section transitions |
| `duration-page` | 350ms | (rare) hero animations |
| `ease-default` | `cubic-bezier(0.4, 0, 0.2, 1)` | Default — natural feeling |
| `ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Enter (fade-in, slide-in) |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exit (fade-out) |
| `ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` | Soft bounce (toast, badge updates) |

**Restraint rule:** any motion > 350ms = annoying. Keep subtle.

---

## 8. Breakpoints (Tailwind defaults)

| Token | Width | Target |
|---|---|---|
| `sm` | 640px | Tablet portrait |
| `md` | 768px | Tablet landscape |
| `lg` | 1024px | Small laptop |
| `xl` | 1280px | Desktop |
| `2xl` | 1536px | Large display |

**Strategy:**
- Employee: 320–480px optimized, max-width 480px on desktop
- Admin: 1024px+ optimized
- Owner: 1280px+ optimized

---

## 9. Iconography

**Library:** `lucide-react` (matches shadcn/ui)

**Rules:**
- Pair icons with text labels in user-facing flows (Thai)
- Icon-only OK for compact admin toolbar
- Default size: `16px` inline, `20px` button-icon, `24px` page header
- Stroke width: 1.5 (default Lucide) for body, 2 for emphasis

**Common mappings:**
- `Home` — Dashboard
- `Calendar` — ปฏิทินการลา
- `Banknote` — เบิกเงิน, สลิป
- `FileText` — สลิปเงินเดือน, รายงาน
- `User`, `Users` — โปรไฟล์, พนักงาน
- `Bell` — แจ้งเตือน
- `Check`, `CheckCircle2` — อนุมัติ, success
- `X`, `XCircle` — ปฏิเสธ, error
- `Pencil` — แก้ไข
- `Trash2` — ลบ
- `Upload`, `Download` — ไฟล์
- `Clock` — เวลา, pending
- `AlertTriangle` — warning
- `Info` — info

---

## 10. Component catalog

### 10.1 Button

**Variants:**

| Variant | Background | Text | Use |
|---|---|---|---|
| `primary` | `primary-600` | white | Default action, submit |
| `accent` | `accent-500` | white | "Tip" or special action (rarely) |
| `success` | `success` | white | Approve |
| `danger` | `danger` | white | Reject, delete |
| `secondary` | `bg-muted` + border | `fg` | Cancel, back |
| `ghost` | transparent | `primary-600` | Tertiary action, "view more" |
| `outline` | transparent + border `primary-600` | `primary-600` | Alt to primary, less attention |

**Sizes:**

| Size | Padding | Text | Height |
|---|---|---|---|
| `sm` | `8px 16px` | `text-sm` | 32px |
| `md` (default) | `12px 24px` | `text-base` | 44px |
| `lg` | `16px 32px` | `text-lg` | 52px |

**States:**
- Default
- Hover (slightly darker bg)
- Focus (ring `shadow-glow`)
- Active (translate Y 1px)
- Disabled (opacity 50%, cursor not-allowed)
- Loading (spinner + disabled)

**Code:**
```tsx
import { Button } from '@/components/ui/button';

<Button variant="primary" size="md">เข้าสู่ระบบ</Button>
<Button variant="secondary">ยกเลิก</Button>
<Button variant="success" size="sm"><Check /> อนุมัติ</Button>
```

### 10.2 Input

**Sizes:** sm (32px), md (44px default), lg (52px)
**States:** default, focus, error, disabled, readonly
**Affixes:** prefix icon (left), suffix icon (right)

**Code:**
```tsx
<Input type="email" placeholder="อีเมล" />
<Input type="number" prefix="฿" />
<Input className="border-danger" /> {/* error state */}
```

### 10.3 Card

**Variants:**
- `default` — bg, border, shadow-sm, padding 32px (Soft Modern)
- `elevated` — shadow-md (hero card)
- `outlined` — no shadow, just border (admin dense)
- `interactive` — hover: shadow-md + border-primary-300

```tsx
<Card>
  <CardHeader>
    <CardTitle>ยอดเงินคงเหลือ</CardTitle>
    <CardDescription>เม.ย. 2569</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="text-4xl font-bold tabular-nums">฿ 31,417.50</div>
  </CardContent>
</Card>
```

### 10.4 Badge / StatusBadge

Custom wrapper around shadcn Badge with semantic mapping:

```tsx
<StatusBadge type="pending" />     // รออนุมัติ
<StatusBadge type="approved" />    // อนุมัติแล้ว
<StatusBadge type="sick" />        // ลาป่วย
```

Props: `type` (enum from status palette), optional `text` override.

### 10.5 DataTable

Wrapper around `@tanstack/react-table` + shadcn Table:

```tsx
<DataTable
  columns={cols}
  data={employees}
  density="comfortable" // or "dense" — uses data-density override
  pagination
  filterable
  sortable
/>
```

Props:
- `density`: `comfortable` | `dense` (Soft Modern default = comfortable)
- `pagination`: built-in pager
- `filterable`: search + filter dropdowns
- `sortable`: column sort

### 10.6 Dialog / Modal

Default: `radius-lg` (16px), `shadow-md` (brand glow), backdrop blur 4px.
Max-width: 480px (sm), 640px (md), 800px (lg).

### 10.7 Drawer / Sheet

Slides from right (desktop) or bottom (mobile).
Default width: 480px desktop, full-width mobile.
Used for: detail view (leave/advance approval), employee profile inline edit.

### 10.8 Toast (sonner)

```tsx
import { toast } from 'sonner';

toast.success('ส่งคำขอเรียบร้อย');
toast.error('เกิดข้อผิดพลาด — ลองใหม่');
toast.info('สลิปประจำเดือนพร้อมแล้ว');
```

Position: bottom-right (desktop), top-center (mobile).
Duration: 4s default, 6s for errors.

### 10.9 Form components

**FormField wrapper** (RHF + Zod):

```tsx
<FormField
  control={form.control}
  name="email"
  render={({ field }) => (
    <FormItem>
      <FormLabel>อีเมล</FormLabel>
      <FormControl>
        <Input type="email" {...field} />
      </FormControl>
      <FormDescription>เราจะส่ง OTP ไปยังอีเมลนี้</FormDescription>
      <FormMessage /> {/* error in Thai */}
    </FormItem>
  )}
/>
```

**Date Picker:** shadcn calendar + popover. Thai locale (`th`).

**Date Range Picker:** for leave start/end.

**Combobox:** for employee select with search.

**File Uploader:** drag-drop + preview, used for receipt + Excel.

### 10.10 Skeleton

For loading states:
```tsx
<Skeleton className="h-12 w-full rounded-lg" />
<Skeleton className="h-4 w-24 mt-2" />
```

Soft Modern → use `radius-lg` for skeleton matching final card shape.

### 10.11 Empty State

```tsx
<EmptyState
  icon={<Inbox />}
  title="ยังไม่มีคำขอลา"
  description="ส่งคำขอแรกของคุณ — ใช้เวลาแค่ 30 วินาที"
  action={<Button>+ ส่งคำขอลา</Button>}
/>
```

### 10.12 Error State

```tsx
<ErrorState
  title="โหลดข้อมูลไม่สำเร็จ"
  description="ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่"
  action={<Button onClick={retry}>ลองใหม่</Button>}
/>
```

### 10.13 Notification Bell

Topbar fixed right:
```tsx
<NotificationBell unreadCount={3} />
```
- Click → drawer with last 20 notifications
- Mark all read button
- Each item links to source page

### 10.14 Money / ThaiDate components

```tsx
<Money amount={31417.5} />
// → ฿ 31,417.50

<ThaiDate date="2026-05-12" format="long" />
// → 12 พฤษภาคม 2569

<ThaiDate date="2026-05-12T08:00:00" format="relative" />
// → เมื่อ 2 ชั่วโมงที่แล้ว
```

---

## 11. Layout patterns

### 11.1 Auth pages (login, OTP, reset)

```
┌────────────────────────────────────┐
│                                    │
│                                    │
│          [Logo 56px]                │
│                                    │
│        เข้าสู่ระบบ                   │
│        ──────────                    │
│                                    │
│    [Email input]                    │
│    [Password input]                  │
│    [Submit button — full-width]      │
│                                    │
│    ลืมรหัสผ่าน?                       │
│                                    │
│                                    │
└────────────────────────────────────┘
        Powered by Koolman HR
```

- Centered card, max-width 400px
- Soft Modern: `radius-xl`, `shadow-md`, padding 32px
- Background: subtle gradient `linear-gradient(135deg, primary-50, white)`

### 11.2 Employee mobile-first

```
┌────────────────────────────────┐
│  Koolman HR    🔔 3   👤      │ ← topbar 56px
├────────────────────────────────┤
│                                │
│   Main content                 │
│   (single column)              │
│   max-w-480 desktop            │
│                                │
├────────────────────────────────┤
│  🏠  📅  💰  📄  👤            │ ← bottom nav 64px
└────────────────────────────────┘
```

Bottom nav (5 tabs):
- Home (🏠) — Dashboard
- Leave (📅) — Leave list
- Advance (💰) — Cash advance
- Slip (📄) — Pay slip
- Profile (👤)

### 11.3 Admin desktop sidebar

```
┌────────┬──────────────────────────┐
│  Logo  │  Topbar (breadcrumb + 🔔)│
│ ─────  ├──────────────────────────┤
│  Side  │                           │
│  nav   │  Page title + actions     │
│  240px │                           │
│        │  Filters bar              │
│ Dash   │                           │
│ Emp.   │  Data table or content    │
│ Leave  │                           │
│ Adv.   │  (max-w 1280)             │
│ Atte.  │                           │
│ Pay    │                           │
│ Acct.  │                           │
│ Audit  │                           │
│ Set    │                           │
└────────┴──────────────────────────┘
```

### 11.4 Owner desktop (lighter)

Same as Admin but:
- Sidebar reduced (only 4 items: Dashboard, Calendar, Payroll, Audit)
- More dashboard-centric (KPI cards, charts at top)
- All read-only

---

## 12. Page templates

### 12.1 List + filter + table

```
[Page title]                      [Action button]
─────────────
Breadcrumb / sub-nav

[Filter bar: search input, dropdowns, date range]

[DataTable]
  - Sticky header
  - Rows hover
  - Pagination footer
```

### 12.2 Detail with side drawer

Triggered from row click in list. Drawer slides from right.

### 12.3 Multi-step form (employee onboarding)

Steps shown as horizontal stepper at top:
```
[① Profile]──[② Bank]──[③ Documents]──[④ Confirm]
```

### 12.4 Settings page (admin)

```
[Settings]
  ├─ General
  ├─ Branches
  ├─ Departments
  ├─ Accounting Groups
  ├─ Leave Types
  ├─ Holidays
  └─ Payroll Config
```
Each tab/sub-page = simple list + edit drawer.

---

## 13. Voice & tone (Thai)

### Tone principles

- **Polite** but not overly formal (use "คุณ" not "ท่าน")
- **Concise** — short sentences, no unnecessary words
- **Active voice** — "ส่งคำขอ" not "การส่งคำขอ"
- **Helpful** — error messages explain WHAT to fix

### Common phrasings

| Action | Word |
|---|---|
| Submit | ส่ง / บันทึก / ยืนยัน |
| Cancel | ยกเลิก |
| Edit | แก้ไข |
| Delete | ลบ |
| Save | บันทึก |
| Confirm | ยืนยัน |
| Approve | อนุมัติ |
| Reject | ปฏิเสธ |
| Search | ค้นหา |
| Filter | กรอง |
| Loading | กำลังโหลด |
| Loading data | กำลังโหลดข้อมูล |

### Error messages

❌ Bad: "Error 422: Validation failed"
✅ Good: "อีเมลไม่ถูกต้อง — กรุณาตรวจสอบรูปแบบ"

❌ Bad: "Network error"
✅ Good: "เชื่อมต่ออินเทอร์เน็ตไม่ได้ — ตรวจสอบสัญญาณแล้วลองใหม่"

❌ Bad: "Permission denied"
✅ Good: "คุณไม่มีสิทธิ์เข้าถึงหน้านี้ — ติดต่อแอดมิน"

### Empty state messages

- ❌ "No data" → ✅ "ยังไม่มีข้อมูล"
- ❌ "No leave requests" → ✅ "ยังไม่มีคำขอลา"
- Add encouragement: "ส่งคำขอแรกของคุณ — ใช้เวลาแค่ 30 วินาที"

### Success messages

- "ส่งคำขอเรียบร้อย — รอแอดมินอนุมัติ"
- "บันทึกข้อมูลแล้ว"
- "อัปโหลดสำเร็จ"

### Confirmation dialogs

- Title: brief action — "ยืนยันลบพนักงาน?"
- Body: explain consequence — "พนักงานจะถูก archive ออกจากระบบ — สามารถ rehire ได้ภายหลัง"
- Buttons: action verb on primary — "ลบ" not "OK"

---

## 14. Accessibility (WCAG AA)

### Color contrast
- Body text: ≥ 4.5:1
- Large text (≥18px or 14px bold): ≥ 3:1
- UI components / focus indicators: ≥ 3:1

**Theme 1 verified ratios:**
- `primary-600` on white: 5.85:1 ✓
- `fg` on `bg`: 16.74:1 ✓
- `fg-muted` on `bg`: 4.66:1 ✓ (just passes)

### Keyboard
- All interactive elements focusable via Tab
- Skip link "ข้าม navigation" at top of every page
- Modal: trap focus inside, Esc closes
- Dropdown: arrow keys navigate

### Screen reader
- `aria-label` on icon-only buttons
- `aria-describedby` linking inputs to error messages
- `aria-live="polite"` for toasts and form errors
- `aria-current="page"` on active nav

### Form labels
- Always explicit `<Label htmlFor>` (not just placeholder)
- Error messages associated via `aria-describedby`

### Touch targets
- Minimum 44×44px on mobile (Soft Modern: easily meets this)

---

## 15. Dark mode strategy

- Auto detect via `prefers-color-scheme`
- User toggle in profile page (override stored in localStorage)
- All tokens have light/dark equivalents (see §2)
- Test every screen in both modes before ship
- Brand glow shadow opacity reduced 60% in dark mode

---

## 16. Print styles

Apply via `@media print`:
- Hide topbar, sidebar, action buttons
- Pay slip = single page A4 portrait
- Monthly report = A4 landscape
- Black on white only (no shadows, no colors except critical badges)
- Use `font-mono` for amount columns for alignment

```css
@media print {
  .no-print { display: none !important; }
  body { background: white; color: black; }
  .card { border: 1px solid black; box-shadow: none; }
}
```

---

## 17. Tailwind 4 `@theme` config (ready to paste)

`src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  /* ===== Colors ===== */
  --color-primary-50:  #eff6ff;
  --color-primary-100: #dbeafe;
  --color-primary-200: #bfdbfe;
  --color-primary-300: #93c5fd;
  --color-primary-400: #60a5fa;
  --color-primary-500: #3b82f6;
  --color-primary-600: #2563eb;
  --color-primary-700: #1d4ed8;
  --color-primary-800: #1e40af;
  --color-primary-900: #1e3a8a;

  --color-accent-500: #f59e0b;
  --color-accent-600: #d97706;

  --color-success: #16a34a;
  --color-warning: #ea580c;
  --color-danger:  #dc2626;
  --color-info:    #0891b2;

  /* Status badges */
  --color-status-pending-bg:  #fef3c7;
  --color-status-pending-fg:  #92400e;
  --color-status-approved-bg: #d1fae5;
  --color-status-approved-fg: #065f46;
  --color-status-rejected-bg: #fee2e2;
  --color-status-rejected-fg: #991b1b;
  --color-status-sick-bg:     #dbeafe;
  --color-status-sick-fg:     #1e40af;
  --color-status-personal-bg: #e9d5ff;
  --color-status-personal-fg: #6b21a8;
  --color-status-vacation-bg: #d1fae5;
  --color-status-vacation-fg: #065f46;
  --color-status-late-bg:     #fed7aa;
  --color-status-late-fg:     #9a3412;
  --color-status-absent-bg:   #fee2e2;
  --color-status-absent-fg:   #991b1b;
  --color-status-noscan-bg:   #e2e8f0;
  --color-status-noscan-fg:   #475569;

  /* ===== Typography ===== */
  --font-sans: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;

  /* ===== Border radius (Soft Modern) ===== */
  --radius-sm:   0.375rem;  /* 6px */
  --radius:      0.625rem;  /* 10px — default */
  --radius-lg:   1rem;       /* 16px — cards */
  --radius-xl:   1.25rem;    /* 20px — hero */
  --radius-2xl:  1.5rem;     /* 24px — rare */

  /* ===== Shadows (brand-glow) ===== */
  --shadow-sm: 0 2px 4px 0 rgb(0 0 0 / 0.04);
  --shadow:    0 4px 8px -2px rgb(0 0 0 / 0.05),
               0 2px 4px -1px rgb(0 0 0 / 0.03);
  --shadow-md: 0 8px 16px -4px rgb(37 99 235 / 0.12),
               0 4px 8px -2px rgb(0 0 0 / 0.05);
  --shadow-lg: 0 16px 32px -8px rgb(37 99 235 / 0.15),
               0 8px 16px -4px rgb(0 0 0 / 0.06);
  --shadow-glow: 0 0 0 4px rgb(37 99 235 / 0.15);

  /* ===== Motion ===== */
  --duration-fast: 100ms;
  --duration-base: 150ms;
  --duration-slow: 250ms;
}

/* Dark mode overrides */
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg:        #0f172a;
    --color-bg-muted:  #1e293b;
    --color-fg:        #f1f5f9;
    --color-fg-muted:  #94a3b8;
    --color-border:    #334155;

    --shadow-md: 0 8px 16px -4px rgb(37 99 235 / 0.06),
                 0 4px 8px -2px rgb(0 0 0 / 0.4);
  }
}

.dark {
  --color-bg:        #0f172a;
  --color-bg-muted:  #1e293b;
  --color-fg:        #f1f5f9;
  --color-fg-muted:  #94a3b8;
  --color-border:    #334155;
}

/* ===== Base ===== */
body {
  font-family: var(--font-sans);
  background: var(--color-bg, #ffffff);
  color: var(--color-fg, #0f172a);
  letter-spacing: -0.005em;
  line-height: 1.6;
}

/* Thai-specific */
:lang(th) {
  line-height: 1.65;
}

/* Tabular nums utility (already in Tailwind 4 but explicit) */
.tabular { font-variant-numeric: tabular-nums; }

/* Density override (Admin can use data-density="dense") */
[data-density="dense"] {
  --card-padding: 1rem;
  --row-padding: 0.5rem 0.75rem;
}

[data-density="dense"] .card { padding: var(--card-padding); }
[data-density="dense"] td,
[data-density="dense"] th { padding: var(--row-padding); }
[data-density="dense"] .text-base { font-size: 0.875rem; }

/* Print */
@media print {
  .no-print { display: none !important; }
  body { background: white; color: black; }
  .card { border: 1px solid black; box-shadow: none; }
}

/* Skip link for a11y */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--color-primary-600);
  color: white;
  padding: 8px 16px;
  z-index: 100;
}
.skip-link:focus { top: 0; }
```

---

## 18. shadcn/ui setup

### Install

```bash
pnpm dlx shadcn@latest init
# → Follow prompts:
#   Style: Default
#   Base color: Slate (we override in @theme)
#   CSS variables: Yes
#   Tailwind config: tailwind.config.ts
#   Components folder: src/components/ui
#   Utility: src/lib/utils.ts
```

### Add base components (W1)

```bash
pnpm dlx shadcn@latest add button input label form select textarea
pnpm dlx shadcn@latest add card dialog drawer sheet popover tooltip
pnpm dlx shadcn@latest add table dropdown-menu menubar
pnpm dlx shadcn@latest add sonner alert-dialog alert
pnpm dlx shadcn@latest add tabs accordion separator badge avatar
pnpm dlx shadcn@latest add calendar checkbox radio-group switch
pnpm dlx shadcn@latest add command skeleton progress
pnpm dlx shadcn@latest add breadcrumb pagination scroll-area
```

### Customize per design system

After install, override styles in `src/components/ui/<component>.tsx` or via theme variables:

```tsx
// src/components/ui/button.tsx — example tweak for Soft Modern radius
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-[10px] text-sm font-medium ...",
  {
    variants: {
      variant: {
        default: "bg-primary-600 text-white hover:bg-primary-700 shadow-sm",
        ...
      },
      size: {
        default: "h-11 px-6", // 44px height for touch
        sm: "h-8 px-4 text-xs",
        lg: "h-13 px-8 text-base",
      },
    },
  },
);
```

---

## 19. Style guide page (`/styleguide`)

Build at W1 — Admin-only route showing every component + state.

```
src/app/(admin)/styleguide/page.tsx
```

Sections:
1. Color palette (live swatches with hex)
2. Typography (all type scale samples)
3. Spacing demonstrators
4. Border radius examples
5. Shadow showcase
6. Buttons (all variants × sizes × states)
7. Inputs (all types, states)
8. Cards (variants)
9. Dialogs/Drawers (trigger to open)
10. Tables (with density toggle)
11. Status badges (all)
12. Empty / error / loading states
13. Form patterns (sample form)
14. Toast triggers

→ Use this for visual QA every PR. Customer + dev can both reference.

---

## 20. Tailwind class cheat sheet

| Want | Class |
|---|---|
| Primary button bg | `bg-primary-600 hover:bg-primary-700` |
| Default card | `rounded-lg shadow-md p-8` |
| Hero card | `rounded-xl shadow-md bg-gradient-to-br from-primary-600 to-primary-800 text-white p-8` |
| Soft Modern hero card hover | `transition hover:shadow-lg` |
| Dense table row | parent has `data-density="dense"` |
| Status badge | `inline-block px-3 py-0.5 rounded-full text-xs font-medium` + status colors |
| Tabular number | `tabular-nums` |
| Form label | `text-sm font-medium text-fg mb-1.5` |
| Page title | `text-3xl font-bold tracking-tight` |
| Section heading | `text-xl font-semibold` |
| Skeleton | `bg-muted animate-pulse rounded-lg` |

---

## 21. Decision log

| Decision | Date | Rationale |
|---|---|---|
| Theme 1 (Blue Tech) over Theme 5 (Red) | 2026-05 | Red too overwhelming for daily HR use; blue more neutral + tech alignment |
| IBM Plex Sans Thai | 2026-05 | Geometric professional, balanced ทุกมิติ, Stripe/Atlassian feel |
| Soft Modern style | 2026-05 | Premium friendly mobile-first, Linear/Notion aesthetic |
| `data-density="dense"` escape hatch for admin | 2026-05 | Best of both — soft for employees, dense for admin tables |
| Skip Storybook | 2026-05 | Solo dev, /styleguide page covers same value at 20% effort |

---

## 22. Open questions / future iterations

- [ ] Logo design — currently using "FF" placeholder in red square; need actual Finnix logo asset from customer
- [ ] Brand stripe accent — currently Theme 1 doesn't use it; if Finnix brand book mentions red stripe, consider adding red 2px stripe at top of pages
- [ ] Dark mode toggle UI — settings page slot reserved
- [ ] Localization V2 — token names abstract enough to support TH+EN swap
- [ ] Custom Lucide icons — if customer has icon set preference

---

## Cross-references

- **[screens/](./screens/)** — wireframes per screen, flows, navigation (uses tokens from this doc)
- **[architecture.md](./architecture.md)** — folder structure, component organization
- **[feature-spec.md](./feature-spec.md)** — per-feature acceptance criteria
- **[build-plan.md](./build-plan.md)** — when to implement each component (W1 styleguide → W2 forms → W3 tables)
- **[design-previews/](./design-previews/)** — visual reference HTML files (style-tweaks-blue-tech.html § "C. Soft Modern" = closest to this spec)
