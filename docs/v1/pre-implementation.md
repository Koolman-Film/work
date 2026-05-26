# Pre-Implementation Setup

ทำให้เสร็จ **ก่อน** เริ่ม code Phase 1 — รายการนี้ block W1.

> **เวลาประมาณรวม:** 4–6 ชั่วโมง (ทำได้ใน 1 วัน) + รอ DNS verify ~1 วัน

---

## ส่วนที่ 0 — Customer-side prep (block contract sign)

ลูกค้าต้องเตรียมก่อนเซ็นสัญญา Phase 1:

- [ ] รายชื่อ Admin คนแรก (ชื่อ + เบอร์มือถือ + email optional)
- [ ] Logo + brand color reference (ถ้ามี — ไม่มีก็ใช้ default)
- [ ] ชื่อบริษัท + ที่อยู่สำนักงาน (ใส่ใน slip + email footer)
- [ ] Branch list + ที่อยู่ (V1 = 1 branch ก็ได้)
- [ ] รายการ Leave types (ถ้าต่างจาก default 6: ป่วย/พักร้อน/กิจ/คลอด/บวช/อื่นๆ)
- [ ] Domain (optional — ใช้ `*.vercel.app` ก่อนก็ได้, ซื้อทีหลังได้)
- [ ] Contract signed + Phase 1 deposit (40K) จ่ายแล้ว

---

## ส่วนที่ 1 — Service accounts (Free tier)

### 1.1 GitHub
- [ ] Repo private สร้างใหม่ — name: `koolman-hr` (หรือชื่อที่ลูกค้าอยาก)
- [ ] Default branch: `main`
- [ ] Branch protection: require PR review + status checks ก่อน merge
- [ ] Add `.gitignore` Node template
- [ ] Add `LICENSE` file (proprietary หรือ ตามตกลงกับลูกค้า)
- [ ] เพิ่ม collaborator: ลูกค้า Admin (read-only access)

```bash
gh repo create koolman-hr --private --description "Koolman HR System"
gh repo edit koolman-hr --enable-issues --enable-projects=false
```

### 1.2 Vercel
- [ ] Sign up ที่ https://vercel.com (ใช้ GitHub OAuth)
- [ ] Plan: **Hobby (Free)** สำหรับ Phase 1 — 100 GB bandwidth/mo
- [ ] Connect Vercel to GitHub repo
- [ ] **อย่าเปิด auto-deploy preview** สำหรับ branches นอก main จนกว่าจะเริ่ม dev
- [ ] Note: Vercel Hobby technically not for commercial use — สำหรับ Phase 2+ ต้อง upgrade Pro ($20/mo)

### 1.3 Supabase
- [ ] Sign up ที่ https://supabase.com (ใช้ GitHub OAuth)
- [ ] Create project: name `koolman-hr`
- [ ] **Region: Singapore (`ap-southeast-1`)** — สำคัญ สำหรับ latency จากลูกค้าไทย
- [ ] Plan: **Free tier** — 500 MB DB, 1 GB storage
- [ ] Database password: generate strong + save ใน password manager
- [ ] Note: Free tier auto-pauses หลัง 7 days idle — ใช้ cron-ping (ดูข้อ 5.2)
- [ ] Copy 4 env vars เก็บไว้:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `DATABASE_URL` (pooler) + `DIRECT_URL` (for migrations)

### 1.4 Resend (Email)
- [ ] Sign up ที่ https://resend.com (ใช้ GitHub OAuth)
- [ ] Plan: **Free tier** — 3,000 emails/month
- [ ] **Domain verification** — ต้องเริ่มเร็วเพราะรอ DNS ~24 ชั่วโมง
  - ถ้าลูกค้ามี domain: ใช้ subdomain เช่น `mail.koolman.co`
  - ถ้ายังไม่มี: ใช้ Resend's default `onboarding@resend.dev` (ระบุชื่อ "Koolman HR" เป็น from name)
- [ ] Copy `RESEND_API_KEY`

