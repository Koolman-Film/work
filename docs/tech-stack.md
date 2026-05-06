# Tech Stack — Koolman HR

**Status:** ✅ **Locked** — approved by dev (2026-05-06)

**Selection criteria:**
1. **Easy to maintain (solo dev)** — minimize ops surface
2. **Popular** — large community, easy to hire help
3. **Scale** — รองรับ 100 → 1,000+ users และหลักสิบสาขา
4. **Easy to extend** — V2/V3 features ไม่ต้อง rewrite
5. **TypeScript end-to-end** — type safety
6. **Provider-agnostic** — ลูกค้า open ไม่ผูก AWS

---

## ✅ Final Stack

### Core (3 vendors only)

| Layer | Choice | Cost/month |
|---|---|---|
| **App hosting** | **Vercel Pro** | $20 |
| **DB + Storage + Realtime** | **Supabase Pro** (Singapore region) | $25 |
| **Email** | **Resend** (free tier 3K/month) — for slip PDF, optional notif | $0 |
| **SMS (Thai)** | **ThaiBulkSMS** / SMS Master — invite + reset OTP only | ~$3/mo (124 emp) |

### Application stack — versions + maintenance audit (May 2026)

| Layer | Choice | Latest stable | Maintenance | Watch / alternative |
|---|---|---|---|---|
| Language | **TypeScript** | `5.9.x` | 🟢 Microsoft | — |
| Runtime | **Node.js 24 LTS** | `24.x` | 🟢 OpenJS (Active LTS until Apr 2028) | Bun for non-Vercel |
| Framework | **Next.js** (App Router) | **`16.x`** ⚠️ | 🟢 Vercel | TanStack Start (beta), React Router 7 |
| React | **React 19** | `19.x` | 🟢 Meta | — |
| UI engine | **Tailwind CSS** | **`4.x`** ⚠️ | 🟢 Tailwind Labs | UnoCSS, Panda CSS |
| Component lib | **shadcn/ui** (Radix-based, registry) | rolling | 🟢 shadcn (independent) | Park UI, Mantine v7 |
| Forms | **React Hook Form** | `7.x` | 🟢 react-hook-form | **Conform** (server-action focused), TanStack Form |
| Validation | **Zod 4** | `4.x` | 🟢 colinhacks | **Valibot** (90% smaller bundle), ArkType |
| Server state | **TanStack Query** | `5.x` | 🟢 Tanner Linsley | SWR (simpler) |
| Client state | **Zustand** | `5.x` | 🟢 pmndrs | Jotai (atomic), Valtio (proxy) |
| ORM | **Prisma** | `6.x` | 🟢 Prisma | **Drizzle ORM** — serverless contender ⚠️ |
| Auth | **Supabase Auth** | rolling SaaS | 🟢 Supabase | Clerk (paid), Auth.js v5 |
| Background jobs | **Inngest** | rolling SaaS | 🟢 Inngest Inc. | Trigger.dev v3, Upstash QStash |
| Scheduled jobs | **Vercel Cron** | built-in | 🟢 Vercel | — |
| PDF generation | **@react-pdf/renderer** | `4.x` | 🟡 slower pace | **pdf-lib** (programmatic), Puppeteer + @sparticuz/chromium |
| Email templates | **react-email** | `4.x` | 🟢 Resend team | Maizzle (HTML-first) |
| File storage | **Supabase Storage** | rolling | 🟢 Supabase | (built into Supabase Pro) |
| LINE (V1.5) | **@line/bot-sdk** + LIFF SDK | `9.x` / `2.x` | 🟢 LINE Corp | (official only) |
| CDN | **Vercel Edge Network** | built-in | 🟢 Vercel | — |
| Secrets | **Vercel env** + Supabase vault | built-in | 🟢 | — |
| Errors | **Sentry** | `9.x` SDK | 🟢 Sentry | PostHog (errors+analytics), Highlight.io (OSS) |
| Logging | **Pino** | `9.x` | 🟢 Matteo Collina | Winston (slower), Bunyan (declining) |
| CI/CD | **GitHub Actions** | rolling | 🟢 GitHub | — |
| Repo | **GitHub** (private) | — | 🟢 | — |
| Unit tests | **Vitest** | `3.x` | 🟢 Vitest team | Jest (slower) |
| E2E tests | **Playwright** | `1.5x.x` | 🟢 Microsoft | Cypress (declining) |
| Linting + format | **Biome** | **`2.x`** ⚠️ | 🟢 Biome (OSS) | **oxlint** (Rust, lint-only) + **dprint** |
| Date | **date-fns** + `th` locale | `4.x` | 🟢 | Day.js (smaller), Temporal (polyfill, still stage 3) |
| i18n | **next-intl** | `4.x` | 🟢 amann | **Paraglide** (compile-time, type-safe — gaining) |
| Package mgr | **pnpm** | `10.x` | 🟢 | npm 11+, Bun |

**Legend:**
- 🟢 = healthy, active maintenance
- 🟡 = maintained but slower release pace
- 🔴 = abandoned / sunset (none in current list)
- ⚠️ = major version bump — note for migration / careful upgrade

### Modern alternatives — should we reconsider?

> Refresh review (May 2026) — alternatives ที่ gain traction มากในปี 2025–2026

#### 🤔 Worth re-evaluation

**1. Drizzle ORM (vs Prisma)**
- **Pros:** Lighter bundle (~5× smaller cold start), SQL-like syntax, faster query execution, designed for serverless first
- **Cons vs Prisma:** Migration tooling less mature, no Prisma Studio, smaller community
- **Recommendation:** Consider for V1 if performance critical. **Stay with Prisma** for solo dev — better DX + tooling worth ~10ms cold start trade-off
- **Future:** Re-evaluate at V3 if scale issues

**2. Valibot (vs Zod 4)**
- **Pros:** 90% smaller bundle (1KB vs 13KB), modular, faster
- **Cons:** Smaller community, less integration with ecosystem (RHF, OpenAPI, etc.)
- **Recommendation:** **Stay with Zod 4** — bundle size not critical V1, Zod 4 already much smaller than Zod 3
- **Future:** Consider if heavy client-side bundle matters

