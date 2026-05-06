# V1 Development Environment

ตั้งค่า local dev ที่ mirror production structure + workflow ระหว่าง 3 environments

---

## 1. Three-tier environment

| Tier | Purpose | Supabase | Vercel | Email | Inngest |
|---|---|---|---|---|---|
| **Local** (dev machine) | Fast iteration, offline-capable | Supabase CLI Docker (localhost) | `next dev` localhost | Mailpit Docker | Inngest CLI dev server |
| **Preview** (per-PR + staging) | Test before merge, customer UAT | Supabase cloud "staging" project | Vercel preview deploys | Resend test mode | Inngest preview env |
| **Production** | Live for Koolman | Supabase cloud "production" project | Vercel production | Resend live | Inngest live |

**Strategy:**
- All 3 tiers ใช้ **same Postgres schema, same code, same Tailwind theme**
- ต่างที่: env vars + data + monitoring threshold

---

## 2. Required tools (local machine)

```bash
# Node + pnpm
brew install node@24 pnpm                 # macOS
# or use volta / nvm
node --version    # v24.x
pnpm --version    # 10.x

# Docker (for Supabase + Mailpit local)
brew install docker
brew install --cask docker                # Docker Desktop

# Supabase CLI
brew install supabase/tap/supabase

# Inngest CLI
pnpm dlx inngest-cli@latest --version
# (or installed globally via brew)
brew install inngest

# Optional but recommended
brew install gh                            # GitHub CLI
brew install jq                            # JSON tool
brew install httpie                        # nicer curl
```

---

## 3. Initial repo setup (Day 0)

```bash
# Clone
git clone git@github.com:<dev>/koolman-hr.git
cd koolman-hr
pnpm install

# Set up env files
cp .env.example .env.local

# Start local Supabase
supabase init                              # first time only
supabase start

# This boots Postgres + Auth + Storage + Studio + Edge Functions in Docker
# Output gives you:
#   API URL: http://127.0.0.1:54321
#   DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
#   Studio URL: http://127.0.0.1:54323
#   Inbucket (email): http://127.0.0.1:54324
#   anon key: eyJhbGc...
#   service_role key: eyJhbGc...

# Update .env.local with the values above

# Run Prisma migrations
pnpm db:migrate                            # creates schema in local DB
pnpm db:seed                               # seed depts, holidays, leave types

# Start Inngest dev server (in separate terminal)
pnpm inngest:dev                           # alias for: npx inngest-cli@latest dev

# Start Next.js
pnpm dev
# → http://localhost:3000
```

---

## 4. Project file layout (env-aware)

```
koolman-hr/
├── .env.example          # template — committed
├── .env.local            # local dev secrets — gitignored
├── .env.test             # test env for Vitest/Playwright — gitignored
├── supabase/
│   ├── config.toml       # Supabase CLI config
│   ├── migrations/       # SQL migrations (RLS, triggers — for Supabase project)
│   ├── seed.sql          # raw SQL seed (alternative to Prisma)
│   └── functions/        # Supabase Edge Functions (V2 if needed)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/       # Prisma migrations (data model)
│   └── seed.ts           # TypeScript seed
├── docker-compose.yml    # optional: Mailpit standalone
├── scripts/
│   ├── reset-db.sh
│   ├── seed-demo.sh      # demo data for client showcase
│   └── ...
└── ...
```

---

## 5. Environment variables schema

### `.env.example` (committed template)

```bash
# === Supabase ===
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server-only, never expose

# === Database (Prisma) ===
DATABASE_URL=                       # pooled connection (pgbouncer for prod)
DIRECT_URL=                         # direct connection for migrations

# === Resend ===
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@finnixfilm.com
RESEND_REPLY_TO=hr@finnixfilm.com

# === Inngest ===
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=                # production only

# === Sentry ===
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=                  # for source maps upload

# === App ===
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
LOG_LEVEL=debug

# === Cron ===
CRON_SECRET=                        # to verify Vercel cron requests

# === LINE (V1.5) ===
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LIFF_ID=
```

### `.env.local` (local dev — gitignored)

```bash
# Supabase local (from `supabase start` output)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Local Postgres (Supabase CLI)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Resend test mode (use sandbox API key)
RESEND_API_KEY=re_test_xxx
# Or use local Mailpit (alternative)
# RESEND_API_KEY=         # leave empty
# SMTP_HOST=localhost
# SMTP_PORT=1025

# Inngest local
INNGEST_EVENT_KEY=
INNGEST_BASE_URL=http://localhost:8288

NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
LOG_LEVEL=debug
CRON_SECRET=local-secret
```

### Vercel Preview env

Set in Vercel Dashboard → Project → Settings → Environment Variables → "Preview"