### 1.5 Sentry (Error tracking)
- [ ] Sign up ที่ https://sentry.io
- [ ] Plan: **Developer (Free)** — 5K errors/month
- [ ] Create project: Next.js
- [ ] Copy `SENTRY_DSN`
- [ ] Note: setup SDK ตอน Phase 1.1 ไม่ใช่ตอนนี้

### 1.6 Inngest (Background jobs)
- [ ] Sign up ที่ https://inngest.com
- [ ] Plan: **Free tier** — 50K function runs/month
- [ ] Create app: `koolman-hr`
- [ ] Copy `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY`

### 1.7 SMS provider — ThaiBulkSMS (required Phase 1)

> **Update 2026-05:** Phase 1 ใช้ phone + password login + SMS OTP สำหรับ reset password + welcome SMS ตอน admin add พนักงาน.

#### Setup steps (~30 min + 3-5 day wait for sender ID)

- [ ] Sign up ที่ https://thaibulksms.com (corporate account)
- [ ] อัปโหลดเอกสารบริษัท (สำเนาทะเบียนบริษัท, ทะเบียน VAT) — required for sender ID approval
- [ ] **Sender ID registration** — submit "KoolmanHR" (หรือชื่อที่ลูกค้าอยาก) — รอ 3-5 วันทำการ
- [ ] **Initial credit:** เติม 1,000 ฿ (= ~2,000 SMS @ 0.50 ฿) — เพียงพอสำหรับ Phase 1 ทดสอบ + 6 เดือนแรก
- [ ] Get `THAIBULKSMS_API_KEY` + `THAIBULKSMS_API_SECRET`
- [ ] เพิ่ม env vars ใน Vercel + .env.local

#### Volume forecast Phase 1 (per customer)

| Use case | SMS/mo | Cost @ 0.50 ฿ |
|---|---|---|
| Welcome SMS (admin add new emp) | ~5-10 | 2.5-5 ฿ |
| Reset password OTP | ~5-15 | 2.5-7.5 ฿ |
| **Total** | **~15-25/mo** | **~10-15 ฿/mo** |

ค่าใช้จ่าย SMS เล็กน้อยมาก. 1,000 ฿ initial credit = ใช้ได้ ~6 เดือน.

#### Why ThaiBulkSMS (not Twilio)

- ราคาถูกกว่า Twilio 50% (0.50 vs 1.00 ฿/SMS)
- รองรับ +66 เบอร์ไทยเท่านั้น (เหมาะกับลูกค้าไทย 100%)
- API ง่าย · Thai-language docs
- Sender ID + DLR support
- เก็บ credit prepaid · ไม่มี subscription

#### Fallback strategy

- ถ้า ThaiBulkSMS API ล่ม → log error + admin-reset แทน (ใช้ `adminResetPassword(employeeId)`)
- พนักงานที่เป็นแรงงานต่างชาติ (เบอร์ +95/+855) → เปลี่ยนเป็น email reset (ตั้งใน Settings → Foreign workers)

#### Alternative providers (backup choice)

- **SMS Master** — https://smsmaster.co.th — ราคาใกล้เคียง · backup ถ้า ThaiBulkSMS มีปัญหา
- **Twilio** — https://twilio.com — global, แพงกว่า แต่ DX ดี + sandbox testing free

---

## ส่วนที่ 2 — Domain + DNS (optional Phase 1, required Phase 2)

### 2.1 ถ้าลูกค้ามี domain แล้ว
- [ ] ขอเข้าถึง DNS panel (Cloudflare / GoDaddy / Namecheap)
- [ ] เพิ่ม CNAME: `app.<domain>` → `cname.vercel-dns.com` (สำหรับ app)
- [ ] เพิ่ม TXT records ตามที่ Resend แจ้ง (สำหรับ email domain)
- [ ] รอ propagation ~5–60 นาที

### 2.2 ถ้ายังไม่มี domain
- [ ] **Phase 1**: ใช้ `koolman-hr.vercel.app` ฟรีไปก่อน
- [ ] **Phase 2 ก่อนเริ่ม**: ลูกค้าซื้อ domain (~600 ฿/ปี ที่ Cloudflare หรือ Namecheap)
- [ ] Recommend: `.co.th` ถ้าจดทะเบียนบริษัทไทย, `.com` ถ้าใช้ทั่วไป