**3. Conform (vs React Hook Form)**
- **Pros:** Server-action native, progressive enhancement (works without JS), used by Remix/Next teams
- **Cons:** Smaller community, less mature than RHF
- **Recommendation:** Consider — Next.js Server Actions match Conform well. **Stay with RHF V1** for solo dev familiarity. Re-evaluate V2.

**4. Paraglide (vs next-intl)**
- **Pros:** Compile-time, type-safe, tree-shakeable, smaller runtime
- **Cons:** Newer, smaller ecosystem
- **Recommendation:** **Stay with next-intl** V1 — TH only doesn't benefit much from Paraglide advantages
- **Future:** Consider if expanding to many languages V3

**5. oxlint + dprint (vs Biome)**
- **Pros:** oxlint is fastest linter (50× faster than ESLint), dprint super-flexible formatter
- **Cons:** Two tools instead of one, less integrated DX
- **Recommendation:** **Stay with Biome 2** — single binary easier solo dev, performance gap not critical

#### ❌ Stay away (declining or abandoned)

| Item | Status | ทำไม |
|---|---|---|
| **Tremor** (charts/dashboard) | 🔴 Sunset Vercel acquisition | Don't adopt — migrate to Recharts/Victory if needed |
| **Cypress** (E2E) | 🟡 Declining | Playwright dominant 2025+ |
| **Formik** (forms) | 🟡 Slow maintenance | RHF / Conform dominant |
| **Winston** (logging) | 🟡 Slower | Pino faster + better DX |
| **Moment.js** | 🔴 Officially deprecated | Use date-fns / Day.js |
| **TypeORM** | 🟡 Declining | Prisma / Drizzle dominant |

#### 🆕 Emerging — watch but don't adopt V1

| Item | What | When to consider |
|---|---|---|
| **TanStack Start** | Full-stack framework on TanStack Router | Stable in 2026 — V3 alternative to Next.js if frustrated |
| **Bun runtime** | Faster Node.js alternative | Good for non-Vercel deploy; Vercel Node 24 is fine |
| **Hono** | Lightweight web framework | If we ever need separate API service |
| **Effect Schema / Effect-TS** | Functional schema + effect system | Niche — full ecosystem buy-in needed |
| **Million.js** | React compiler | React 19's own compiler covers most cases |

#### Major version bump warnings

**⚠️ Tailwind CSS 4** (vs Tailwind 3):
- Oxide engine (Rust) — much faster
- **CSS-first config** — `tailwind.config.js` deprecated, use `@theme` in CSS
- No PostCSS plugin needed
- **Breaking change** — but we start fresh V1 → use v4 directly

**⚠️ Next.js 16** (vs Next.js 15):
- React 19 default
- Turbopack stable (no more `--turbo` flag needed)
- Server Actions improvements
- Some App Router patterns refined
- **Migration:** if starting fresh = no issue

**⚠️ Biome 2** (vs Biome 1):
- Plugin support expanded
- More ESLint rule parity
- Some rule renames

**⚠️ Zod 4** (vs Zod 3):
- Some breaking changes (e.g., `.refine()` API tweaks)
- Bundle size reduction
- Better TypeScript performance

→ **เริ่มจาก v4/v16/v2 ไม่มีปัญหา migration** — solo dev advantage = ไม่ต้อง upgrade legacy code

### Skip / defer

| Item | Reason |
|---|---|
| Analytics (PostHog) | Skip V1 — not critical |
| Pure SQS/Redis queue | Use Inngest แทน — solo dev simpler |

---

### Bootstrap `package.json` — concrete versions

> Ref starting point — pin major.minor, allow patch updates

```json
{
  "name": "koolman-hr",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.0.0",
    "pnpm": ">=10.0.0"
  },
  "scripts": {
    "dev": "next dev --turbo",
    "build": "next build",
    "start": "next start",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "db:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@supabase/supabase-js": "^2.x",
    "@supabase/ssr": "^0.x",
    "@prisma/client": "^6.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "react-hook-form": "^7.x",
    "@hookform/resolvers": "^3.x",
    "zod": "^4.0.0",
    "@tanstack/react-query": "^5.x",
    "zustand": "^5.x",
    "inngest": "^3.x",
    "resend": "^4.x",
    "@react-email/components": "^0.x",
    "@react-pdf/renderer": "^4.x",
    "@line/bot-sdk": "^9.x",
    "@line/liff": "^2.x",
    "@sentry/nextjs": "^9.x",
    "pino": "^9.x",
    "date-fns": "^4.x",
    "next-intl": "^4.x",
    "exceljs": "^4.x",
    "@radix-ui/react-*": "latest",
    "class-variance-authority": "^0.7.x",
    "clsx": "^2.x",
    "tailwind-merge": "^2.x"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "@types/node": "^24.x",
    "@types/react": "^19.x",
    "@types/react-dom": "^19.x",
    "prisma": "^6.0.0",
    "@biomejs/biome": "^2.0.0",
    "vitest": "^3.x",
    "@vitejs/plugin-react": "^4.x",
    "@playwright/test": "^1.5x.x",
    "tsx": "^4.x"
  },
  "packageManager": "pnpm@10.x"
}
```

> shadcn/ui = ไม่ใช่ npm package — install ผ่าน CLI (`pnpm dlx shadcn@latest add [component]`) → copy เข้า `src/components/ui/`

## Final V1 cost

| Service | Monthly | Yearly |
|---|---|---|
| Vercel Pro | $20 | $240 |
| Supabase Pro | $25 | $300 |
| Resend (free tier) | $0 | $0 |
| Inngest (free tier) | $0 | $0 |
| Sentry (free tier) | $0 | $0 |
| GitHub (free) | $0 | $0 |
| Domain | $1.25 | $15 |
| **V1 Total** | **~$46/mo** | **~$555/yr** |
| LINE Messaging API (V1.5) | $0–50 | $0–600 |

→ **~1,600 บาท/เดือน** หลัง launch — ถูกกว่า SaaS HR สำเร็จรูป (Empeo ~5,000 บาท/เดือน 100 emp) มาก

---

## ทำไมเลือก stack นี้ — สรุป

**3 vendors เท่านั้น (Vercel + Supabase + Resend)** — ลด ops solo dev มากที่สุด

