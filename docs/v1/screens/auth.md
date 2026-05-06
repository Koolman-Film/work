# Auth Screens

ครอบคลุม: 4 screens, 5 forms, 2 modals, 6 toasts, 4 SMS templates, 8 edge cases

**Section prefix:** `A` (e.g., S-A1, F-A1, T-A1)

---

## Section index

### Screens (4)
- [S-A1: Login](#s-a1-login) ⭐
- [S-A2: Verify OTP](#s-a2-verify-otp) ⭐
- [S-A3: Welcome (set password from invite)](#s-a3-welcome) ⭐
- [S-A4: Reset Password](#s-a4-reset-password) ⭐

### Forms (5)
- [F-A1: Login form](#f-a1-login-form)
- [F-A2: OTP verify form](#f-a2-otp-verify-form)
- [F-A3: Welcome form (set initial password)](#f-a3-welcome-form)
- [F-A4: Reset request form](#f-a4-reset-request-form)
- [F-A5: New password form](#f-a5-new-password-form)

### Modals (2)
- [M-A1: Session expired](#m-a1-session-expired)
- [M-A2: Sign out confirm](#m-a2-sign-out-confirm)

### Toasts (6)
- [T-A1 → T-A6](#auth-toasts)

### SMS templates (4)
- [E-A1 → E-A4](#auth-sms-templates)

### Edge cases (8)
- [X-A1 → X-A8](#auth-edge-cases)

---

## Auth flow overview

```
                        ┌─────────────────────┐
                        │ User opens app       │
                        └──────────┬──────────┘
                                    │
                       ┌────────────▼────────────┐
                       │ Has valid session?       │
                       └─┬────────────┬──────────┘
                         │ YES        │ NO
                         ▼            ▼
                  Dashboard       /login (S-A1)
                                       │
                                       │ submit creds
                                       ▼
                              ┌────────────────────┐
                              │ verifyPassword OK?  │
                              └─┬────────┬─────────┘
                                │ YES    │ NO
                                ▼        ▼
                         /verify-otp   error toast (T-A2)
                         (S-A2)
                                │ submit code
                                ▼
                       ┌────────────────────────┐
                       │ verifyOtp OK?           │
                       └─┬────────────┬─────────┘
                         │ YES        │ NO
                         ▼            ▼
                Set session   T-A2 / X-A2 (wrong code)
                cookie
                         │
                         ▼
            Redirect by Role (Employee/Admin/Owner dashboard)
```

**Parallel flows:**
- **Admin invite (E-A1):** Admin pre-creates Employee → SMS link → `/welcome?token=...` (S-A3) → set password → auto-login → dashboard
- **Reset (S-A4):** "ลืมรหัสผ่าน?" → `/reset-password` → SMS OTP → set new password → auto-login

---

# Screens

## S-A1: Login

- **Path:** `/login`
- **Role:** Public (anonymous)
- **Purpose:** Primary entry point — phone + password
- **Auth state:** if already logged in → redirect to role-based dashboard
- **Priority:** ⭐ critical — every user enters here

### Layout

- Centered card, max-width **400px**
- Background: subtle gradient `linear-gradient(135deg, primary-50, white)`
- Card: `radius-xl` (20px), `shadow-md` (brand glow), padding 32px
- Logo 56px at top (Finnix red square placeholder, swap when customer provides asset)
- Footer below card: "Powered by Koolman HR"

### Wireframe

```
┌──────────────────────────────────────────────┐
│              [bg gradient]                   │
│                                              │
│                                              │
│           ┌──────────────────────┐           │
│           │                      │           │
│           │   ┌──────┐           │           │
│           │   │  FF  │  56×56    │           │
│           │   └──────┘           │           │
│           │                      │           │
│           │   เข้าสู่ระบบ          │           │
│           │   Koolman HR · Koolman │     │
│           │                      │           │
│           │   เบอร์โทรศัพท์                │           │
│           │   ┌──────────────┐   │           │
│           │   │              │   │           │
│           │   └──────────────┘   │           │
│           │                      │           │
│           │   รหัสผ่าน              │           │
│           │   ┌──────────────┐   │           │
│           │   │              │   │           │
│           │   └──────────────┘   │           │
│           │                      │           │
│           │   [   เข้าสู่ระบบ   ]   │           │
│           │                      │           │
│           │   ลืมรหัสผ่าน?          │           │
│           │                      │           │
│           └──────────────────────┘           │
│                                              │
│         Powered by Koolman HR                │
│                                              │
└──────────────────────────────────────────────┘
```

### Components

| Element | Component | Notes |
|---|---|---|
| Logo | Custom `<Logo>` | 56×56 red square, "FF" text or actual asset |
| Page heading | `<h1>` text-2xl bold | "เข้าสู่ระบบ" |
| Subtitle | `<p>` text-sm muted | "Koolman HR · Koolman" |
| Phone field | shadcn `<Input>` + label | type=tel, autocomplete=tel |
| Password field | shadcn `<Input>` + label | type=password, autocomplete=current-password |
| Submit button | shadcn `<Button>` variant=primary, size=md, full-width | "เข้าสู่ระบบ" |
| Forgot link | shadcn `<Link>` underlined | text-sm primary-600 |

### Server Actions

- `signIn(phone, password)` — see [architecture.md §6](../architecture.md#6-server-actions-inventory)

### States

#### Default
- Empty inputs, button enabled

#### Submitting
- Button shows spinner + "กำลังเข้าสู่ระบบ..."
- Inputs disabled
- Submit happens via `signIn` server action

#### Success
- Server returns `{ ok: true, requiresOtp: true, phone }` (always for V1)
- Client: Toast T-A1 "ส่ง OTP ไปยัง {phone}"
- Redirect to `/verify-otp?phone={phone}`

#### Error
- Bad credentials → Toast T-A2 "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง"
- Account archived → Toast variant "บัญชีไม่ได้ใช้งาน — ติดต่อแอดมิน"
- Account never invited → Toast variant "ยังไม่ได้รับคำเชิญ — ติดต่อแอดมิน"
- Rate limited (X-A1) → Toast "พยายามบ่อยเกินไป — รอ 5 นาทีแล้วลองใหม่"
- Network error → inline alert below button + retry option

#### Mobile
- Same layout, padding adjusts (24px instead of 32px)
- Form takes full width minus 16px lateral

### Interactions

- Tab order: phone → password → submit → forgot link
- Enter key in any field submits form
- Caps Lock detected on password → small hint icon shown
- Browser autofill works (form has autocomplete)

### Accessibility

- `<form>` with explicit submit
- Labels properly associated (`htmlFor`)
- Submit button is `type="submit"`
- Focus visible (ring-2 ring-primary-500)
- Error messages announced via aria-live="polite"

### Form: see [F-A1](#f-a1-login-form)

---

## S-A2: Verify OTP

- **Path:** `/verify-otp?phone={phone}`
- **Role:** Public (in transit between login and authenticated state)
- **Purpose:** Verify 6-digit OTP code sent via SMS
- **Auth state:** must come from `/login` (verify session intent)
- **Priority:** ⭐

### Layout

Same shape as login (centered card, 400px), but:
- Card slightly different: shows phone confirmation, OTP input grid, countdown timer

### Wireframe

```
┌──────────────────────────────────────────────┐
│                                              │
│           ┌──────────────────────┐           │
│           │  ← กลับ                │           │
│           │                      │           │
│           │   ✉️                   │           │
│           │                      │           │
│           │   ยืนยันรหัส OTP        │           │
│           │                      │           │
│           │   ส่งรหัส 6 หลักไปที่     │           │
│           │   081-234-5678 │           │
│           │                      │           │
│           │   ┌─┐┌─┐┌─┐┌─┐┌─┐┌─┐  │           │
│           │   │1││2││3││4││5││6│  │           │
│           │   └─┘└─┘└─┘└─┘└─┘└─┘  │           │
│           │                      │           │
│           │   [    ยืนยัน    ]    │           │
│           │                      │           │
│           │   ส่งใหม่ใน 0:45        │           │
│           │   (or [ส่งรหัสอีกครั้ง]) │           │
│           │                      │           │
│           └──────────────────────┘           │
│                                              │
└──────────────────────────────────────────────┘
```

### Components

| Element | Component | Notes |
|---|---|---|
| Back link | `<Link>` to `/login` | text-sm muted |
| Email icon | Lucide `<Mail>` | 32×32, primary-600 |
| Heading | `<h1>` text-2xl bold | "ยืนยันรหัส OTP" |
| Description | `<p>` text-sm | shows masked phone |
| OTP input | Custom `<OtpInput>` (6 individual cells) | shadcn `<InputOTP>` works |
| Submit button | `<Button>` variant=primary, full-width | disabled until 6 digits entered |
| Resend countdown | `<Text>` muted + `<Button>` ghost | swap based on timer |

### Server Actions

- `verifyResetOtp(phone, code)`
- `resendResetOtp(phone)`

### States

#### Default (just landed)
- Cells empty, focus on first cell
- Submit disabled
- Resend countdown starts at 60s ("ส่งใหม่ใน 1:00")

#### Typing
- Each digit auto-advances cursor to next cell
- Backspace clears current and goes back
- Paste 6-digit code → auto-fills all cells
- When 6 digits entered → submit auto-enabled (do NOT auto-submit)

#### Submitting
- Cells disabled (visual: slightly dimmed)
- Submit shows spinner

#### Success
- Toast T-A4 "ยืนยันสำเร็จ"
- Cookie session set
- Redirect by role (Employee → /dashboard, Admin → /admin/dashboard, Owner → /owner/dashboard)

#### Error: wrong code
- Toast T-A2 variant "รหัส OTP ไม่ถูกต้อง"
- Cells flash red briefly (animation 200ms)
- Cells cleared, focus first
- Lockout warning after 3 wrong (X-A2)

#### Error: expired
- Toast "รหัสหมดอายุ — กรุณาขอรหัสใหม่"
- Resend button enabled

#### Resend countdown
- 60s starts on land + each successful resend
- "ส่งใหม่ใน 0:45" (decreases)
- After 0:00 → "ส่งรหัสอีกครั้ง" button replaces text

### Interactions

- 6 cells: arrow keys navigate, backspace clears+back, paste auto-fills
- Submit button: disabled when < 6 digits, enabled when all filled
- Click resend → call `resendOtp`, toast T-A3, restart 60s countdown
- Back arrow → back to `/login`

### Form: see [F-A2](#f-a2-otp-verify-form)

---

## S-A3: Welcome

- **Path:** `/welcome?token={inviteToken}`
- **Role:** Public (in invite flow)
- **Purpose:** Set initial password after Admin invite
- **Auth state:** validate token first; if expired/used → error state
- **Priority:** ⭐

### Layout

Same centered card pattern:

```
┌──────────────────────────────────────────────┐
│                                              │
│           ┌──────────────────────┐           │
│           │                      │           │
│           │   ┌──────┐           │           │
│           │   │  FF  │           │           │
│           │   └──────┘           │           │
│           │                      │           │
│           │   ยินดีต้อนรับ!         │           │
│           │   081-234-5678 │           │
│           │                      │           │
│           │   ตั้งรหัสผ่านครั้งแรก   │           │
│           │                      │           │
│           │   รหัสผ่าน              │           │
│           │   ┌──────────────┐   │           │
│           │   │              │   │           │
│           │   └──────────────┘   │           │
│           │   ✓ ≥ 8 ตัวอักษร       │           │
│           │   ✓ มีตัวเลข            │           │
│           │                      │           │
│           │   ยืนยันรหัสผ่าน         │           │
│           │   ┌──────────────┐   │           │
│           │   │              │   │           │
│           │   └──────────────┘   │           │
│           │                      │           │
│           │   [  เริ่มใช้งาน   ]    │           │
│           │                      │           │
│           └──────────────────────┘           │
└──────────────────────────────────────────────┘
```

### Components

| Element | Component | Notes |
|---|---|---|
| Logo | Same as Login | |
| Heading | `<h1>` text-2xl bold | "ยินดีต้อนรับ!" |
| Sub-heading | `<p>` text-sm muted | shows invitee phone |
| Section title | `<p>` text-base | "ตั้งรหัสผ่านครั้งแรก" |
| Password field | `<Input>` type=password | autocomplete=new-password |
| Strength indicators | Custom `<PasswordStrength>` with checks | live update as user types |
| Confirm password | `<Input>` type=password | must match |
| Submit button | `<Button>` primary, full-width | disabled until valid + match |

### Server Actions

- `verifyInviteToken(token)` — on page load (Server Component)
- `setInitialPassword(token, password)` — on submit

### States

#### Initial load
- Server component validates token
- If valid → show form
- If invalid (X-A3) → show error state with [กลับสู่หน้าเข้าสู่ระบบ] button
- If expired (X-A3 variant) → similar error state with note

#### Form valid
- Password ≥ 8 chars + at least 1 number
- Confirm matches password
- → Submit enabled

#### Submitting
- Button spinner
- Inputs disabled

#### Success
- Auto sign-in (server creates session)
- Toast T-A6 "ยินดีต้อนรับ! กำลังพาคุณไปหน้าหลัก..."
- Redirect by role to dashboard

#### Error
- Server validation fail → inline error
- Token used elsewhere mid-flow → toast + redirect to login

### Form: see [F-A3](#f-a3-welcome-form)

---

## S-A4: Reset Password

Two-step screen with same path:

### Step 1: Request reset (default)

- **Path:** `/reset-password` (no params)
- **Purpose:** Request SMS OTP to phone

### Step 2: Set new password

- **Path:** `/reset-password?token={resetToken}`
- **Purpose:** Set new password with valid token

### Layout — Step 1

```
┌──────────────────────────────────────────────┐
│           ┌──────────────────────┐           │
│           │  ← กลับสู่ login        │           │
│           │                      │           │
│           │   🔐                   │           │
│           │                      │           │
│           │   ลืมรหัสผ่าน?          │           │
│           │                      │           │
│           │   กรอกเบอร์มือถือที่ลงทะเบียน  │           │
│           │   เราจะส่งลิงก์สำหรับ   │           │
│           │   รีเซ็ตรหัสผ่านไปให้คุณ │           │
│           │                      │           │
│           │   เบอร์โทรศัพท์                │           │
│           │   ┌──────────────┐   │           │
│           │   │              │   │           │
│           │   └──────────────┘   │           │
│           │                      │           │
│           │   [  ส่งลิงก์   ]      │           │
│           │                      │           │
│           └──────────────────────┘           │
└──────────────────────────────────────────────┘
```

### Layout — Step 2

```
┌──────────────────────────────────────────────┐
│           ┌──────────────────────┐           │
│           │                      │           │
│           │   ✓                    │           │
│           │                      │           │
│           │   ตั้งรหัสผ่านใหม่      │           │
│           │   081-234-5678 │           │
│           │                      │           │
│           │   รหัสผ่านใหม่           │           │
│           │   ┌──────────────┐   │           │
│           │   │              │   │           │
│           │   └──────────────┘   │           │
│           │                      │           │
│           │   ยืนยันรหัสผ่าน         │           │
│           │   ┌──────────────┐   │           │
│           │   │              │   │           │
│           │   └──────────────┘   │           │
│           │                      │           │
│           │   [  บันทึก   ]       │           │
│           │                      │           │
│           └──────────────────────┘           │
└──────────────────────────────────────────────┘
```

### Server Actions

- Step 1: `resetPasswordRequest(phone)`
- Step 2: `resetPassword(token, newPassword)`

### States

#### Step 1: Default
- Phone field empty
- Submit enabled (button doesn't pre-validate)

#### Step 1: Submitting
- Spinner

#### Step 1: Success
- Always show same UI regardless of phone exists (X-A4 — privacy: don't reveal phone registry)
- "ส่งลิงก์รีเซ็ตไปแล้ว — โปรดตรวจสอบ SMS (รวมถึง Spam)"
- [กลับสู่หน้าเข้าสู่ระบบ] button

#### Step 2: Default (token validation)
- Server validates token on page load
- If invalid/expired (X-A5) → error state with retry

#### Step 2: Form valid
- Password ≥ 8 chars + 1 number, confirm matches → submit enabled

#### Step 2: Success
- Auto sign-in
- Toast T-A5 "เปลี่ยนรหัสผ่านสำเร็จ"
- Redirect to dashboard

### Forms: see [F-A4](#f-a4-reset-request-form), [F-A5](#f-a5-new-password-form)

---

# Forms

## F-A1: Login form

- **Used in:** S-A1
- **Submit handler:** Server Action `signIn`

### Fields

| Field | Type | Required | Validation | Default | Note |
|---|---|---|---|---|---|
| `phone` | phone | Yes | E.164 format `+66...` | — | autocomplete=tel, autofocus on mount |
| `password` | password | Yes | min 1 char (let server reject if too short) | — | autocomplete=current-password |

### Submit behavior

```
on submit:
  validate fields client-side (Zod)
  if invalid → inline errors, do not call server
  call signIn(phone, password)
  if ok && requiresOtp:
    toast T-A1 "ส่ง OTP ไปยัง {masked-phone}"
    router.push("/verify-otp?phone=" + encodeURIComponent(phone))
  if ok && !requiresOtp (V2):
    router.push(role-based dashboard)
  if !ok:
    toast T-A2 with appropriate message
    keep phone filled, clear password
    set focus on password
```

### Cancel behavior

No cancel — leave is via "← back" or directly closing tab.

---

## F-A2: OTP verify form

- **Used in:** S-A2
- **Submit handler:** Server Action `verifyOtp`

### Fields

| Field | Type | Required | Validation | Default | Note |
|---|---|---|---|---|---|
| `code` | string (6 chars) | Yes | exactly 6 digits | — | renders as 6 separate cells |

(Email is in URL param, not in form)

### Submit behavior

```
on submit (auto-enabled when 6 digits):
  call verifyResetOtp(phone, code)
  if ok:
    server sets session cookie
    toast T-A4 "ยืนยันสำเร็จ"
    router.push(role-based dashboard)
  if !ok && reason="expired":
    toast "รหัสหมดอายุ — ขอรหัสใหม่"
    cells stay (let user click resend)
  if !ok && reason="invalid":
    toast T-A2 "รหัส OTP ไม่ถูกต้อง"
    cells flash red, clear, focus first
    after 3 wrong → X-A2 lockout
```

### Resend behavior

```
on resend click:
  call resendResetOtp(phone)
  toast T-A3 "ส่งรหัสใหม่แล้ว"
  reset countdown 60s
```

---

## F-A3: Welcome form

- **Used in:** S-A3
- **Submit handler:** Server Action `setInitialPassword(token, password)`

### Fields

| Field | Type | Required | Validation | Default | Note |
|---|---|---|---|---|---|
| `password` | password | Yes | ≥8 chars, ≥1 number, ≤72 chars (bcrypt limit) | — | autocomplete=new-password |
| `confirmPassword` | password | Yes | must equal password | — | autocomplete=new-password |

(Token is in URL param, not in form)

### Live validation indicators

While typing password, show checklist:
- ✓ ≥ 8 ตัวอักษร (green when met)
- ✓ มีตัวเลข
- (gray if not yet met)

### Submit behavior

```
on submit:
  Zod validate (both fields, match)
  call setInitialPassword(token, password)
  if ok:
    server creates session
    toast T-A6 "ยินดีต้อนรับ!"
    router.push(role-based dashboard)
  if !ok && reason="token-invalid":
    full page error state, button to login
  if !ok && reason="weak-password":
    inline error
```

---

## F-A4: Reset request form

- **Used in:** S-A4 step 1
- **Submit handler:** Server Action `resetPasswordRequest(phone)`

### Fields

| Field | Type | Required | Validation | Default | Note |
|---|---|---|---|---|---|
| `phone` | phone | Yes | RFC 5322 | — | autocomplete=tel |

### Submit behavior

```
on submit:
  call resetPasswordRequest(phone)
  // Server always returns ok (privacy — don't reveal if phone exists)
  show success state (regardless)
  "ส่งลิงก์รีเซ็ตไปแล้ว..."
```

---

## F-A5: New password form

- **Used in:** S-A4 step 2
- **Submit handler:** Server Action `resetPassword(token, newPassword)`

### Fields

Same as F-A3 (password + confirm).

### Submit behavior

```
on submit:
  Zod validate
  call resetPassword(token, newPassword)
  if ok:
    server creates session
    toast T-A5 "เปลี่ยนรหัสผ่านสำเร็จ"
    router.push(role-based dashboard)
  if !ok && reason="token-invalid": full page error
```

---

# Modals

## M-A1: Session expired

- **Trigger:** Any authenticated request returns 401 (e.g., session token expired and refresh failed)
- **Title:** "เซสชันหมดอายุ"
- **Body:** "เซสชันของคุณหมดอายุ — กรุณาเข้าสู่ระบบอีกครั้ง"
- **Actions:**
  - [Login] (primary, blue) → close modal + push `/login?redirectTo={currentPath}`
- **Outcome:** User goes to login with redirect param to bring back to where they were after success

### Implementation

```tsx
// Triggered by global error handler / Auth.js callback
<AlertDialog open={sessionExpired}>
  <AlertDialogContent>
    <AlertDialogTitle>เซสชันหมดอายุ</AlertDialogTitle>
    <AlertDialogDescription>กรุณาเข้าสู่ระบบอีกครั้ง</AlertDialogDescription>
    <AlertDialogAction onClick={() => router.push('/login?redirectTo=' + path)}>
      เข้าสู่ระบบ
    </AlertDialogAction>
  </AlertDialogContent>
</AlertDialog>
```

---

## M-A2: Sign out confirm

- **Trigger:** User clicks "ออกจากระบบ" in profile dropdown / settings
- **Title:** "ออกจากระบบ?"
- **Body:** "คุณจะต้องเข้าสู่ระบบใหม่"
- **Actions:**
  - [ยกเลิก] (secondary) → close modal
  - [ออกจากระบบ] (danger) → call signOut server action → push `/login`

---

# Auth toasts

## T-A1: OTP sent (initial after login)

- **Trigger:** After successful `signIn`
- **Type:** info
- **Message:** "ส่งรหัส OTP ไปยัง {masked-phone}"
- **Duration:** 4s
- **Action:** none

## T-A2: Login failed (variants)

- **Trigger:** Login or OTP verify error
- **Type:** error
- **Message variants:**
  - "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง" (default bad creds)
  - "รหัส OTP ไม่ถูกต้อง"
  - "รหัสหมดอายุ — ขอรหัสใหม่"
  - "บัญชีไม่ได้ใช้งาน — ติดต่อแอดมิน"
  - "พยายามบ่อยเกินไป — รอ 5 นาที"
- **Duration:** 6s (errors longer)
- **Action:** none (or "ลองใหม่" for network errors)

## T-A3: OTP resent

- **Trigger:** After `resendOtp` success
- **Type:** info
- **Message:** "ส่งรหัสใหม่แล้ว — โปรดตรวจสอบ SMS"
- **Duration:** 4s

## T-A4: OTP verified (login complete)

- **Trigger:** After successful `verifyOtp`
- **Type:** success
- **Message:** "เข้าสู่ระบบสำเร็จ"
- **Duration:** 3s

## T-A5: Password reset complete

- **Trigger:** After successful `resetPassword`
- **Type:** success
- **Message:** "เปลี่ยนรหัสผ่านสำเร็จ"
- **Duration:** 4s

## T-A6: Welcome (first login from invite)

- **Trigger:** After successful `setInitialPassword`
- **Type:** success
- **Message:** "ยินดีต้อนรับสู่ Koolman HR!"
- **Duration:** 5s

---

# Auth SMS templates

All sent via Thai SMS provider (e.g., ThaiBulkSMS) for OTP/invite. See [architecture.md §7](../architecture.md#7-background-jobs-inngest) for queue.

## E-A1: Admin invite SMS

- **Trigger:** Admin creates Employee → server calls `supabase.auth.admin.inviteUserByPhone(phone)`
- **Subject:** "ยินดีต้อนรับสู่ Koolman HR — กรุณาตั้งรหัสผ่าน"
- **Sender:** Koolman HR <noreply@finnixfilm.com>
- **Key elements:**
  - Greeting (using FullName)
  - Brief intro to the system
  - Big primary button: [ตั้งรหัสผ่าน] linking to `/welcome?token=...`
  - Note: link expires in 7 days
  - Brief contact info (Admin phone or HR phone)
  - Footer + brand stripe

### Body sample (Thai)

```
สวัสดีคุณ ตงค์ สมศรี,

แอดมินได้สร้างบัญชี Koolman HR ให้คุณแล้ว
กรุณาคลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านครั้งแรก:

  [ ตั้งรหัสผ่าน ]

ลิงก์นี้จะหมดอายุใน 7 วัน
ถ้าคุณไม่ได้คาดหวังเบอร์โทรศัพท์นี้ ให้ลบทิ้งได้เลย

มีคำถาม? ติดต่อ admin@finnixfilm.com

— Koolman HR
```

## E-A2: OTP code SMS

- **Trigger:** Login flow → `signInWithOtp` → Supabase sends, OR our wrapper sends
- **Subject:** "รหัส OTP สำหรับเข้าสู่ระบบ Koolman HR"
- **Key elements:**
  - Brief greeting
  - **Big 6-digit code** in centered, large monospace
  - Validity: "หมดอายุใน 10 นาที"
  - Security note: "ถ้าคุณไม่ได้พยายามเข้าสู่ระบบ ให้ละเลยเบอร์โทรศัพท์นี้และเปลี่ยนรหัสผ่าน"

### Body sample

```
สวัสดี,

รหัส OTP สำหรับเข้าสู่ระบบของคุณคือ:

       ┌─────────────┐
       │  4 8 2 9 1 7│
       └─────────────┘

รหัสนี้จะหมดอายุใน 10 นาที

ถ้าคุณไม่ได้พยายามเข้าสู่ระบบ ให้ละเลยเบอร์โทรศัพท์นี้
และพิจารณาเปลี่ยนรหัสผ่านของคุณเพื่อความปลอดภัย

— Koolman HR
```

## E-A3: Password reset OTP

- **Trigger:** `resetPasswordRequest` success
- **Subject:** "รีเซ็ตรหัสผ่าน Koolman HR"
- **Key elements:**
  - Brief greeting
  - Big button: [รีเซ็ตรหัสผ่าน] → link `/reset-password?token=...`
  - Validity: "ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง"
  - Security note: didn't request → ignore

## E-A4: Password changed notification

- **Trigger:** After successful password change (login flow OR reset flow)
- **Subject:** "รหัสผ่านของคุณถูกเปลี่ยนแล้ว"
- **Key elements:**
  - Confirmation message
  - Time + IP/device info (audit transparency)
  - "ถ้าไม่ใช่คุณ ติดต่อ admin@finnixfilm.com ทันที"

This is **security SMS** — always sent, no opt-out.

---

# Auth edge cases

## X-A1: Login rate-limited

- **Trigger:** > 5 failed login attempts in 15 minutes (Supabase Auth default)
- **UX:**
  - Toast T-A2 variant "พยายามบ่อยเกินไป — รอ 5 นาทีแล้วลองใหม่"
  - Submit button disabled with countdown text "ลองอีกครั้งใน 5:00"
  - After unlock, full reset

## X-A2: OTP wrong 3+ times

- **Trigger:** 3rd consecutive wrong OTP
- **UX:**
  - Toast "รหัสผิด 3 ครั้ง — กลับสู่หน้าเข้าสู่ระบบ"
  - Cells locked, button disabled
  - Auto-redirect to `/login` after 3s

## X-A3: Invite token invalid/expired

- **Trigger:** `/welcome?token=...` with bad/expired token
- **UX:**
  - Full-page error state instead of form
  - Title: "ลิงก์ไม่ถูกต้อง"
  - Message: "ลิงก์เชิญหมดอายุหรือถูกใช้แล้ว — ติดต่อแอดมินเพื่อขอลิงก์ใหม่"
  - Button: [กลับสู่หน้าเข้าสู่ระบบ]

## X-A4: Reset request for non-existent phone

- **Trigger:** User submits unknown phone at `/reset-password`
- **UX:**
  - Show success state anyway (privacy — don't reveal user enumeration)
  - Server logs but doesn't SMS
  - "ถ้าเบอร์โทรศัพท์นี้มีอยู่ในระบบ คุณจะได้รับลิงก์ภายใน 1 นาที"

## X-A5: Reset token invalid/expired

- **Trigger:** `/reset-password?token=...` with bad/expired
- **UX:**
  - Full-page error state
  - "ลิงก์รีเซ็ตหมดอายุ — ขอลิงก์ใหม่"
  - Button: [ขอลิงก์ใหม่] → back to step 1

## X-A6: User logged in tries to access /login

- **Trigger:** Authenticated user navigates to `/login`
- **UX:** Server-side redirect to role-based dashboard (no flicker)

## X-A7: User archived mid-session

- **Trigger:** Admin archives Employee while they're logged in; on next request middleware checks status
- **UX:**
  - Force sign-out
  - Show M-A1 with custom message: "บัญชีนี้ถูกระงับ — ติดต่อแอดมิน"

## X-A8: Browser without JavaScript

- **Trigger:** rare, but accessibility consideration
- **UX:** Forms work as `<form action={serverAction}>` — Server Actions native progressive enhancement
- All flows work without JS (auto-advance OTP cells degrade to manual focus)

---

# Acceptance criteria (auth section)

Before marking auth as "done":

- ✅ Login works for valid creds → OTP screen
- ✅ OTP arrives via SMS within 30s
- ✅ OTP verify works → dashboard
- ✅ Wrong OTP shows clear error
- ✅ Resend OTP works after 60s
- ✅ Reset password full flow works (request → SMS OTP → set new → login)
- ✅ Admin invite full flow works
- ✅ All toasts in Thai, all error messages helpful
- ✅ Mobile responsive (320px+)
- ✅ Keyboard nav works (Tab, Enter, Esc)
- ✅ Rate limiting kicks in after abuse
- ✅ Session persists across reload (cookie)
- ✅ Sign out clears cookie + redirects
- ✅ All edge cases (X-A1 through X-A8) tested manually
- ✅ SMS templates render in Gmail, Outlook, Apple Mail
- ✅ Light + dark mode work

---

# Implementation notes

## Tech tasks (W2 of build)

1. Install Supabase SSR helpers
2. Create `src/lib/supabase/{server,browser,middleware}.ts`
3. Build `(auth)/login/page.tsx` + form component
4. Build `(auth)/verify-otp/page.tsx` + OTP input
5. Build `(auth)/welcome/page.tsx` + token validation in Server Component
6. Build `(auth)/reset-password/page.tsx` (handles both steps via searchParam)
7. Server Actions in `src/server/actions/auth.ts` (signIn, verifyOtp, resendOtp, resetRequest, resetPassword, setInitialPassword, signOut)
8. Middleware `src/middleware.ts` for session refresh + role redirect
9. SMS templates in `src/lib/sms/templates/` (welcome, otp, reset, password-changed)
10. Toast system (sonner) integrated with `toast.success/error`
11. Tests: E2E happy path + 3 critical edge cases (X-A1, X-A3, X-A5)

## Security checklist

- [ ] HTTPS enforced
- [ ] Cookie: HttpOnly, Secure, SameSite=Lax
- [ ] CSRF protected (Server Actions native)
- [ ] Rate limit on signIn + resetPasswordRequest (Supabase Auth handles default)
- [ ] Password ≥ 8 chars enforced server-side
- [ ] Bcrypt via Supabase (don't roll own)
- [ ] No password in URL ever
- [ ] No password logged
- [ ] OTP expires in 10 min
- [ ] Invite token expires in 7 days
- [ ] Reset token expires in 1 hour
- [ ] Audit log: every login, password change, password reset

## Related docs

- [feature-spec.md §F1](../feature-spec.md#module-1-authentication) — business logic
- [architecture.md §4](../architecture.md#4-authentication-detail) — auth flows technical
- [build-plan.md W2](../build-plan.md#week-2-auth--employee-management) — when to build
- [design-system.md §10.1-10.2](../design-system.md#101-button) — Button/Input components