### 2.3 Domain registrars ที่แนะนำ
- **Cloudflare Registrar** — ราคา wholesale, DNS รวด, ใช้ง่าย
- **Namecheap** — ถูก, support OK
- **Z.com (GMO)** — ไทย, support ภาษาไทย, แพงกว่าหน่อย

---

## ส่วนที่ 3 — Local dev environment

### 3.1 Required tools
- [ ] **Node.js 24 LTS** — `nvm install 24 && nvm use 24`
- [ ] **pnpm 10** — `npm install -g pnpm@10`
- [ ] **Docker Desktop** — สำหรับ Supabase local CLI
- [ ] **Supabase CLI** — `brew install supabase/tap/supabase`
- [ ] **Vercel CLI** — `pnpm add -g vercel`
- [ ] **GitHub CLI** — `brew install gh`
- [ ] Git config name + email

### 3.2 Editor
- [ ] **Cursor** (recommend สำหรับ AI-heavy dev) — https://cursor.com
- [ ] หรือ VS Code + extensions: Tailwind CSS IntelliSense, Prisma, Biome
- [ ] Settings: format on save, lint on save

### 3.3 Browser dev
- [ ] **Chrome** + React DevTools + Lighthouse extensions
- [ ] **Mobile testing**: ใช้ Chrome DevTools device mode + iPhone จริงสำหรับ Safari

---

## ส่วนที่ 4 — Repo + CI/CD

### 4.1 Repo initial commit (ทำตอน Phase 1.1 จริงๆ — แค่เตรียมแผน)
- [ ] `pnpm create next-app koolman-hr --typescript --tailwind --eslint --app`
- [ ] Init Prisma: `pnpm dlx prisma init`
- [ ] Init shadcn: `pnpm dlx shadcn@latest init`
- [ ] First commit + push

### 4.2 GitHub Actions workflows
สร้าง 2 workflows:

**`.github/workflows/ci.yml`** — runs on every PR:
- Install pnpm + Node 24
- `pnpm install --frozen-lockfile`
- `pnpm biome check`
- `pnpm prisma validate`
- `pnpm typecheck`
- `pnpm test` (เพิ่มภายหลัง)

**`.github/workflows/deploy.yml`** — runs on push to main:
- Run migrations: `pnpm prisma migrate deploy`
- Vercel auto-deploys (ผ่าน GitHub integration ที่ตั้งใน 1.2)

**`.github/workflows/cron-ping.yml`** — keep Supabase free tier alive:
- Schedule: every 6 days
- `curl` ไปที่ `/api/health` endpoint

### 4.3 Branch protection rules
- [ ] `main` branch: require PR review + CI pass
- [ ] No direct push to main
- [ ] Auto-delete head branches after merge

### 4.4 Vercel env vars
สร้างใน Vercel dashboard → Project → Settings → Environment Variables:

**Production:**
- `DATABASE_URL` (pooler)
- `DIRECT_URL` (migration)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `THAIBULKSMS_API_KEY`
- `THAIBULKSMS_API_SECRET`
- `THAIBULKSMS_SENDER_ID` (e.g., "KoolmanHR")
- `SENTRY_DSN`
- `SENTRY_AUTH_TOKEN` (สำหรับ source maps upload)
- `NEXTAUTH_SECRET` หรือ JWT secret (ถ้าใช้ custom token issuance)

**Preview:** เหมือน production แต่ใช้ Supabase staging project (Phase 2+ ค่อยแยก, Phase 1 ใช้ project เดียวกันได้)

---

## ส่วนที่ 5 — AI tooling (developer-side, your cost)

### 5.1 Claude (recommend)
- [ ] **Claude Max** subscription — $200/mo สำหรับ heavy use
- [ ] หรือ **Claude Pro** $20/mo สำหรับ light use + API key สำหรับ Cursor
- [ ] API key สำหรับ Cursor agent mode

