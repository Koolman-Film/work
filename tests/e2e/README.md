# Integration tests (Playwright)

End-to-end tests that exercise real Next.js + real Postgres + real Supabase Auth.

## Running

```bash
# Make sure .env.local is configured (same as dev). Tests use the same
# Supabase project as the dev server.

# Option A — your dev server is already running in another terminal:
pnpm test:e2e

# Option B — fresh start, Playwright will spawn `pnpm dev` itself:
# (just close the other terminal first; reuseExistingServer is true locally)
pnpm test:e2e
```

To watch the browser:

```bash
pnpm test:e2e --headed
```

To debug a single test:

```bash
pnpm test:e2e --debug tests/e2e/admin-department-crud.spec.ts
```

## What we test

- **Smoke (`smoke.spec.ts`)** — the public landing page renders and `/login` is reachable.
- **Auth (`auth.spec.ts`)** — admin can log in with seed credentials and is redirected to `/admin`. Logout returns to the home page.
- **Admin CRUDs (`admin-department-crud.spec.ts`, `admin-leave-type-crud.spec.ts`)** — full create / list / edit / archive lifecycle for the settings CRUDs that don't depend on other entities.
- **Leave approval (`admin-leave-approval.spec.ts`)** — the high-value one. Seeds a pending LeaveRequest via Prisma directly, then drives the `/admin/leave` UI to approve it, then asserts the correct count of `Attendance` rows (type=OnLeave) were created in the same transaction.

## Test DB caveat

These tests run against the **dev Supabase project** — the same one your dev server uses. Entities created during tests have names prefixed `e2e-` and are cleaned up at the end of each suite via `afterAll` hooks.

This is a known trade-off (cheap to set up; pollutes the dev DB on failure). The proper fix is one of:

1. A separate Supabase project for tests (best long-term — but costs ~$25/mo).
2. Local Postgres via Docker, with Prisma migrate to bring up the schema (best for CI; needs Supabase Auth Cloud or a local supabase-auth container).
3. Supabase Database Branches (cleanest, in preview as of Nov 2025).

Until we pick one, every test must:

- Use entity names prefixed `e2e-` plus a unique suffix.
- Register cleanup in `afterAll` (best effort — failure to clean up is logged but doesn't fail the suite).
- Avoid touching seeded data (the 3 default LeaveTypes, the admin/owner users).

## Login credentials

Pulled from `prisma/seed.ts`:

- Admin: `admin@koolman.local` / `Admin_KMHR_temp_2026!`
- Owner: `owner@koolman.local` / `Owner_KMHR_temp_2026!`

⚠ These are seed-only defaults. Rotate before production.