```bash
NEXT_PUBLIC_SUPABASE_URL=https://staging-project.supabase.co
DATABASE_URL=postgresql://...?pgbouncer=true&connection_limit=1
RESEND_API_KEY=re_test_xxx          # test mode
NEXT_PUBLIC_APP_URL=https://hr-staging.finnixfilm.com
LOG_LEVEL=info
```

### Vercel Production env

```bash
NEXT_PUBLIC_SUPABASE_URL=https://prod-project.supabase.co
DATABASE_URL=postgresql://...?pgbouncer=true&connection_limit=1
RESEND_API_KEY=re_live_xxx
NEXT_PUBLIC_APP_URL=https://hr.finnixfilm.com
LOG_LEVEL=info
INNGEST_SIGNING_KEY=...             # required prod
```

---

## 6. Supabase CLI commands (daily)

```bash
# Boot local Supabase
supabase start                     # starts Docker stack

# Stop
supabase stop                      # preserves data
supabase stop --no-backup          # nukes data

# Status / URLs
supabase status                    # show all local URLs

# DB tools
supabase db reset                  # nuke + re-run migrations + seed
supabase db diff                   # show pending changes
supabase db dump > backup.sql      # export

# Studio (visual DB browser)
open http://127.0.0.1:54323

# Email testing (Inbucket — built-in)
open http://127.0.0.1:54324        # see all emails sent locally

# Test auth
curl -X POST 'http://127.0.0.1:54321/auth/v1/signup' \
  -H 'apikey: <anon-key>' \
  -d '{"email":"test@test.com","password":"password123"}'
```

---

## 7. Prisma + Supabase migration workflow

### Two migration paths — coordinate carefully

**Prisma** = data model schema (CRUD tables)
**Supabase migrations** = RLS policies, triggers, custom SQL functions

### Workflow:

```bash
# 1. Edit prisma/schema.prisma → add field/table
# 2. Generate migration:
pnpm db:migrate
# → prompts for migration name → creates SQL in prisma/migrations/<timestamp>/
# → auto-applies to local DB
# → regenerates Prisma Client

# 3. If need RLS / triggers / extensions:
supabase migration new add_rls_employees
# → creates supabase/migrations/<timestamp>_add_rls_employees.sql
# → write your SQL (RLS policies, triggers)
# → apply locally:
supabase db reset                  # nuclear option
# OR
psql $DATABASE_URL -f supabase/migrations/<file>.sql

# 4. Test locally
pnpm dev
# → verify behavior

# 5. Commit:
git add prisma/migrations/ supabase/migrations/ prisma/schema.prisma
git commit -m "feat: add profile.line_user_id"

# 6. Push → Vercel preview deploy auto
# 7. Migration runs in CI:
#    - GitHub Actions: pnpm db:deploy (Prisma migrate deploy)
#    - GitHub Actions: supabase db push (for Supabase migrations)

# 8. Merge to main → production migrate auto via CI
```

### CI workflow (`.github/workflows/db-migrate.yml`):

```yaml
name: DB migrate
on:
  push:
    branches: [main]
    paths:
      - 'prisma/migrations/**'
      - 'supabase/migrations/**'
jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL_PROD }}
          DIRECT_URL: ${{ secrets.DIRECT_URL_PROD }}
      - uses: supabase/setup-cli@v1
      - run: supabase db push --db-url ${{ secrets.DIRECT_URL_PROD }}
```

---

## 8. Seeding strategy

### `prisma/seed.ts` — Prisma-managed seed

```ts
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Departments seed (Koolman 7 departments)
  await prisma.departments.createMany({
    data: [
      { name: 'Sales / Front Desk' },
      { name: 'Installation' },
      { name: 'Service & Detailing' },
      { name: 'Warehouse / Inventory' },
      { name: 'Accounting / Admin' },
      { name: 'Marketing' },
      { name: 'Management' },
    ],
    skipDuplicates: true,
  });

  // Branches (placeholder — customer to provide actual list)
  await prisma.branches.upsert({
    where: { id: 'main' },
    update: {},
    create: { id: 'main', name: 'สำนักงานใหญ่', address: 'TBD', isActive: true },
  });

  // Holidays — Thai national 2026
  await prisma.holidays.createMany({
    data: [
      { date: new Date('2026-01-01'), name: 'วันขึ้นปีใหม่', type: 'national', workPayMultiplier: 2.0 },
      { date: new Date('2026-04-13'), name: 'วันสงกรานต์', type: 'national', workPayMultiplier: 2.0 },
      // ... full list
    ],
    skipDuplicates: true,
  });

  // LeaveTypes
  await prisma.leaveTypes.createMany({
    data: [
      { name: 'ลาป่วย', defaultQuota: 30, isPaid: true, requiresDoc: true, docAfterDays: 3, resetPolicy: 'year-end' },
      { name: 'ลากิจ', defaultQuota: 3, isPaid: true, resetPolicy: 'year-end' },
      // ...
    ],
    skipDuplicates: true,
  });

  // PayrollConfig
  await prisma.payrollConfig.createMany({
    data: [
      { key: 'social_security_rate', value: { rate: 0.05 } },
      { key: 'social_security_cap', value: { amount: 750 } },
      { key: 'attendance_deduct_formula', value: { formula: 'BaseSalary / 30' } },
      // ...
    ],
    skipDuplicates: true,
  });

  console.log('✅ Seeded base data');
}

main().finally(() => prisma.$disconnect());
```

