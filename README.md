# Koolman HR

Internal HR system for Koolman — multi-branch car-window-film business.

**Stack:** Next.js 16 + React 19 + TypeScript · Tailwind 4 · Prisma 6 · Supabase (Postgres + Auth + Storage + Realtime) · Inngest · LINE LIFF + Messaging API · Vercel.

---

## Quick start

```bash
# 1. install deps (pnpm 10 required)
pnpm install

# 2. copy env template
cp .env.example .env.local
# fill in values from docs/v2/credentials.local.md (gitignored)

# 3. (later — when Prisma schema lands in W1c) apply migrations
pnpm db:deploy

# 4. dev server
pnpm dev
# → http://localhost:3000
```

---

## Structure

```
.
├── docs/                    # all planning + design docs (v1 + v2)
│   └── v2/                  ← current plan
├── prisma/                  # Prisma schema, migrations, seed (W1c)
├── public/                  # static assets, Thai fonts
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── (auth)/          ← W1b
│   │   ├── (admin)/         ← W2
│   │   ├── (owner)/         ← W5
│   │   ├── (liff)/          ← W3
│   │   └── api/             ← webhooks, cron
│   ├── components/          # shared UI (shadcn primitives go here in W2)
│   ├── lib/                 # supabase helpers, audit, i18n, line, etc.
│   └── server/              # server actions, services, repositories
├── tests/
│   ├── unit/                # Vitest
│   └── e2e/                 # Playwright
└── tools/
    └── oidc-smoke/          # one-off Stage 2 OIDC verification — ✅ PASS
```

Full layout in [`docs/v2/architecture.md`](./docs/v2/architecture.md).

---

## Docs entry points

- **[`docs/v2/README.md`](./docs/v2/README.md)** — active engineering plan
- **[`docs/v2/architecture.md`](./docs/v2/architecture.md)** — locked decisions, schema, auth model
- **[`docs/v2/build-plan.md`](./docs/v2/build-plan.md)** — week-by-week with tests + DoD
- **[`docs/v2/oidc-verification.md`](./docs/v2/oidc-verification.md)** — LINE × Supabase OIDC verification (Stage 1 + 2 PASS)
- **[`docs/v1/`](./docs/v1/)** — historical reference (pre-pivot)

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Production server (after build) |
| `pnpm lint` / `pnpm lint:fix` | Biome lint (read / write) |
| `pnpm format` | Biome format |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest run |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:e2e` | Playwright |
| `pnpm db:generate` | Prisma client codegen |
| `pnpm db:migrate` | Prisma migrate dev |
| `pnpm db:deploy` | Prisma migrate deploy (CI / prod) |
| `pnpm db:studio` | Prisma Studio GUI |
| `pnpm db:seed` | Seed dev database |
| `pnpm db:reset` | Reset + re-migrate (no seed) |

---

---

## Quality checks

| Tool | What | When it runs |
|---|---|---|
| **Biome 2** | Lint + format (JS/TS/JSON) | `pnpm lint`, `pnpm lint:fix`; auto on commit via `lint-staged` |
| **TypeScript strict** | Type-check (`noUncheckedIndexedAccess`, etc.) | `pnpm typecheck`; on every build |
| **Vitest** | Unit tests | `pnpm test` (one-shot), `pnpm test:watch` (TDD) |
| **Playwright** | Integration / e2e (10 tests — see `tests/e2e/README.md`) | `pnpm test:e2e` (auto-starts dev server) |
| **Next build** | Full build smoke | `pnpm build` |

**Pre-commit hook** auto-runs Biome on staged files only (sub-second). Bypass with `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...` if you really need to commit through a lint failure (e.g. WIP after a debug session).

**CI** runs lint + typecheck + test in parallel, then build, on every push and PR (`.github/workflows/ci.yml`).

**Integration tests** (13 Playwright specs in `tests/e2e/`, all passing):
- Smoke (3): home + login render, protected-route redirect
- Auth (3): admin login, anti-enumeration error message, authed → /login bounce
- Department CRUD (2): uniqueness Thai error + full create/edit/archive lifecycle
- Leave approval (2): `$transaction` correctness — approve creates Attendance(OnLeave) rows; reject creates none
- Advance approval (3): approve+receiptUrl round-trips, empty-receipt → null guard, reject two-step confirm

**Unit tests** (78 Vitest specs):
- `src/lib/auth/safe-redirect.ts` — open-redirect defense (15 tests)
- `src/lib/auth/login-error.ts` — error → Thai message + anti-enumeration policy (11 tests)
- `src/lib/pairing/token.ts` — JWT mint/verify + replay + tamper + alg-confusion (12 tests)
- `src/lib/attendance/haversine.ts` — great-circle distance + closest-branch + impossible-travel (14 tests)
- `src/lib/attendance/evaluate.ts` — Confirmed/Disputed decision engine (10 tests)
- `src/lib/leave/working-days.ts` — working-day expansion (skip Sun + holidays) + date parsing (10 tests)
- `src/lib/utils.ts` — `cn()` class-name combiner (6 tests)

---

## Status

- ✅ W1 — Foundation + auth + DB + role gates
- ✅ W2 — Admin CRUDs (employees / branches / departments / accounting groups) + LINE pairing + geofence map
- 🔨 W3 — LIFF check-in / check-out
  - ✅ W3a — LIFF pairing flow (`/liff/pair`): LINE OIDC → Supabase → atomic User-bind
  - ✅ W3b — GPS + geofence check-in / check-out (Haversine, impossible-travel, Confirmed/Disputed)
  - 🔨 W3c — admin attendance views + selfie
    - ✅ W3c-1 — disputed inbox (`/admin/attendance/disputed`): review + Approve/Reject with required note
    - ✅ W3c-2 — live attendance board (`/admin/attendance/live`): Supabase Realtime + 30s polling fallback
    - ⏳ W3c-3 — (deferred) selfie capture + Supabase Storage bucket (folded into W4-late)
- 🔨 W4 — Leave + cash advance flows
  - ✅ W4a — LeaveType admin CRUD (`/admin/settings/leave-types`)
  - ✅ W4b — LIFF leave request flow (`/liff/leave` + new + detail with cancel)
  - ✅ W4c — Admin leave inbox (`/admin/leave`) + approve expands to Attendance(OnLeave) rows in one tx
  - ✅ W4d — Cash advance flow (`/liff/advance` + `/admin/advance` — receipt photo upload deferred to W4-late)
  - ⏳ W4-late — Photo uploads + LINE push + in-app bell + team calendar