### Vercel Pro
- Next.js native — ship เร็วที่สุด, Server Actions + ISR + Image Opt built-in
- `git push` → live ใน 30 วินาที
- 1 TB bandwidth + 1M function invocations free
- Vercel Cron built-in (ไม่ต้อง EventBridge)
- Singapore Edge POP — latency ดีสำหรับ TH

### Supabase Pro
- **Postgres + Storage + Realtime + Edge Functions ใน 1 vendor**
- Singapore region (~30ms BKK)
- 8 GB DB / 100 GB storage / 100 GB transfer = ครอบคลุม V1+V2
- **Open-source** — migrate ออกได้ตอน scale
- **Realtime subscriptions** = bonus สำหรับ Owner calendar live + Admin notification (V2)
- Storage = S3-compatible (ไม่ต้อง learn AWS S3 SDK)
- **Row Level Security** policies — extra layer of authorization (defense-in-depth)

### Supabase Auth (NOT Auth.js)
- ใช้ Supabase Auth เพราะ:
  - **Email OTP code (6 หลัก) native** — ลูกค้าตอบ q19 อยากได้ OTP
  - **Admin invite API** — `auth.admin.inviteUserByPhone()` ตรงกับ q18 (Admin pre-register only)
  - **Row Level Security (RLS)** integration → defense-in-depth security ฟรี
  - **Audit log + rate limiting** built-in — ตรงกับ q16 + brute-force protection
  - มาฟรีกับ Supabase Pro ($0 add-on)
  - Save ~15 hr V1 (Auth.js OTP + invite flow ต้อง custom)
- LINE Login เลื่อน V2 — ตอนนั้น implement custom OAuth ใน Supabase (~10 hr) หรือพิจารณา migrate
- **V1.5 LINE notification ไม่ต้อง LINE Login** — ใช้ **LIFF** สำหรับ link userId กับ Employee profile (employee onboarding)

### Resend
- DX ดีที่สุดในตลาด — react-email native templates
- Free 3K/month — V1 ใช้ ~400/month → ฟรียาว
- ถ้าโต > 3K → $20/month = 50K emails

### Inngest
- 50K runs/month free — V1 ใช้ < 10K/month
- Declarative TypeScript functions — ไม่ต้อง manage Redis/queue
- Retry, scheduled, throttle, fan-out built-in

---

## ทำไมเลือกแบบนี้ — เหตุผลทีละ layer

### 1. Next.js 15 (App Router) + TypeScript

**ทำไม:**
- **One repo, one framework** — solo dev ไม่ต้อง switch context FE/BE
- **Server Components + Server Actions** — ลด API boilerplate ~50% เมื่อเทียบกับ SPA + REST
- **Built-in routing, image opt, font opt, ISR** — พร้อมใช้
- **PWA support** — ทำ V2 mobile clock-in ได้ไม่ต้อง rewrite
- **Most popular React framework 2025/2026** — community ใหญ่สุด
- **Hire ทดแทน/expand ทีมง่าย** — Next.js dev หาในไทยเยอะ

**ไม่เลือก:**
- *Remix/RR7* — ดี แต่ community เล็กกว่า, RSC support ยังไม่นิ่ง
- *Pure SPA* — ต้อง maintain 2 codebases (FE + BE), เสียเวลา 30%+
- *Astro* — เหมาะ static-heavy, ไม่เหมาะ HR app ที่ interactive
- *NestJS* — heavyweight, boilerplate เยอะ, overkill สำหรับ scope V1

### 2. Tailwind CSS + shadcn/ui

**ทำไม:**
- **shadcn/ui = copy-paste components** ของ Radix UI primitives + Tailwind — control 100%, ไม่มี npm dep heavy
- **Customizable ให้ตรง brand Koolman** ได้
- **Dark mode + accessibility** built-in
- **Most-loved combo 2025/2026** — community เยอะ, examples เยอะ

**ไม่เลือก:**
- *MUI* — heavy bundle, override ยาก, ไม่ Tailwind-friendly
- *Chakra UI* — community declining ปี 2024+
- *Mantine* — ดี แต่ shadcn popular กว่า

### 3. PostgreSQL + Prisma

**ทำไม Postgres:**
- มาตรฐาน B2B SaaS, JSON/JSONB, full-text search, transaction-safe
- **Supabase Postgres** = managed → automated backup, point-in-time recovery, read replicas
- Scale up vertical (ขยาย instance) → read replica เมื่อต้อง
- **Open-source Postgres** — migrate ออกได้ตอน scale (vs Vercel Postgres ติด lock)

**ทำไม Prisma:**
- **Migration system foolproof** — Prisma Migrate ดูแล schema versioning อัตโนมัติ
- **TypeScript type generation** จาก schema → end-to-end type safety
- **Prisma Studio** = GUI ดู/แก้ DB ใน dev (มหัศจรรย์ตอน debug)
- **Community ใหญ่ที่สุด** สำหรับ TypeScript ORM
- **Easy to onboard** dev คนอื่น

**ไม่เลือก Drizzle:**
- เร็วกว่า + light กว่า แต่ tooling/migrations ยังไม่ mature เท่า Prisma
- Less hand-holding — เสียเวลา solo dev มากกว่า
- พิจารณา migrate ไป Drizzle ตอน V3 ถ้า perf issues (perf gain marginal สำหรับ scope นี้)

**ไม่เลือก:**
- *MySQL* — ดี แต่ Postgres > MySQL features สำหรับ HR (window functions, JSON, RANGE types ฯลฯ)
- *MongoDB* — ไม่เหมาะ relational data หนักของ HR (employee, payroll, attendance)
- *SQLite* — เล็กไป multi-branch + concurrent users

### 4. Supabase Auth