### 5.2 Cursor (recommend)
- [ ] **Cursor Pro** — $20/mo (มี Claude built-in)
- [ ] Settings: agent mode + auto-apply edits ON
- [ ] `.cursorrules` ในโปรเจกต์: ระบุ stack, conventions, do-not-do list

### 5.3 GitHub Copilot (alternative/supplement)
- [ ] **Copilot Pro** — $10/mo (optional, ใช้ร่วมกับ Cursor ได้)

### 5.4 Tooling cost summary
| Tool | Cost/mo | Required for Phase 1? |
|---|---|---|
| Claude Max | $200 | ✅ ใช้หนัก |
| Cursor Pro | $20 | ✅ |
| Copilot | $10 | ❌ optional |
| **Total** | **~$220 (~7,900 ฿/เดือน)** | ตลอดช่วง dev |

---

## ส่วนที่ 6 — Verification before W1

ก่อนเริ่มเขียน code Phase 1.1, verify ทุกอย่างด้านล่าง:

### 6.1 Account access ✓
- [ ] GitHub repo สร้างแล้ว สามารถ push ได้
- [ ] Vercel project linked กับ repo
- [ ] Supabase project Singapore region สร้างแล้ว
- [ ] Resend account สร้างแล้ว, domain verify ดำเนินการแล้ว (รอ DNS)
- [ ] Sentry project สร้างแล้ว
- [ ] Inngest app สร้างแล้ว
- [ ] **ThaiBulkSMS account สร้างแล้ว · sender ID submit แล้ว (รอ approval 3-5 วัน) · เติม credit 1,000 ฿**

### 6.2 Local environment ✓
- [ ] `node --version` → v24.x
- [ ] `pnpm --version` → 10.x
- [ ] `supabase --version` works
- [ ] `vercel --version` works
- [ ] `gh auth status` shows logged in
- [ ] Cursor/VS Code with TS extensions

### 6.3 Customer dependencies ✓
- [ ] Contract signed
- [ ] Phase 1 deposit 30K received
- [ ] Admin contact info ได้ (เบอร์ + email)
- [ ] Logo + brand color ได้ (หรือใช้ default)
- [ ] Branch + Department list ได้

### 6.4 Smoke test ✓
- [ ] Vercel deploy hello-world Next.js → live URL works
- [ ] Supabase: connect via `psql $DATABASE_URL`, run `SELECT 1;`
- [ ] Resend: send test email to your inbox via API
- [ ] **ThaiBulkSMS: send test SMS to your phone via API**
- [ ] Sentry: trigger test error via SDK → appears in dashboard
- [ ] GitHub Actions: push trivial commit → CI runs green

---

## ส่วนที่ 7 — Phase-specific prep

### Phase 2 ก่อนเริ่ม (รอจบ Phase 1)
- [ ] **Upgrade Vercel to Pro** ($20/mo) — commercial license + better resources
- [ ] **Upgrade Supabase to Pro** ($25/mo) — daily backups + no auto-pause + 8 GB DB
- [ ] PEAK CSV format sample จากลูกค้า/accountant
- [ ] PayrollConfig values: SSO rate (5%), OT rate (1.5x), late threshold (15 min), monthly cycle (1-31)
- [ ] 2 เดือนล่าสุดของ payroll ที่คำนวณด้วยมือ (สำหรับ shadow comparison)
- [ ] Custom domain (ถ้ายังไม่มี) — ลูกค้าซื้อ + DNS access

### Phase 3 ก่อนเริ่ม
- [ ] Excel sample จากเครื่องสแกน fingerprint — 3-5 ไฟล์ตัวจริง
- [ ] PEAK Account credentials หรือ accountant contact
- [ ] Owner contact info (email + login)

### Phase 4 ก่อนเริ่ม (~2 wk lead time)
- [ ] LINE OA registration submitted (ขั้นตอน LINE Business ID verify)
- [ ] LINE Developer console: create Provider + Messaging API channel + Login channel
- [ ] LIFF app config under Login channel
- [ ] LINE OA verified status (รอ ~1-2 wk)
- [ ] LINE OA branding: profile pic + welcome message + tagline