### Demo seed (for showcase only)

```bash
# scripts/seed-demo.sh
pnpm tsx scripts/seed-demo-employees.ts   # 10 fake employees + leave/advance requests
```

---

## 9. Email testing

### Option 1: Supabase Inbucket (built-in local)

Supabase CLI ships with Inbucket — a fake SMTP catcher. Auth emails (OTP, invite) automatically go there.

```bash
open http://127.0.0.1:54324
# View all emails Supabase sent (OTP, invite, password reset)
```

### Option 2: Mailpit (for Resend dev testing)

Add to `docker-compose.yml`:
```yaml
services:
  mailpit:
    image: axllent/mailpit
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # web UI
```

Configure `.env.local`:
```bash
SMTP_HOST=localhost
SMTP_PORT=1025
```

In `src/lib/email/client.ts`, switch based on env:
```ts
export const emailClient = process.env.NODE_ENV === 'development'
  ? createTransport({ host: 'localhost', port: 1025 })  // Mailpit
  : new Resend(process.env.RESEND_API_KEY);
```

→ View emails at http://localhost:8025

### Option 3: Resend test mode (cloud-connected)

Get a sandbox API key from Resend dashboard. All emails go to your Resend inbox view, never delivered to actual users.

```bash
RESEND_API_KEY=re_test_xxx
```

**Recommended:** Inbucket (Supabase auto) for OTP, Mailpit for transactional (Resend templates), test mode for staging.

---

## 10. Inngest local dev server

```bash
# Install once
pnpm add inngest

# Run dev server (separate terminal)
pnpm dlx inngest-cli@latest dev
# → http://localhost:8288 — Inngest dashboard UI

# In Next.js: register Inngest endpoint
# src/app/api/inngest/route.ts
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { fns } from '@/lib/inngest/functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: fns,
});
```

When dev server is running:
- Inngest auto-syncs your functions
- Trigger events via dashboard or `inngest.send()`
- See full event log + replay
- Test scheduled jobs by manually triggering

---

## 11. Vercel local dev (cron testing)

Vercel Cron can be triggered locally:

```bash
# Trigger cron endpoint manually
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/monthly-payroll
```

Or use Vercel CLI:
```bash
pnpm dlx vercel dev
# Runs Vercel-style locally — closer to prod
```

---

## 12. LINE local testing (V1.5 prep)

When V1.5 starts:
- LIFF: only works inside LINE app — test on real device or LINE simulator
- Webhook: use **ngrok** to expose localhost to LINE Messaging API

```bash
brew install ngrok
ngrok http 3000
# → https://xxxx.ngrok.io
# Set as webhook URL in LINE Developer Console
```

---

## 13. Daily dev workflow

```bash
# Morning startup (3 commands)
supabase start
pnpm dlx inngest-cli@latest dev &      # background
pnpm dev                                # foreground

# Evening shutdown
# Ctrl-C pnpm dev
# Ctrl-C inngest
supabase stop
```

### Common tasks

```bash
pnpm db:migrate                # new schema change
pnpm db:reset                  # nuke + reseed
pnpm db:studio                 # Prisma Studio (alt: supabase studio)
pnpm test                      # Vitest
pnpm test:e2e                  # Playwright
pnpm lint                      # Biome
pnpm format                    # Biome write
```

### `package.json` scripts

```json
{
  "scripts": {
    "dev": "next dev --turbo",
    "dev:full": "concurrently 'pnpm dev' 'pnpm inngest:dev'",
    "build": "next build",
    "start": "next start",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "vitest",
    "test:e2e": "playwright test",
    "test:ci": "vitest run && playwright test",
    "inngest:dev": "inngest-cli dev",
    "supabase:start": "supabase start",
    "supabase:stop": "supabase stop",
    "supabase:reset": "supabase db reset",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "db:seed": "tsx prisma/seed.ts",
    "db:seed:demo": "tsx scripts/seed-demo.ts"
  }
}
```

---

## 14. Branch + deploy strategy