**ทำไม:**
- **Phone + Password** native via Supabase Phone Auth — ใช้เป็น primary identity (q19 updated)
- **Admin invite API** — `supabase.auth.admin.inviteUserByPhone(phone)` → ส่ง SMS พร้อม magic link — ตรงกับ q18 (Admin pre-register only)
- **Phone OTP via SMS** — ใช้สำหรับ password reset เท่านั้น (ไม่ใช่ทุก login). Provider: Thai SMS (ThaiBulkSMS / SMS Master) ราคา ~0.30–0.60 ฿/SMS
- **Email** = optional secondary — ส่ง slip PDF, รายงาน, notification (Resend ฟรีถึง 3K/เดือน)
- **Password reset flow** = phone → SMS OTP → set new password (Step 1+2 ใน /reset-password)
- **Row Level Security (RLS)** policies → JWT มี user_id ไหลไปถึง Postgres → enforce row access ที่ DB layer (defense-in-depth)
- **Brute-force rate limiting** built-in
- **Auth events audit log** — รวมใน q16 audit log requirement
- **Server-side helpers** — `@supabase/ssr` for Next.js App Router (cookie-based session)
- **TOTP MFA (Authenticator app)** — เผื่ออนาคต
- **มาฟรีกับ Supabase Pro** — ไม่ต้อง $$ extra
- Save ~15 hr V1 (vs Auth.js)

**ไม่เลือก:**
- *Auth.js v5* — flexible แต่ Email OTP ต้อง custom implement, Admin invite custom, save = 0; เลือกถ้าต้องการ LINE Login provider native (เลื่อน V2)
- *Lucia* — light + control แต่ต้อง DIY มาก, ทุก feature ต้อง implement เอง
- *Clerk* — DX ดีมาก แต่ paid ($25+/month start, แพงตอน scale) + ต้องเพิ่ม vendor ที่ 4

**Migration concern:**
- ผูกกับ Supabase auth schema (ตาราง `auth.users`)
- ถ้าวันนึง migrate ออก → dump `auth.users` + custom migration script → effort ปานกลาง
- LINE Login V2 → custom OAuth provider in Supabase (~10 hr) — อยู่ในงบ V2

**Schema linking:**
- `auth.users` (Supabase managed) ↔ `public.Employees.auth_user_id` (FK) ↔ ทุก table ของเรา
- Domain model (Employee, Branch, etc.) แยกจาก auth concern → portable

### 4a. LIFF (LINE Front-end Framework) — V1.5 only

**ใช้ทำอะไร:** Link `LINE userId` ของพนักงานกับ `Employee` profile → push notification ส่งได้

**ทำไม LIFF:**
- **UX 1 click** — Employee เปิดลิงก์จากหน้าโปรไฟล์ → LIFF SDK auto-return userId
- **No LINE Login flow** — LIFF runs ใน LINE in-app browser, identity already known
- **No OAuth dance** — ไม่ต้อง redirect/callback flow
- **ใช้ LINE Login channel** (technical infra) แต่ไม่ใช่ "login เข้าระบบ"

**Flow:**
1. Employee login เข้าระบบ HR (Supabase Auth ปกติ)
2. หน้า "Profile" → ปุ่ม "เชื่อม LINE สำหรับรับแจ้งเตือน"
3. คลิก → เปิด LIFF URL ใน LINE app
4. LIFF SDK init → return `userId` (silent ใน LINE app)
5. POST `/api/line/link` พร้อม userId + employee auth token
6. Server validate → save `lineUserId` ใน `Employees` table
7. ✅ Linked → push notification ส่งได้

**Setup:**
- LINE Developer Console → create LINE Login channel (จำเป็น แต่ใช้แค่ LIFF, ไม่ enable login)
- Add LIFF app → set endpoint URL `/connect-line`
- Configure scope `profile` (ได้ userId + display name)

**ไม่เลือก:**
- *Add-friend webhook + verify code* — ถูก dev แต่ UX 4–5 steps, employee copy-paste code
- *LINE Login OAuth* — ใช้เป็น auth method ของระบบเลย — V1.5 ไม่ทำ (เลื่อน V2 ถ้าต้องการ)

### 5. Inngest (background jobs)

**ทำไม:**
- **TypeScript-native, declarative** — เขียน job เป็น `inngest.createFunction(...)` แล้ว trigger ด้วย event
- **Free tier 50K runs/month** — V1 ใช้ < 10K/month → ฟรียาว
- **Retry, scheduled, throttle, fan-out built-in** — ไม่ต้อง implement queue/scheduler เอง
- **Dashboard UI** — debug + replay job ได้ใน browser
- **Vercel-friendly** — webhook trigger เข้า Vercel function

**Use case:** payroll calculation, email send, Excel parse async, audit log batch, monthly report gen

**ไม่เลือก:**
- *pg-boss* — ดี แต่ต้อง worker process แยก (Vercel function timeout 60s รัน worker ไม่ได้)
- *BullMQ + Redis* — ต้อง deploy Redis + management overhead
- *Trigger.dev* — คล้าย Inngest, ทั้งคู่ดี — เลือก Inngest เพราะ free tier dầu้กว่า + Vercel community ใช้เยอะ

### 6. Vercel Pro (hosting)

**ทำไม:**
- **Next.js native** — ทำโดย Vercel Inc. = best DX
- **Server Actions, ISR, Image Optimization** built-in ไม่ต้อง config
- **`git push` → live ใน 30 วินาที** — preview deploy ทุก PR
- **1 TB bandwidth + 1M function invocations free** — V1 ไม่เกิน
- **Edge POP Singapore** — latency BKK ~30ms
- **Vercel Cron built-in** — ไม่ต้อง EventBridge

**ราคา:** $20/month flat (1 seat) + free tier ครอบคลุม V1

**ไม่เลือก:**
- *AWS App Runner* — setup VPC + ECR + IAM ใช้เวลา 1–2 วัน, cold start 3–5s ถ้าไม่ pin instance
- *Cloudflare Pages + Workers* — Next.js support ยังจำกัด (no Image Opt full, edge runtime constraints)
- *Self-host EC2/VPS* — ops หนัก, security patch, ไม่ scale auto

### 7. Resend + react-email

**ทำไม Resend:**
- **DX ดีที่สุดในตลาด** — REST API ง่าย, react-email native
- **Free tier 3,000 emails/month** — V1 ใช้ ~400/month → ฟรียาว
- **Paid plan $20 = 50K emails** — ราคาคล้ายกัน SES พอเข้า scale
- **Domain verify ผ่าน DNS** — DKIM/SPF/DMARC auto guidance
- **Webhook events** (delivered, bounced, complained) — built-in
- ก่อตั้งโดยทีมเดียวกับ react-email — integration smooth