---

## Quick checklist (TL;DR)

### ก่อนเริ่ม Phase 1 ต้องมี
- ✅ Contract signed + 30K deposit
- ✅ GitHub repo + Vercel + Supabase + Resend + Sentry + Inngest accounts
- ✅ **ThaiBulkSMS account + sender ID submitted (รอ approval ~5 วัน — ทำตั้งแต่วันแรก)**
- ✅ Local dev tools (Node 24, pnpm 10, Supabase CLI, Cursor)
- ✅ AI tooling subscription (Claude Max + Cursor Pro)
- ✅ DNS records (ถ้าลูกค้ามี domain) submitted สำหรับ Resend verify
- ✅ Customer info: Admin contact + branch list + leave types

### เวลารวมที่ต้องทำเอง
- Service signups: ~2 hr (รวม ThaiBulkSMS docs upload)
- Local env: ~1 hr
- Customer info gathering: ~1 hr
- Domain + DNS: ~30 min + 24 hr wait
- Smoke tests: ~1 hr
- **Total: ~5-7 hr active work + 1 day DNS wait + 3-5 days SMS sender ID approval (parallel)**

### สิ่งที่ห้ามลืม
- ❌ อย่าเริ่ม code ก่อน Resend domain verify เสร็จ (block email testing)
- ❌ **อย่าเริ่ม code ก่อน ThaiBulkSMS sender ID approval (block SMS testing)** — submit ตั้งแต่ Day 1
- ❌ อย่าใช้ Vercel Hobby tier สำหรับ commercial production (Phase 2+ ต้อง Pro)
- ❌ อย่าใช้ Supabase Free สำหรับ critical data (no daily backups) — Phase 2+ ต้อง Pro
- ❌ อย่าลืม cron-ping สำหรับ Supabase Free (auto-pause 7 days)
- ❌ อย่า commit env vars ลง git — ใช้ `.env.local` + `.gitignore`
- ❌ อย่าใส่ `SERVICE_ROLE_KEY` ใน client bundle (server-only!)
- ❌ อย่าลืม monitor SMS credit — เติมก่อนหมด (ตั้ง alert ที่ 200 ฿ remaining)

---

## Cost summary (one-time + recurring)

### One-time (ก่อน Phase 1)
- Domain registration (optional): 600 ฿/ปี
- Total: **0–600 ฿**

### Recurring (Phase 1, free tier)
- Vercel Hobby: $0
- Supabase Free: $0
- Resend Free: $0
- Sentry Developer: $0
- Inngest Free: $0
- Domain renewal (yearly): ~600 ฿
- **ThaiBulkSMS prepaid:** ~10-25 ฿/mo (depending on volume)
- **Customer total: ~60-75 ฿/เดือน (or ~10-25 ฿ ถ้าใช้ vercel.app)**

### Recurring (Phase 2 onwards, Pro tier required)
- Vercel Pro: $20/mo
- Supabase Pro: $25/mo
- Resend (free still OK ถ้า ≤ 3K/mo)
- ThaiBulkSMS: ~50-150 ฿/mo (volume up at Phase 2+ with more SMS use cases)
- **Customer total: ~$45/mo + 50-150 ฿ = ~1,650-1,750 ฿/mo**

### Your tooling (during dev)
- Claude Max: $200/mo
- Cursor Pro: $20/mo
- **Your cost: ~$220/mo (~7,900 ฿/mo) ตลอดช่วง dev**

---

## ลิงก์เร่งด่วน

- Vercel: https://vercel.com/signup
- Supabase: https://supabase.com/dashboard
- Resend: https://resend.com/signup
- Sentry: https://sentry.io/signup
- Inngest: https://inngest.com
- ThaiBulkSMS: https://thaibulksms.com (Phase 2+ ถ้าต้องใช้)
- LINE Developers: https://developers.line.biz (Phase 4)
- LINE Business: https://www.linebiz.com/th/ (Phase 4)
- Claude: https://claude.ai/upgrade
- Cursor: https://cursor.com