```
main                              → Vercel production deploy
  ├── feature/employee-crud       → Vercel preview deploy (per PR)
  ├── feature/payroll-calc        → Vercel preview deploy
  └── ...
```

**Rules:**
- Every PR gets unique preview URL (e.g., `koolman-hr-git-feature-employee-crud-tong.vercel.app`)
- Preview connects to **staging Supabase project** (separate from production)
- Merge to `main` → production deploy + run prod migrations
- Database changes require migration files (no manual prod DB edits)

### Branch protection

```
main:
  ✓ Require PR before merge
  ✓ Require CI pass (lint, test, build)
  ✓ Require migrations validate
  ✓ Squash merge only (clean history)
```

---

## 15. Database backup + restore

### Local (development)

```bash
# Backup
supabase db dump > backups/local-2026-05-06.sql

# Restore (full reset + restore)
supabase db reset --no-seed
psql $DATABASE_URL < backups/local-2026-05-06.sql
```

### Production (Supabase Pro)

- Automatic daily backups for 7 days (Supabase Pro feature)
- Point-in-time recovery (PITR) available
- Manual backup before risky migrations:
  ```bash
  supabase db dump --linked > prod-backup-pre-migration.sql
  ```

---

## 16. Troubleshooting common issues

### Supabase Docker won't start
```bash
docker ps                          # check Docker is running
supabase stop --no-backup
supabase start
```

### Port conflict
- Default ports: 54321 (API), 54322 (DB), 54323 (Studio), 54324 (Inbucket)
- Customize in `supabase/config.toml`

### Prisma migration fails on staging/prod
- Check connection string has `?pgbouncer=true` for Supabase pooler
- Use `DIRECT_URL` for migration (bypasses pooler)
- Re-run with logs: `pnpm db:deploy --skip-generate`

### Email not sending in dev
- Check Mailpit is running: `docker ps`
- Check Inbucket: `http://localhost:54324`
- Verify env var (no whitespace)

### Vercel deploy fails Prisma generate
- Ensure `postinstall` script: `"prisma generate"`
- Or `vercel.json` build command: `prisma generate && next build`

### RLS blocks legitimate query
- Use service-role client in server code (`@supabase/supabase-js` with SERVICE_ROLE_KEY)
- Or use Prisma direct connection (bypasses RLS — trusted server code)

---

## 17. Onboarding checklist for new dev (handover-ready)

```
[ ] Install Node 24 LTS, pnpm 10, Docker
[ ] Install Supabase CLI, Inngest CLI
[ ] Clone repo + `pnpm install`
[ ] `cp .env.example .env.local`
[ ] Get secrets from password manager (or .env.local from team lead)
[ ] `supabase start` (verify Docker stack boots)
[ ] `pnpm db:migrate && pnpm db:seed`
[ ] `pnpm dlx inngest-cli@latest dev` in separate terminal
[ ] `pnpm dev` → http://localhost:3000
[ ] Open Studio: http://127.0.0.1:54323
[ ] Open Inbucket: http://127.0.0.1:54324
[ ] Open Inngest: http://localhost:8288
[ ] Login as seeded admin user → smoke test
[ ] Run tests: `pnpm test`
[ ] Read docs/v1/architecture.md + screens/
[ ] Make first PR (e.g., update README) → confirm Vercel preview deploys
```

---

## 18. Cost summary by environment

| Tier | Monthly cost | Notes |
|---|---|---|
| Local | **$0** | All Docker-based |
| Preview/Staging | **~$15–20/month** | Supabase free tier + Vercel preview built into Pro |
| Production | **~$46/month** | ดู [tech-stack.md](../tech-stack.md#final-v1-cost) |
| **Total** | **~$60–66/month** | |

Staging optional — บางทีลูกค้า OK ใช้ preview deploys เป็น staging ได้ (single Supabase project for both dev + staging if budget tight)

---

## 19. Best practices

### Do
- ✅ Always create migration file for schema change (no manual `psql`)
- ✅ Test migrations on local first → preview → production
- ✅ Use Prisma Studio + Supabase Studio for ad-hoc DB inspection (don't write raw queries in app to "debug")
- ✅ Commit env templates only — never `.env.local`
- ✅ Use feature branches + PR — even solo dev (gives Vercel preview)
- ✅ Run `pnpm test` before push
- ✅ Use Inngest local dev server (don't ping prod by accident)
- ✅ Backup prod DB before risky migration

### Don't
- ❌ Edit production DB directly (always migration)
- ❌ Commit secrets in `.env.local` or anywhere
- ❌ Skip CI (every PR must pass)
- ❌ Use `service_role_key` from browser code (server-only!)
- ❌ Run dev SQL with same user as prod (Supabase service_role on local has admin power — be careful with destructive scripts)
- ❌ Mix Prisma migrate + manual SQL in same repo without coordination