**ทำไม react-email:**
- เขียน email template เป็น **React component**
- `<Tailwind>` wrapper → email responsive
- Preview localhost ได้ + send test
- DX เดียวกับ UI ปกติ — ไม่ต้องเรียน Mjml/MJML

**ไม่เลือก:**
- *AWS SES* — ถูกกว่าเล็กน้อย ($0.10/1000) แต่ DX แย่กว่ามาก, setup verified domain + production access ใช้เวลา 1–3 วัน
- *Postmark* — premium deliverability แต่ $15/month start, ไม่มี free tier
- *SendGrid* — old-school, free tier 100/วัน เท่านั้น
- *Mailgun* — paid only

### 8. Supabase Storage

**ทำไม:**
- **S3-compatible API** — ใช้ AWS S3 SDK ได้ตรงๆ ถ้าจำเป็น migrate
- **มาพร้อม Supabase Pro** — ไม่ต้อง bill แยก ($0 add-on)
- **Built-in transformations** (image resize, format convert) — ดีสำหรับ avatar/logo
- **Row Level Security** ใช้ได้กับ storage policy — secure by default
- **Public/Private buckets** — fine-grained access
- **Pre-signed URLs** สำหรับ upload/download direct

**ขีดจำกัด:** Supabase Pro มี 100 GB storage included — V1 ใช้ ~5 GB → เกินยาก

**ไม่เลือก:**
- *AWS S3* — ดีและถูก แต่ต้อง config IAM + bucket policy + presign SDK เอง
- *Cloudflare R2* — ถูกที่สุด + no egress fees แต่เพิ่ม 1 vendor
- *Vercel Blob* — ใหม่, ไม่ mature, lock-in สูง

### 9. Vercel Edge Network (CDN — built-in)

**ทำไม:**
- **CDN built-in** ของ Vercel — ทุก static asset + ISR cache global
- **Image Optimization** — auto resize, WebP/AVIF, lazy load
- **Bandwidth 1 TB free** Pro — V1 ไม่เกิน
- ไม่ต้อง config CloudFront

### 10. Sentry (errors only — no CloudWatch)

**Sentry:** error tracking + performance — alert ผ่าน email/Slack ทันที, stack trace + breadcrumb + session replay

**Free tier:** 5K errors/month — V1 พอ

**Vercel Logs:** built-in logs UI สำหรับ application log + function execution

→ **ไม่ต้อง CloudWatch** — Vercel + Sentry ครอบคลุมแล้ว

### 11. GitHub Actions

**ทำไม:**
- มาตรฐาน 2025/2026
- Free 2,000 minutes/month (private repo) — V1 ไม่เกิน
- Workflow yaml ง่าย
- **Vercel auto-deploys ทุก push** — Actions เน้น test + lint + db migration

**Pipeline:**
1. PR open → run Vitest + Playwright + Biome lint
2. Merge to `main` → Prisma migrate deploy + Vercel auto-deploy production

### 12. Pino + Vercel Logs

**Pino:**
- Fast JSON logger (5–10× เร็วกว่า Winston)
- Output → stdout → Vercel ดูใน Dashboard logs
- Sentry breadcrumbs + tags integration

### 13. Vitest + Playwright

**Vitest:**
- Faster than Jest, Vite ecosystem
- TypeScript native
- Compatible Jest API

**Playwright:**
- E2E ตัว top สำหรับ 2025/2026 (Cypress ลดความนิยม)
- Multi-browser + mobile emulation
- Better than Cypress สำหรับ parallel + tracing

### 14. Biome (alternative to ESLint+Prettier)

**ทำไม:**
- เร็วกว่า ESLint+Prettier 30×
- Single config, single binary
- TypeScript native
- Solo dev → setup ง่ายกว่ามาก

**Trade-off:** plugin ecosystem เล็กกว่า ESLint — แต่ rules พื้นฐานครบ

ถ้าต้องการ ESLint plugin specific (เช่น `eslint-plugin-tailwindcss`) → fallback ESLint + Prettier ปกติ

### 15. next-intl (i18n)

**ทำไม V1:**
- Setup TH only ก่อน — แต่ structure พร้อม V2/V3 เพิ่ม EN
- **No rewrite cost** ตอน expand language
- App Router native + server components support

---

## Architecture Diagram (V1)

```
                  Users (Tue–Sun 9–18 BKK)
                          │
                          ▼
              ┌────────────────────────┐
              │   Vercel Edge (CDN)    │  ← Singapore POP
              └──────────┬─────────────┘
                         │
                ┌────────▼────────────┐
                │   Vercel Pro        │
                │   (Next.js 15 app)  │
                │   - Server Actions  │
                │   - Vercel Cron     │
                │   - Edge functions  │
                └────────┬────────────┘
                         │
        ┌────────────────┼─────────────────┬─────────────┐
        │                │                 │             │
        ▼                ▼                 ▼             ▼
┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐
│  Supabase    │  │  Inngest     │  │  Resend  │  │  Sentry  │
│  (SG region) │  │  (jobs)      │  │  (email) │  │  (errors)│
│  - Postgres  │  │  - payroll   │  │          │  │          │
│  - Storage   │  │  - email Q   │  │          │  │          │
│  - Realtime  │  │  - parse Excel│  │          │  │          │
│  - Auth      │  │  - reports   │  │          │  │          │
└──────────────┘  └──────────────┘  └──────────┘  └──────────┘

External APIs:
  - LINE Messaging API  ← V1.5 webhook + push
  - PEAK Account        ← CSV export (manual upload by customer)

Dev:
  - GitHub  ← repo + Actions (test/lint)
  - Local Postgres  ← Docker compose for dev
```

---

## Appendix A: Decision Rationale (archived)

> เก็บไว้เป็น reference — ตัดสินใจ Vercel + Supabase + Resend แล้ว

### A.1 Hosting: Vercel vs AWS App Runner (decision matrix archived)

