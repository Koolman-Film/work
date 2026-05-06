# Navigation Patterns

Site map per role + URL structure + breadcrumbs + back button + nav components.

---

## Index

- [1. Site map](#1-site-map)
- [2. Nav patterns per role](#2-nav-patterns-per-role)
- [3. URL structure](#3-url-structure)
- [4. Routing strategy](#4-routing-strategy)
- [5. Breadcrumbs](#5-breadcrumbs)
- [6. Back button behavior](#6-back-button-behavior)
- [7. Tab navigation](#7-tab-navigation)
- [8. Active state indication](#8-active-state-indication)
- [9. Notification bell + drawer](#9-notification-bell--drawer)
- [10. Mobile menu (drawer)](#10-mobile-menu-drawer)
- [11. Search / command palette](#11-search--command-palette-deferred)
- [12. Deep linking](#12-deep-linking)
- [13. 404 / not authorized handling](#13-404--not-authorized-handling)

---

## 1. Site map

### Public (no auth)

```
/
├── /login                S-A1
├── /verify-otp           S-A2
├── /welcome              S-A3 (invite token in URL)
└── /reset-password       S-A4 (step 1 + step 2 by token presence)
```

### Employee (role=User)

```
/dashboard                S-E1   ⭐ home
/attendance               S-E2   เวลาของฉัน
/leave                    S-E3   list + calendar tab
  ├── /leave/new          S-E4
  └── /leave/[id]         S-E5   detail
/advance                  S-E6   list
  ├── /advance/new        S-E7
  └── /advance/[id]       S-E8   detail + receipt
/payslip                  S-E9   list
  └── /payslip/[month]    S-E10  detail
/profile                  S-E11
```

### Admin (role=Admin)

```
/admin/dashboard          S-N1   ⭐ home
/admin/employees          S-N2   list
  ├── /admin/employees/new      S-N3
  ├── /admin/employees/[id]     S-N4   detail + edit
  └── /admin/employees/import   S-N5
/admin/leave              S-N6   approval inbox
/admin/advance            S-N7   approval inbox
  └── /admin/advance/[id] S-N8   detail + receipt upload
/admin/attendance         S-N9   records list + filter
  ├── /admin/attendance/manual          S-N10
  ├── /admin/attendance/upload          S-N11
  └── /admin/attendance/[id]/override   (modal — no separate page)
/admin/payroll            S-N12  months list
  ├── /admin/payroll/[month]                  S-N13  monthly run + review
  └── /admin/payroll/[month]/[empId]          S-N14  per-emp drilldown
/admin/accounting         S-N15  PEAK export
/admin/audit              S-N16  log viewer
/admin/settings           S-N17  general
  ├── /admin/settings/branches          S-N18
  ├── /admin/settings/departments       S-N19
  ├── /admin/settings/groups            S-N20  AccountingGroups
  ├── /admin/settings/leave-types       S-N21
  ├── /admin/settings/holidays          S-N22
  └── /admin/settings/payroll-config    S-N23
/admin/styleguide         (W1 dev tool — Admin only)
```

### Owner (role=Owner)

```
/owner/dashboard          S-O1   ⭐ home
/owner/calendar           S-O2   full attendance calendar
/owner/payroll            S-O3   read-only slip browser
/owner/audit              S-O4   audit log
```

### Shared

```
/profile                  → reusable for all roles, layout adapts
/api/inngest              Inngest endpoint (server)
/api/webhooks/line        V1.5 — LINE webhook
/api/cron/monthly-payroll Vercel cron trigger
```

---

## 2. Nav patterns per role

### Employee — bottom navigation (mobile-first)

**Component:** `<EmployeeBottomNav>`
**Layout:** fixed bottom, full-width, 5 tabs
**Height:** 64px (each tap target 44px+)

```
┌─────────────────────────────────────────┐
│                                         │
│         (page content)                  │
│                                         │
├─────────────────────────────────────────┤
│  🏠      📅      💰      📄      👤      │
│ หน้าแรก  ลา     เบิกเงิน  สลิป   โปรไฟล์   │
└─────────────────────────────────────────┘
```

**Tabs:**
| Icon | Label | Path | Badge |
|---|---|---|---|
| `Home` | หน้าแรก | /dashboard | — |
| `Calendar` | ลา | /leave | unread leave updates |
| `Banknote` | เบิกเงิน | /advance | unread advance updates |
| `FileText` | สลิป | /payslip | new slip published |
| `User` | โปรไฟล์ | /profile | — |

**Active state:** icon + label in `primary-600`, others muted

**Desktop fallback (≥ 768px):** still bottom-nav (employee always uses mobile-first; desktop just centered with max-width 480px)

### Admin — sidebar (desktop-first)

**Component:** `<AdminSidebar>`
**Layout:** fixed left, 240px wide on desktop, collapsible to 64px on tablet, drawer on mobile
**Height:** full viewport

```
┌──────────┬─────────────────────────────────┐
│  [Logo]  │  Topbar (breadcrumb + 🔔 + user)│
│ ──────   ├─────────────────────────────────┤
│ 🏠 หน้าหลัก │                                  │
│ 👥 พนักงาน │                                  │
│ 📋 อนุมัติลา│  Page content                    │
│ 💰 อนุมัติเบิก│                                  │
│ 📅 ลงเวลา │                                  │
│ 💸 เงินเดือน│                                  │
│ 📊 บัญชี   │                                  │
│ 📜 Audit │                                  │
│ ⚙️ ตั้งค่า   │                                  │
│           │                                  │
│ ──────   │                                  │
│ 👤 Profile│                                  │
│ ⏏ ออก     │                                  │
└──────────┴─────────────────────────────────┘
```

**Sidebar items:**
| Icon | Label | Path | Badge |
|---|---|---|---|
| `Home` | หน้าหลัก | /admin/dashboard | — |
| `Users` | พนักงาน | /admin/employees | — |
| `Calendar` | คำขอลา | /admin/leave | pending count |
| `Banknote` | คำขอเบิก | /admin/advance | pending count |
| `Clock` | ลงเวลา | /admin/attendance | — |
| `FileText` | เงินเดือน | /admin/payroll | unpublished month indicator |
| `Calculator` | บัญชี (PEAK) | /admin/accounting | — |
| `History` | Audit log | /admin/audit | — |
| `Settings` | ตั้งค่า | /admin/settings | — |

**Bottom section (above sign out):**
- Active user avatar + name (read-only display)
- Sign out (M-A2 modal)

**Tablet (≤ 1024px):** sidebar collapses to icon-only (64px); hover shows label tooltip

**Mobile (≤ 768px):** sidebar becomes drawer triggered by hamburger; backdrop blur

### Owner — sidebar (lighter)

Same structure as Admin sidebar but only 4 main items + read-only items:

| Icon | Label | Path |
|---|---|---|
| `Home` | หน้าหลัก | /owner/dashboard |
| `Calendar` | ปฏิทิน | /owner/calendar |
| `FileText` | เงินเดือน | /owner/payroll (read-only) |
| `History` | Audit | /owner/audit |

### Topbar (all roles)

**Component:** `<Topbar>`
**Layout:** fixed top, full-width, 56px tall

```
┌───────────────────────────────────────────────────┐
│ [Logo small]  Breadcrumb              🔔 (3)  👤  │
└───────────────────────────────────────────────────┘
```

**Elements:**
- Logo (32px) — clickable home link
- Breadcrumb (Admin/Owner only — Employee uses bottom-nav as nav)
- Notification bell with unread count badge
- User avatar dropdown (profile, sign out)

**Mobile (≤ 768px):**
- Logo on left + hamburger (admin/owner) or just logo (employee)
- Bell + avatar on right

---

## 3. URL structure

### Conventions

- **Plural for collections:** `/employees`, `/leave`, `/advance`
- **`new` for create form:** `/employees/new`
- **`[id]` for detail:** `/employees/EMP-001`
- **Nested for sub-resources:** `/payroll/2026-04/EMP-001`
- **Modals don't change URL** in V1 (V2 may add `?modal=...` for share-able links)

### Slug formats

| Type | Format | Example |
|---|---|---|
| Employee ID | `EMP-NNN` | `EMP-001` |
| Branch ID | numeric or slug | `bangkok-main` |
| Month | `YYYY-MM` | `2026-04` |
| LeaveRequest ID | numeric | `42` |
| CashAdvance ID | numeric | `123` |
| Attendance ID | numeric | `5678` |
| Audit log ID | numeric | `9999` |

### Query parameters

| Param | Use | Example |
|---|---|---|
| `redirectTo` | post-auth redirect | `/login?redirectTo=/dashboard` |
| `month` | month filter | `/admin/audit?month=2026-04` |
| `q` | search query | `/admin/employees?q=ตงค์` |
| `branch` | branch filter | `/owner/calendar?branch=main` |
| `tab` | active tab | `/leave?tab=calendar` |
| `token` | auth tokens | `/welcome?token=...` |
| `step` | wizard step | `/employees/new?step=2` |

---

## 4. Routing strategy

### Next.js App Router groups

```
src/app/
├── (auth)/         # public — auth screens
├── (employee)/     # role: User
├── (admin)/        # role: Admin (or higher in V2)
└── (owner)/        # role: Owner (or higher)
```

**Route groups in parens** = folder doesn't appear in URL, but layout per group is unique.

Each group has its own `layout.tsx`:
- `(auth)/layout.tsx` — centered card, gradient bg, no nav
- `(employee)/layout.tsx` — topbar + bottom-nav
- `(admin)/layout.tsx` — sidebar + topbar
- `(owner)/layout.tsx` — sidebar (lighter) + topbar

### Middleware role-routing

`src/middleware.ts`:

```ts
export async function middleware(request: NextRequest) {
  const { user, role } = await getUserFromSession(request);

  const path = request.nextUrl.pathname;

  // Public paths skip auth
  if (path.startsWith('/api/inngest') || path.startsWith('/login') || ...) return;

  // Not auth'd → redirect /login with redirectTo
  if (!user) {
    return NextResponse.redirect(new URL('/login?redirectTo=' + path, request.url));
  }

  // Already authd visiting /login → redirect to dashboard
  if (path === '/login' && user) {
    return NextResponse.redirect(roleHome(role));
  }

  // Role-based access control
  if (path.startsWith('/admin/') && role !== 'Admin' && role !== 'Owner') return notFound();
  if (path.startsWith('/owner/') && role !== 'Owner') return notFound();
  // Employee paths accessible to all auth'd users (employees only see their own data via RLS)
}

function roleHome(role) {
  return role === 'Admin' ? '/admin/dashboard' : role === 'Owner' ? '/owner/dashboard' : '/dashboard';
}
```

### Common patterns

- **After login** → redirect by role to dashboard (or `redirectTo` param)
- **Logout** → /login + clear session
- **Session expiry** → modal M-A1 → /login?redirectTo={current}
- **404** → custom not-found.tsx with "กลับหน้าหลัก" button (role-aware)
- **Permission denied** → 404 (don't reveal page existence)

---

## 5. Breadcrumbs

### Component

`<Breadcrumb>` rendered in topbar for Admin/Owner pages (not Employee — bottom nav substitutes)

### Pattern

```
หน้าหลัก  /  พนักงาน  /  ตงค์ สมศรี  /  แก้ไข
```

**Separator:** `/` with subtle gray color
**Active page:** last item, no link, slightly bolder
**Collapse on mobile:** show only last 2 items + "..."

### Path → label mapping

```
/admin/dashboard           → หน้าหลัก
/admin/employees           → พนักงาน
/admin/employees/[id]      → {EmployeeName}
/admin/employees/[id]/edit → แก้ไข
/admin/payroll             → เงินเดือน
/admin/payroll/[month]     → {MonthYearTH}
/admin/settings            → ตั้งค่า
/admin/settings/branches   → สาขา
```

Mapping in `src/lib/breadcrumb.ts`:

```ts
const breadcrumbMap = {
  'admin': 'แอดมิน',
  'admin/dashboard': 'หน้าหลัก',
  'admin/employees': 'พนักงาน',
  // ...
};
```

For dynamic segments (`[id]`, `[month]`) — fetch entity name via Server Component.

---

## 6. Back button behavior

### Browser back

- Always works (Next.js router native)
- After form submit + redirect → back skips form (using `router.replace` not `push`)
- After modal close → URL unchanged (modal state in component, not URL — V2 may change)

### App-level back link

Components with `← กลับ` link:
- Auth screens (S-A2 → /login)
- Detail pages (S-E5 leave detail → /leave list)

**Pattern:**
```tsx
<Link href={parentPath}>← กลับ</Link>
```

NOT `router.back()` (could go to wrong page if user landed via deep link).

### Confirm leaving form with unsaved changes

**Pattern:** beforeunload + custom dialog

```ts
useEffect(() => {
  const handler = (e) => { if (isDirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [isDirty]);
```

Plus on link click — show ConfirmDialog "ออกจากหน้านี้? — การแก้ไขจะไม่ถูกบันทึก"

---

## 7. Tab navigation

### Pattern

For pages with sub-views (e.g., /leave shows list + calendar tabs):

```tsx
<Tabs defaultValue="list" value={tab} onValueChange={setTab}>
  <TabsList>
    <TabsTrigger value="list">รายการ</TabsTrigger>
    <TabsTrigger value="calendar">ปฏิทิน</TabsTrigger>
  </TabsList>
  <TabsContent value="list">...</TabsContent>
  <TabsContent value="calendar">...</TabsContent>
</Tabs>
```

**Reflect in URL** via `?tab=calendar`:

```ts
const tab = searchParams.get('tab') ?? 'list';
const setTab = (v) => router.push(`?tab=${v}`, { scroll: false });
```

### Where used (V1)

- `/leave` — list / calendar
- `/admin/payroll/[month]` — table / summary stats
- `/admin/settings` — sub-tabs by setting category
- `/profile` — info / notifications / security

---

## 8. Active state indication

### Bottom-nav (Employee)

Active tab:
- Icon: `primary-600` (bold)
- Label: `primary-600` weight 600
- Above optional 2px primary line

```css
.nav-item[data-active="true"] {
  color: var(--color-primary-600);
}
.nav-item[data-active="true"] .icon {
  stroke-width: 2.5;
}
```

### Sidebar (Admin/Owner)

Active item:
- Background: `primary-50`
- Text + icon: `primary-700`
- Left border accent: 2px primary-600

```css
.sidebar-item[data-active="true"] {
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  border-left: 2px solid var(--color-primary-600);
}
```

### Determining active

Use `usePathname()`:

```ts
const path = usePathname();
const isActive = path.startsWith('/admin/employees');
```

For nested paths (e.g., `/admin/employees/EMP-001`) → match prefix to highlight parent.

---

## 9. Notification bell + drawer

### Trigger

Topbar bell icon. Component: `<NotificationBell>`

### States

- **Default:** `Bell` icon, no badge
- **Unread:** badge with count `1`–`99` (`99+` if more)
- **Hover:** slight background (bg-muted)

### Click behavior

Opens `<NotificationDrawer>` from right side (sheet) on desktop, full-screen on mobile.

### Drawer content

```
┌─────────────────────────────────┐
│ การแจ้งเตือน          [ปิด ✕]    │
├─────────────────────────────────┤
│ [ทั้งหมด] [ที่ยังไม่อ่าน]            │  ← tab
│                                 │
│  Mark all read                   │  ← link top right
│                                 │
│  ┌────────────────────────────┐ │
│  │ 🔵 คำขอลาใหม่จาก ส้ม          │ │  ← unread (blue dot)
│  │ 2 ชม.ที่แล้ว                 │ │
│  ├────────────────────────────┤ │
│  │  คำขอเบิกอนุมัติแล้ว ฿5,000    │ │  ← read (no dot)
│  │ เมื่อวาน                     │ │
│  └────────────────────────────┘ │
│                                 │
│  [ดูทั้งหมด →]                    │
└─────────────────────────────────┘
```

### Item click

- Mark as read
- Navigate to source page (e.g., `/admin/leave?id={leaveId}`)
- Close drawer

### Realtime updates

Subscribe via Supabase Realtime to `Notification` table for current user_id:

```ts
supabase.channel('notif-' + userId)
  .on('postgres_changes', { event: 'INSERT', table: 'notifications', filter: `user_id=eq.${userId}` },
    (payload) => addNotification(payload.new))
  .subscribe();
```

Bell badge updates instantly. Optional sound chime (V2).

---

## 10. Mobile menu (drawer)

### Admin / Owner mobile (≤ 768px)

Sidebar collapses to drawer triggered by hamburger in topbar:

```
┌──────────────────────────┐
│ ☰  [Logo]    🔔  👤      │  ← topbar
└──────────────────────────┘

Click ☰:
┌──────────────────────────┐
│ ✕                         │
│                           │
│  🏠 หน้าหลัก                │
│  👥 พนักงาน                 │
│  📋 อนุมัติลา               │
│  ...                      │
│                           │
│  ─────                    │
│  ⏏ ออกจากระบบ              │
└──────────────────────────┘
```

Backdrop blur, slide-in from left, swipe-to-close on mobile.

### Employee mobile

Bottom-nav already there. No separate drawer needed (profile dropdown handles secondary actions).

---

## 11. Search / command palette (deferred)

**V1:** No global search.

**V1.5/V2:** consider adding `Cmd+K` command palette for Admin (search employees, jump to settings, recent actions).

For V1, search is per-page (e.g., admin employees has search input above table).

---

## 12. Deep linking

### Supported

- `/login?redirectTo=/admin/payroll/2026-04` — auth + redirect
- `/admin/audit?month=2026-04&actor=EMP-001` — pre-filtered audit
- `/admin/employees?q=ตงค์` — search prefilled
- `/payslip/2026-04` — direct slip view
- `/welcome?token=...` — invite link
- `/reset-password?token=...` — reset link

### Permission check

If user lacks role for deep-linked path → middleware → 404 (don't reveal existence).

### Email links

All email templates use absolute URLs based on `NEXT_PUBLIC_APP_URL` env var.

---

## 13. 404 / not authorized handling

### 404 Not found

Use `not-found.tsx` per route group:

```tsx
// src/app/(employee)/not-found.tsx
export default function NotFound() {
  return (
    <EmptyState
      icon={<SearchX />}
      title="ไม่พบหน้าที่คุณค้นหา"
      description="ลิงก์อาจจะเก่าหรือผิด"
      action={<Button asChild><Link href="/dashboard">กลับหน้าหลัก</Link></Button>}
    />
  );
}
```

Each role group has its own — back-button goes to role-appropriate home.

### Permission denied

Treat as 404 (don't leak page existence).

For specifically "you need higher role" UX (e.g., user clicks Settings link from email but they're not Admin):

- Server-side: middleware → 404
- Client-side: hide nav items via role check (don't render link they can't access)

### Role downgrade mid-session

If user's role changes (e.g., Admin demoted to User):
- On next request → middleware notices → if path no longer accessible → redirect to role-appropriate dashboard
- Toast: "บัญชีของคุณมีการเปลี่ยนแปลง — โปรดเข้าสู่ระบบใหม่"

---

# Cross-references

- **Screens:** [auth.md](./auth.md), employee.md, admin.md, owner.md
- **Auth flow:** [flows.md FL-1, FL-2](./flows.md#fl-1-first-time-onboarding)
- **Component specs:** [design-system.md §10](../design-system.md#10-component-catalog)
- **Architecture:** [architecture.md §4](../architecture.md#4-authentication-detail) (auth middleware), [§7](../architecture.md#7-background-jobs-inngest) (Inngest)
