# Koolman HR — v2 (LINE-Exclusive)

**Status:** Active engineering plan as of 2026-05-26
**Replaces:** [v1/](../v1/) (preserved as historical reference)
**Scope of v2:** Re-baseline after pivot to LINE-exclusive employee experience.

---

## What changed from v1

| Area | v1 (prior plan) | v2 (this plan) |
|---|---|---|
| Employee auth | Phone + password (Supabase Auth), SMS OTP for reset | **LINE Login + LIFF via Supabase Custom OIDC Provider (`custom:line`)** — Employee gets a real Supabase session via `signInWithIdToken`, same as Admin/Owner |
| Admin / Owner auth | Phone + password, SMS OTP | **Email + password** (Supabase Auth, no OTP, no 2FA) |
| Auth session model | Two parallel paths (Supabase for admin/owner; LIFF-token-verify for employee) | **One Supabase session model for all three roles** |
| Email provider | Resend (free tier) for any email | **None** — Supabase Auth built-in SMTP handles admin password reset |
| Image rendering | Direct Supabase Storage URLs | **`next/image` + Vercel Image Optimization** (auto WebP/AVIF) |
| Web Vitals + Analytics | None | **Vercel Speed Insights + Vercel Analytics** (free on Pro) |
| Attendance (primary) | Admin manually records exceptions; scanner Excel upload Phase 3 | **LIFF check-in/out with GPS geofence in Phase 1** |
| Attendance (fallback) | — | Excel scanner upload kept in **Phase 3** |
| Notifications to employee | In-app + email + LINE (Phase 4 optional) | **LINE Messaging API only** (Phase 1) |
| Notifications to admin/owner | Same channels | **In-app bell only** (Supabase Realtime) |
| PDPA compliance work | Significant scope (consent screens, retention crons, etc.) | **Out of scope V1** — defer to V2 |
| SMS provider (ThaiBulkSMS) | Required, sender-ID approval blocked Phase 1 start | **Removed entirely** |
| `inviteUserByPhone` | Load-bearing on this Supabase API | **Removed** — invite is a short-lived JWT shared via QR / LINE link |
| Multi-branch geofence | Not in V1 schema | **Added** (lat/lng/radius per Branch) |
| Department model | FK only, no model | **Modeled explicitly** |
| AccountingGroup model | In v1 feature-spec only, not in latest minimalist schema | **Restored** (per requirement.docx) |
| `Payroll.Deduct_Debt` | Missing | **Added** + `RecurringDeduction` table |
| Employee team leave calendar | Not built (Owner-only calendar) | **Added** to Phase 1 |

---

## Files in this directory

| File | Purpose |
|---|---|
| [README.md](./README.md) | This index |
| [architecture.md](./architecture.md) | Locked architectural decisions, schema, auth model, RLS strategy, storage, observability |
| [build-plan.md](./build-plan.md) | Phase-by-phase, week-by-week implementation plan with tests per step and DoD per phase |
| [requirement-diff.md](./requirement-diff.md) | Side-by-side comparison vs `requirement.docx` — gaps closed and intentional expansions to confirm with customer |
| [oidc-verification.md](./oidc-verification.md) | LINE × Supabase Custom OIDC compatibility check + runnable smoke tests. Stage 1 verified ✅ |

---

## Quick links

- **Start here as dev:** [architecture.md](./architecture.md) → [build-plan.md](./build-plan.md)
- **Verify scope vs customer ask:** [requirement-diff.md](./requirement-diff.md)
- **Pricing / customer-facing:** unchanged — still in [../proposal.md](../proposal.md) and the v1 docs (numbers will be re-baselined separately; this v2 plan is engineering-focused)

---

## Phases at a glance

| Phase | Calendar | Scope |
|---|---|---|
| **Phase 1** | W0–W5 (~5 wk) | Foundation + Admin/Owner auth + LINE link + **LINE check-in/out + Leave + Cash advance** + LINE notifications |
| **Phase 2** | W6–W9 (~4 wk) | Payroll engine + PDF slip + LINE delivery + RecurringDeduction (Deduct_Debt) |
| **Phase 3** | W10–W12 (~3 wk) | Excel scanner upload (fallback) + Owner dashboard + Settings sub-pages + Audit log UI + PEAK CSV export grouped by AccountingGroup |
| **Phase 4** (optional) | +2–3 wk | Anti-cheat upgrades: face match, branch QR, dispute-appeal flow, Branch Manager role |

---

## Decisions deferred from v1

These were open in v1; v2 locks them. See [architecture.md §1](./architecture.md#1-locked-decisions).

1. RLS strategy → **A (Prisma bypass; RLS as backstop). Now actually useful for Realtime subscriptions because all roles have real Supabase sessions (decision #9).**
2. Tenancy → **single-tenant per Supabase project**
3. Migration ordering → **expand-contract policy**
4. Idempotency → **Inngest event IDs + per-event dedup tables**
5. Money type → **`Decimal(12,2)` + decimal.js arithmetic**
6. Timezone → **UTC storage, `@db.Date` for calendars, BKK display**
7. FK cascade rules → **`Restrict` on Employee FKs; soft-delete everywhere**
8. Bleeding-edge smoke test → **1-day W0 spike before Phase 1 starts**
9. **LINE auth via Supabase Custom OIDC Provider (`custom:line`)** — unified Supabase sessions for Employee + Admin + Owner; no parallel LIFF-token-verify path. Drops Resend (Supabase built-in SMTP handles admin password reset).