| Factor | Vercel Pro | AWS App Runner | Winner |
|---|---|---|---|
| **Next.js DX** | Native (made by Vercel) — Server Actions, ISR, Image optimization auto | Container deploy — works but ~5–10% manual config | 🏆 Vercel |
| **Cold start** | < 100ms (Edge Runtime) / ~1s (Node) | 3–5s ถ้า scale-to-zero, 0s ถ้า min-instance=1 | 🏆 Vercel |
| **Setup time** | `git push` → live ใน 5 นาที | 1–2 วันแรก setup VPC + ECR + IAM + App Runner | 🏆 Vercel |
| **Long-running jobs** | ❌ function timeout 60s max (Pro) | ✅ background processes / pg-boss in-app OK | 🏆 AWS |
| **VPC / private networking** | ⚠️ ต้อง public RDS หรือ AWS PrivateLink ($30/month) | ✅ same VPC as RDS — เร็ว + ปลอดภัย | 🏆 AWS |
| **Region (Thailand)** | Edge POP กรุงเทพ — มี (Cloudflare-style routing) | Bangkok region native | tie |
| **Data residency** | Code runs in Singapore/Tokyo, data in AWS Bangkok | All in Bangkok | 🏆 AWS |
| **Pricing model** | Per-team-member ($20/seat) + bandwidth + functions | Per-resource (CPU/memory/storage) | depends |
| **Vendor lock** | High (Vercel-specific features) | Low (Docker container = portable) | 🏆 AWS |
| **Monitoring** | Built-in (Speed Insights, Logs) — $$$ extra | CloudWatch (basic) + Sentry external | tie |
| **Customer perception** | "ทำไมไม่ AWS อย่างที่ระบุ?" — ต้องอธิบาย | ตรงตามที่ระบุ | 🏆 AWS |

---

### Pricing comparison (V1 scope: 100 employees, ~50 concurrent users)

#### Option A — Vercel Pro + AWS for data

| Service | Monthly cost | Note |
|---|---|---|
| Vercel Pro | **$20** | 1 seat (solo dev), bandwidth 1 TB included |
| Vercel function executions | $0 | < 1M invocations free on Pro |
| Vercel image optimization | $0 | 5K free Pro |
| Inngest (background jobs) | **$0** | free tier 50K runs/month — V1 ใช้ < 10K/month |
| AWS RDS Postgres (db.t4g.micro, public) | **$15** | + $2 backup |
| AWS S3 (50 GB) | **$2** | |
| AWS SES (5K emails) | **$0.50** | |
| AWS Secrets Manager (5 secrets) | **$2** | minimal — most secrets in Vercel env |
| Domain (Cloudflare/Route 53) | **$1.25** | $15/year |
| Sentry (free tier) | **$0** | |
| **Total V1 baseline** | **~$41/month (~1,450 บาท)** | |

#### Option B — All AWS (App Runner + RDS + S3 + SES)

| Service | Monthly cost | Note |
|---|---|---|
| AWS App Runner (1 vCPU, 2 GB, min instance=1) | **$30** | always-on prevent cold start |
| AWS RDS Postgres (db.t4g.micro, private VPC) | **$15** | + $2 backup |
| AWS S3 (50 GB) | **$2** | |
| AWS CloudFront (50 GB egress) | **$4** | |
| AWS SES (5K emails) | **$0.50** | |
| AWS Secrets Manager (10 secrets) | **$4** | |
| AWS CloudWatch logs/metrics | **$5** | |
| AWS EventBridge | **$1** | |
| Domain | **$1.25** | |
| Sentry (free tier) | **$0** | |
| **Total V1 baseline** | **~$65/month (~2,300 บาท)** | |

#### Option C — Vercel + AWS (Bangkok DB) + private networking

If concern about RDS public exposure → add AWS PrivateLink:

| Service | Add-on cost |
|---|---|
| AWS PrivateLink endpoint | **+$30/month** |
| **Total Option A + PrivateLink** | **~$71/month** |

→ ถ้าต้อง private DB → AWS App Runner ถูกกว่า

---

### Cost over time

| Year 1 | Year 2 | Year 3 | 3-year total |
|---|---|---|---|
| **Option A (Vercel)** | $41 × 12 = $492 | $492 | $492 | **$1,476** |
| **Option B (AWS)** | $65 × 12 = $780 | $780 | $780 | **$2,340** |
| **Difference (savings A vs B)** | $288 | $288 | $288 | **$864 (~30K บาท)** |

→ **Option A ถูกกว่า ~30,000 บาท ใน 3 ปี** (ถ้า traffic อยู่ใน free tier)

### Scaling cost (เมื่อ Finnix ขยายไป tens of branches, 500+ emp)

| Metric | Threshold | Vercel | AWS |
|---|---|---|---|
| Bandwidth > 1 TB/month | จะถึงเมื่อ ~5,000+ emp ใช้ทุกวัน | $40/100 GB ส่วนเกิน | $4/100 GB CloudFront |
| Function invocations > 1M | ~1,000+ emp ใช้ทุกวัน | $0.40/M | covered in App Runner |
| Team members | seat × $20 | $20/extra seat | ฟรี |
| Background jobs > 50K | Inngest paid $20/month | covered in App Runner | |

→ **เมื่อ scale ใหญ่ Vercel แพงกว่า** — แต่ระดับ Finnix V1+V2 ยังอยู่ใน free tier

### Hidden costs / risks

**Vercel:**
- ⚠️ **Per-seat pricing** — ถ้าลูกค้าจ้าง dev เพิ่ม → +$20/seat/month
- ⚠️ **Bandwidth overage** — $40 per 100 GB > 1 TB
- ⚠️ **Function timeout 60s** — payroll batch 100 emp ต้องอยู่ใน 60s (น่าจะได้ — แต่ถ้าโต 1,000 emp อาจ split batch)
- ⚠️ **Image optimization quota** — 5K/month — ระวังถ้าใช้ logo/avatar เยอะ
- ✅ **No surprise bill** — มี alerts + spending limits
- ⚠️ **Long-running scheduled jobs** — Inngest free tier 50K runs/month, paid $20+ หลังจากนั้น

**AWS App Runner:**
- ⚠️ **Cold start ถ้า min-instance=0** — solve ด้วย min-instance=1 (+$15/month)
- ⚠️ **Setup complexity** — VPC, IAM, ECR push, App Runner config — ใช้เวลา 1–2 วัน
- ⚠️ **Container build time** — รอ build + deploy ~3–5 นาทีต่อครั้ง (vs Vercel 30 วินาที)
- ✅ **Predictable pricing** — fixed instance cost
- ✅ **No vendor-specific lock** — Docker container portable

