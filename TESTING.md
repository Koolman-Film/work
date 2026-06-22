# Testing

Three tiers, each with a different cost/confidence trade-off. Run the cheap
ones constantly; the expensive ones before merging anything risky.

| Tier | Runner | What it touches | Command | Count |
|------|--------|-----------------|---------|-------|
| **Unit** | Vitest | Pure functions, no I/O | `pnpm test` | ~604 across 51 files |
| **Integration** | Vitest | Real Postgres (dedicated `koolman_test` DB) | `pnpm test:integration` | 18 across 3 files |
| **E2E** | Playwright | Real Next.js + Postgres + Supabase Auth | `pnpm test:e2e` | 22 specs |

CI (`.github/workflows/ci.yml`) runs lint → typecheck → unit → integration in
parallel, then build. All four must pass before build.

---

## Unit tests

Pure-logic only. No DB, no network, no Next.js runtime. Config:
[`vitest.config.ts`](vitest.config.ts).

- **Convention:** test lives next to source — `foo.ts` ↔ `foo.test.ts`.
- **What belongs here:** money/time math, schedule resolution, late-policy
  decisions, geofence distance ([`haversine.ts`](src/lib/attendance/haversine.ts)),
  i18n locale resolution, permission grouping, report-shape transforms — anything
  you can call with plain inputs and assert on the output.
- **What does NOT:** anything importing `@/lib/db/prisma`, `requirePermission`,
  `requireRole`, `next/headers`, or `'use server'`. Those go to integration/e2e.

```bash
pnpm test            # run once
pnpm test:watch      # watch mode
pnpm test:coverage   # text + html report, scoped to src/lib (see below)
```

### Coverage

`pnpm test:coverage` reports against `src/lib/**` only — the domain logic unit
tests target. The `app/` UI tree (pages, components, server actions) is exercised
by e2e, which v8 unit coverage can't measure, so including it would just drown
the number in untestable React. The HTML report lands in `/coverage` (gitignored).

---

## Integration tests

Exercise real service flows (payroll run/publish, advance balance, OT candidates,
report aggregations) against a **dedicated** local Postgres database, so the
global sweeps (advances/recurring deductions) can never touch your demo `postgres`
DB. Config: [`vitest.integration.config.ts`](vitest.integration.config.ts).

Tests share one DB, so they run serially (`fileParallelism: false`) and each
`reset()`s the transactional tables in `beforeEach`. **A reset must clear every
table that FK-references the ones it wipes — including rows other test files
leave behind** (e.g. `Payroll` FKs `Employee`).

### What's testable here

Auth-**free** service functions only — no `requirePermission`/`requireRole`
wrapper. If a function calls one of those, it needs e2e instead. Currently
covered: `runPayrollDraft` / `publishPayroll` / `lockPayroll` /
`previewPayrollDrafts`, `advanceBalanceFor`, `getOtCandidates`, and the
`advanceReport` / `attendanceReport` / `leaveReport` aggregations.

> `server-only` modules (e.g. `reports/queries.ts`) throw on import under
> vitest's resolver, so the integration config aliases `server-only` to the
> package's own no-op `empty.js`.

### One-time setup (local)

The local Supabase Postgres runs on port **54422**. Create the test database and
migrate it:

```bash
# 1. Create the dedicated DB (container name from `supabase status`)
docker exec supabase_db_koolman_hr psql -U postgres -c "CREATE DATABASE koolman_test"

# 2. Apply all migrations to it
pnpm db:test:deploy

# 3. Run the suite
pnpm test:integration
```

`db:test:deploy` pins `DATABASE_URL`/`DIRECT_URL` to the `koolman_test` DB, so it
never touches your dev data. After a new migration, re-run `db:test:deploy`.

### In CI

The `integration` job spins up a throwaway `postgres:17` service container,
points `TEST_DATABASE_URL` at it, runs `prisma migrate deploy`, then the suite.
The Prisma migrations are vanilla-Postgres compatible (Supabase Storage RLS lives
outside them), so a plain image works — no Supabase needed.

---

## E2E tests

Full-stack Playwright against a running Next.js + the **same Supabase project as
dev**. See [`tests/e2e/README.md`](tests/e2e/README.md) for the details. In
short:

```bash
# .env.local must be configured (same as dev)
pnpm test:e2e            # spawns `pnpm dev` if not already running
pnpm test:e2e --headed   # watch the browser
```

Seed data uses an `e2e-` prefix and is removed by `cleanupE2eRecords`, so e2e runs
don't accumulate junk in the shared project.

### When to reach for e2e

Anything gated by `requirePermission`/`requireRole` (admin approve/void flows,
the LIFF worker check-in) — the parts neither unit nor integration can reach.