---

### คำแนะนำสุดท้าย

**ในมุม solo dev + budget SME:** **Option A (Vercel + AWS for data)** ดีกว่าเล็กน้อย:

- ถูกกว่า ~30K THB ใน 3 ปี
- DX ดีกว่า → ship เร็วกว่า → ใช้เวลา dev น้อยลง 5–10%
- Setup time ลด 1–2 วัน
- Latency ใน BKK พอใช้ (Cloudflare-style edge)

**แต่ลูกค้าระบุ AWS** → ต้องคุยกับลูกค้าก่อน:
- ถาม: "วาง Next.js app ที่ Vercel (ของ Vercel Inc.) แต่ data ทุกอย่างอยู่ AWS Bangkok ที่ลูกค้าครอบครอง — รับได้ไหม?"
- เน้น: ข้อมูลพนักงาน/payroll/audit log ทั้งหมดอยู่ AWS Bangkok — เฉพาะ application code วิ่งบน Vercel infrastructure
- ถ้าลูกค้าไม่ OK → Option B (App Runner) ครบจบ AWS

### Decision recommendation

> **ถามลูกค้า (1 คำถาม):** "OK ไหมที่ Next.js app deploy ที่ Vercel (CDN + serverless ใกล้เคียง Cloudflare) โดย data ทั้งหมดอยู่ AWS Bangkok ของคุณ? ถูกกว่า ~30K THB / 3 ปี + ship เร็วกว่า"

- ถ้าลูกค้า OK → **Option A**
- ถ้าลูกค้าต้อง all-AWS strict → **Option B**

ทั้ง 2 options ใช้ tech stack เดียวกันที่เหลือ — แค่ host ต่างที่ → switch ได้ทีหลังถ้าต้อง

---

### A.2 Dev / Staging environment

| Environment | Setup | Cost |
|---|---|---|
| **Local dev** | Docker Postgres + local Next.js | $0 |
| **Staging / Preview** | Vercel preview deploys (auto per PR) + Supabase free tier (separate project) | $0 |
| **Production** | Vercel Pro + Supabase Pro (Singapore) | ~$46/mo |

---

## Project Structure (proposed)

```
koolman-hr/
├── .github/workflows/        # CI/CD
├── docs/                     # documentation (this folder)
├── prisma/
│   ├── schema.prisma         # source of truth schema
│   ├── migrations/
│   └── seed.ts               # default depts, holidays, leave types
├── public/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── (auth)/           # login, OTP, reset
│   │   ├── (employee)/       # employee-facing pages
│   │   ├── (admin)/          # admin back-office
│   │   ├── (owner)/          # owner read-only views
│   │   ├── api/              # API routes (webhooks, cron)
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/               # shadcn/ui primitives
│   │   └── feature/          # domain components
│   ├── lib/
│   │   ├── auth/             # auth config, session helpers
│   │   ├── db/               # prisma client + helpers
│   │   ├── email/            # SES + react-email templates
│   │   ├── line/             # LINE bot SDK wrapper (V1.5)
│   │   ├── s3/               # S3 helpers, presign
│   │   ├── jobs/             # pg-boss queue + workers
│   │   ├── pdf/              # @react-pdf templates (slip)
│   │   └── audit/            # audit log helpers
│   ├── server/
│   │   ├── actions/          # Server Actions (per domain)
│   │   ├── services/         # business logic (payroll calc, leave)
│   │   └── repositories/     # Prisma queries
│   └── styles/
├── tests/
│   ├── unit/
│   └── e2e/                  # Playwright
├── biome.json
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

**Pattern เลือกใช้:**
- **Domain-driven folders** — group ตาม feature (employees/, leave/, payroll/) ไม่ใช่ตาม technical type
- **Server Actions เป็น default** — REST API route เฉพาะ webhook (LINE, AWS) + cron
- **Repository pattern** — separate Prisma queries ออกจาก service logic → ทดสอบ unit ง่าย
- **Audit log = decorator/middleware** — ทุก mutation auto log → ไม่ต้องเขียนซ้ำ

---

## Migration Path (V1 → V2 → V3)

| Feature V2/V3 | ต้องเปลี่ยน infra ไหม | ต้องเขียน boilerplate? |
|---|---|---|
| LINE login (V2) | ⚠️ Supabase ต้อง custom OAuth provider (~10 hr) | medium |
| LIFF onboarding (V1.5) | ❌ — ใช้ LIFF SDK ใน /connect-line page | low |
| LINE notification | ❌ — ใช้ Inngest function เดียวกัน | ❌ minimal |
| SMS notification | ❌ — เพิ่ม provider (เช่น Twilio) | minimal |
| Multi-level RBAC | ❌ — ขยาย Supabase Auth user metadata + ตาราง AdminRoles + RLS policies | medium |
| Manager role + approval flow | ❌ — เพิ่ม table + state machine | medium |
| OT module | ❌ — เพิ่ม table + UI | medium |
| Tax PND.1 engine | ❌ — เพิ่ม service ใน server/services | high (กฎซับซ้อน) |
| Cash advance installment | ❌ — เพิ่ม table CashAdvanceInstallment | medium |
| **PWA mobile clock-in + GPS** | ⚠️ เพิ่ม service worker + IndexedDB cache | high |
| **Direct scanner API** | ⚠️ depends on scanner SDK | unknown |
| Provident Fund | ❌ — เพิ่ม table + calc | medium |
| Multi-language (TH+EN) | ❌ — next-intl ขยาย translations | low |
| **Realtime Owner calendar** | ❌ — Supabase Realtime ใช้ได้ทันที | low |
| **Scale to 1000+ users** | ⚠️ Vercel auto-scale OK; Supabase upgrade tier ($60/mo) | low |
| Mobile native app (V3) | ⚠️ เพิ่ม React Native + share API | high |
| **Migrate ออกจาก Supabase (worst case)** | ⚠️ Postgres dump + restore (ปกติ); Storage = S3 SDK compat | medium |

→ **เกือบทุก feature V2 = code-only change** (ไม่ต้อง re-architect)
→ Stack นี้ scalable + extensible ตามต้องการ

---

## Key Trade-offs (โปร่งใส)

### ✅ ข้อดี

1. **Solo dev productivity สูง** — Next.js + Supabase + Vercel = ship เร็วที่สุด, setup 2 ชม.
2. **Cost ต่ำ V1** — ~$46/month รวมทุกอย่าง
3. **Type safety end-to-end** — Prisma + Zod + Supabase types → ลด runtime bug ~70%
4. **Hire ทดแทน/expand ง่าย** — stack mainstream 2026
5. **Future-proof V2/V3** — Realtime + LINE login + multi-RBAC ไม่ต้อง re-architect
6. **Open-source escape hatch** — Supabase = OSS Postgres compat, migrate ออกได้ตอน scale

### ⚠️ ข้อจำกัด

1. **Vercel function timeout 60s** — payroll batch 100 emp ต้องอยู่ใน 60s. **Mitigate:** ใช้ Inngest async สำหรับ batch ใหญ่ (50+ emp)
2. **Supabase Singapore latency** — ~30ms BKK (vs 5ms ถ้า AWS BKK). **Mitigate:** acceptable สำหรับ HR app, real-time clock-in V2 ยัง snappy
3. **Inngest free tier 50K/month** — ถ้าโตเกิน → $20/month plan. V2 ใหญ่อาจ trigger
4. **3 vendors** — Vercel + Supabase + Resend separate billing. **Mitigate:** ทุก vendor มี dashboard + email alerts
5. **Solo dev = single point of failure** — ลูกค้ารับ MA จากเรา 1 ปี → handover plan ต้องเตรียม
6. **Vercel per-seat pricing** — ถ้าลูกค้าจ้าง dev เพิ่ม +$20/seat/month

---

## Decisions (confirmed + open)

1. ✅ **Region** — Singapore (Supabase + Vercel Edge POP)
2. ⏳ **Domain** — รอลูกค้าตัดสินใจ (suggestion: `finnixfilm.com` + subdomain `hr.finnixfilm.com` สำหรับระบบ)
3. ⏳ **Email sending domain** — รอ confirm ตอนได้ domain (Resend ต้อง DNS verify)
4. ✅ **Hosting** — **Vercel + Supabase + Resend** (locked 2026-05-06)
5. ✅ **Repo ownership** — **เราเป็น owner** (developer) → handover ตอน contract end / ตามที่ตกลง
6. **Branch protection + PR review** — solo dev ไม่ต้อง mandatory review, แต่ใส่ test gate ใน CI

---

## Onboarding Checklist (Day 0)

```
[ ] GitHub repo created (private, owned by dev)
[ ] Vercel team created + project linked to repo
[ ] Supabase project created (Singapore region)
[ ] Resend account + verified domain (รอ domain ลูกค้า)
[ ] Inngest account + project (free tier)
[ ] Sentry project created (free tier)
[ ] Domain registered (Cloudflare/Namecheap) — รอลูกค้าตัดสินใจ
[ ] Local dev: Node 24 LTS, pnpm 10, Docker (Supabase CLI local)
[ ] Customer email list (Admin + Owner)
[ ] Excel sample จากเครื่องสแกน 3 ไฟล์
[ ] LINE OA apply ส่ง (parallel — ใช้เวลา 1–2 สัปดาห์ — สำหรับ V1.5)
[ ] Initial Next.js scaffold + Prisma init + first migration
[ ] CI: GitHub Actions = test + lint + Prisma migrate deploy
[ ] Vercel auto-deploy `main` → production
```

---

## Alternatives Considered (รวบรัด)

| Layer | First choice | Considered | ทำไมไม่เลือก |
|---|---|---|---|
| Framework | **Next.js 15** | Remix, Nuxt, SvelteKit | Community + Vercel native + Supabase SSR helpers |
| ORM | **Prisma** | Drizzle, Kysely | Migration tooling + community |
| UI | **shadcn/ui** | MUI, Mantine, Chakra | Customizable + bundle-light |
| Auth | **Supabase Auth** | Auth.js, Lucia, Clerk | Phone+Password + SMS OTP reset + admin invite + RLS native (saves 15 hr) |
| DB + Storage | **Supabase Pro** | AWS RDS+S3, Neon+R2 | 1 vendor, less wiring, Realtime ready |
| Queue | **Inngest** | pg-boss, BullMQ+Redis | Vercel-friendly + free tier + DX |
| Email | **Resend** | AWS SES, Postmark, SendGrid | DX + react-email native + free 3K/month |
| Hosting | **Vercel Pro** | AWS App Runner, ECS Fargate, Cloudflare | Next.js native, fastest setup |
| Logging | **Pino** | Winston, Bunyan | Speed + JSON native |
| Testing | **Vitest + Playwright** | Jest + Cypress | Modern + faster |

---

## Reading List (สำหรับ ramp-up + lookup)

- **Next.js 15 App Router** — https://nextjs.org/docs
- **Prisma + Postgres** — https://www.prisma.io/docs/getting-started/quickstart
- **Supabase** — https://supabase.com/docs
- **Vercel + Next.js** — https://vercel.com/docs
- **Supabase Auth + SSR helpers** — https://supabase.com/docs/guides/auth/server-side/nextjs
- **LIFF (LINE Front-end Framework)** — https://developers.line.biz/en/docs/liff/
- **shadcn/ui** — https://ui.shadcn.com
- **react-email** — https://react.email
- **Resend** — https://resend.com/docs
- **Inngest** — https://www.inngest.com/docs
- **LINE Messaging API** (TH) — https://developers.line.biz/en/docs/messaging-api/

---

## Final Recommendation

**Stack: Vercel + Supabase (Auth + DB + Storage) + Resend + Next.js 15** ✅ Locked

**LINE V1.5:** Messaging API (push notification) + LIFF (employee onboarding link) — ไม่มี LINE Login

- ~$46/month V1
- Solo dev DX optimized
- 3 vendors only — manageable ops
- Future-proof V2/V3 (Realtime, LINE, multi-RBAC = code-only)

**Single biggest risk:** Vercel function timeout 60s — mitigate ด้วย Inngest async สำหรับ payroll batch

**Single biggest win:** Supabase Pro = Postgres + Storage + Realtime ใน 1 vendor → ลด setup time 1–2 วัน + dev time 10–15%
