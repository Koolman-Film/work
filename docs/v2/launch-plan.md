# Koolman Work — Launch Plan

**Authored:** 2026-05-28
**Status:** Current operational plan, sequenced by priority + dependency order
**Replaces:** ad-hoc todo tracking + the W5 checklist in [build-plan.md](./build-plan.md)
**Owner:** Tong (sole developer)

---

## Where we are now

Phase 1 is **~95% functionally complete** and live at https://work.kool-man.com on a Singapore-region Vercel project backed by a Singapore-region Supabase project. Custom domain via Cloudflare DNS (gray-cloud, DNS-only). One Owner + one Admin account seeded. LINE OIDC, LIFF pairing, GPS check-in, leave + advance flow, in-app bell, team calendar, LINE push notifications, storage RLS — all shipped. The first real-phone LIFF pairing succeeded as of 2026-05-28.

What's NOT yet done falls into three buckets:

1. **Operational hardening** — Sentry, credential rotation, Vercel Analytics, backup drill (cheap but high-risk if skipped)
2. **Phase 1 functional gaps** — manual attendance entry, `/liff/profile`, two attendance crons, two minor crons (small but block real onboarding)
3. **Phase 2 / 3 / 4** — payroll engine, Excel scanner upload, expanded Owner views, audit UI, PEAK CSV export, anti-cheat (large, scheduled later)

The current build (`work.kool-man.com`) is usable for **internal smoke testing** but isn't safe for customer onboarding yet because of (1) and (2).

---

## Sequencing principles

1. **See before you change.** Sentry + Analytics must be live before we rotate secrets or touch prod data.
2. **Close functional gaps before inviting users.** A pilot with 3 employees needs manual-attendance + profile-edit; without those, admins are blocked on exceptions and employees can't update their phone number.
3. **Build proof, then build scale.** Run a 1-week soft-launch with 2-3 real employees before starting Phase 2 (payroll). If the basics break under real usage, we don't want to be mid-payroll-engine.
4. **High-value > low-effort within each sprint.** When two items are similar effort, ship the one a real user will notice first.

---

## Sprint 1 — Production hardening (~1 week, ~8 hours)

**Goal:** From this point forward, every change is observable, recoverable, and using rotated production credentials.

| # | Task | Effort | Depends on | Why first |
|---|---|---|---|---|
| 1.1 | Enable **Vercel Web Analytics** + **Speed Insights** in dashboard | 30 sec | — | Components already in code (`src/app/layout.tsx`); just flip the toggles |
| 1.2 | Create **Sentry** project + paste DSN into Vercel env vars + redeploy | 30 min | — | After this, every runtime error in prod surfaces in Sentry within seconds |
| 1.3 | Add a **deliberate test error** in a hidden route, confirm Sentry captures it, remove | 15 min | 1.2 | Validates the pipeline before you're depending on it |
| 1.4 | **Rotate all leaked credentials** (DB password, Supabase service_role, LINE channel secret, LINE messaging access token, Inngest event/signing keys, PAIRING_JWT_SECRET) | 1 hr | 1.2 | Per task #9 — these were shared in transcripts. With Sentry up, rotation breakages are visible. |
| 1.5 | Update `docs/v2/credentials.local.md` with rotated values | 15 min | 1.4 | Keep reference doc accurate (still gitignored) |
| 1.6 | **Backup/restore drill** — take Supabase PITR snapshot, restore to a side project, verify data intact, document the procedure | 1 hr | — | Cheap insurance; required before any customer relies on the data |
| 1.7 | Set Vercel **Deployment Protection** for Preview deploys only (block public access to PR previews) | 5 min | — | PR previews currently public; lock them to Vercel auth |
| 1.8 | Audit **proxy logs** for the first prod week to confirm no unexpected 5xx | 30 min ad hoc | 1.2 | Real signal from Sentry + Vercel logs |

**Sprint 1 DoD:**
- ✅ Sentry capturing >0 events from prod
- ✅ Vercel Analytics + Speed Insights showing real user data
- ✅ All credentials rotated; old values revoked
- ✅ Backup restored to a test project end-to-end
- ✅ No public-Internet access to Preview deploys

---

## Sprint 2 — Phase 1 functional closure (~1 week, ~12 hours)

**Goal:** Close the remaining functional gaps in Phase 1 so a real employee + admin can use every flow without hitting a "not yet built" wall.

| # | Task | Effort | Spec ref | Notes |
|---|---|---|---|---|
| 2.1 | `/liff/profile` — employee views + edits own profile (phone, nickname; read-only for branch/department/salary) | 2.5 hr | S-E11 | Highest value: every employee will visit weekly to update info |
| 2.2 | `/admin/attendance/[date]` — manual attendance entry form (Absent / Late / EarlyLeave with notes) | 3 hr | S-N10, build-plan W3 | Without this, admins can't handle "employee was sick, didn't tap LIFF" cases |
| 2.3 | `/admin/attendance` records list — per-employee per-date browser (NOT just today's live board) | 2 hr | S-N9 | Admins need to look up historical attendance for payroll review |
| 2.4 | Inngest **`attendance-force-checkout-eod`** cron — auto-close open check-ins after schedule end + 4hr | 1 hr | build-plan W3 | Prevents stale "still working" rows piling up |
| 2.5 | Inngest **`attendance-late-check`** function — notify admin when employee hasn't checked in by schedule start + tolerance | 1 hr | build-plan W3 | Push to admin bell |
| 2.6 | **Holiday-substitution logic** — Thai holiday on Monday → auto-substitute next Tuesday in working-days calculator | 1 hr | build-plan W5 | Affects leave working-day counts on holiday weekends |
| 2.7 | Inngest **`probation-reminder`** cron — notify admin 7 days before each employee's 4-month probation ends | 1 hr | build-plan W5 | Daily cron checking probation end dates |
| 2.8 | **Smoke-test all crons** in Inngest dashboard | 30 min | 2.4+2.5+2.7 | Use Inngest's "Run now" button |

**Sprint 2 DoD:**
- ✅ Admin can log an absent employee from web UI without leaving the dashboard
- ✅ Employee can update own phone via LIFF
- ✅ All 4 Inngest crons (existing + 3 new) visible in dashboard, marked "synced"
- ✅ Working-days calculator returns correct count for May 2026 (which has a Monday holiday substitute)

---

## Sprint 3 — Soft launch (~1 week, ~4 hours active + waiting)

**Goal:** Onboard 2-3 pilot employees from Koolman's real team. Catch UX problems that synthetic testing misses. Build confidence before committing to Phase 2.

| # | Task | Effort | Notes |
|---|---|---|---|
| 3.1 | Write **Thai user-guide** at `docs/user-guide/` — 1 page per role (Owner / Admin / Employee) | 2 hr | Markdown, optimized for screenshots + step-by-step |
| 3.2 | Run **20-step UAT script** end-to-end on real phone (admin creates employee → pair → check-in 5 days → leave + advance round-trip → admin approves → push arrives → owner sees stub) | 30 min | Per build-plan W5 |
| 3.3 | **Onboard 2-3 real Koolman employees** as test pilots | 30 min/employee | Send pairing QR, walk them through first check-in |
| 3.4 | **1-week observation period** — watch Sentry + Vercel logs daily | 5 min/day | Look for cold-start spikes, recurring errors, unhandled edge cases |
| 3.5 | **Daily bug-fix budget** for any UAT issues that surface | flex 1 hr/day | Triage and ship same-day; reserve sprint capacity for this |
| 3.6 | After 1 week — **soft-launch retro** with customer (Owner) — what's clunky? What features matter most for Phase 2? | 30 min | Input to Phase 2 priorities |

**Sprint 3 DoD:**
- ✅ 2-3 employees doing real check-ins for ≥5 working days
- ✅ ≥1 real leave request + approval round-trip
- ✅ ≥1 real cash advance request + approval round-trip
- ✅ Sentry shows <5 unique unresolved errors after observation week
- ✅ Customer (Owner) signs off on Phase 1 (yes/no/needs-changes)

---

## Phase 2 — Payroll Engine (~4 weeks)

Detailed scope already in [build-plan.md §W6–W9](./build-plan.md). Major modules:

| Module | What | Effort |
|---|---|---|
| **W6** — PayrollConfig + pure calc service | Settings page + `src/lib/payroll/calc.ts` + 15 fixture tests | ~1 wk |
| **W7** — Payroll run + overrides + publish | `/admin/payroll/[month]` + Inngest fan-out + 4-confirm publish modal | ~1 wk |
| **W8** — PDF + LINE delivery | `@react-pdf/renderer` + Thai font + Inngest push to LINE | ~1 wk |
| **W9** — Revisions + employee slip viewer + UAT | `/liff/payslip` + unlock/republish + **shadow-run UAT** | ~1 wk |

**Phase 2 critical path:** the shadow-run UAT (W9) — running customer's previous month through our system and matching their Excel to ฿0.01. **If shadow-run fails, calc service has a bug; cannot ship payroll.** Budget 2-3 days for shadow-run debugging in Phase 2 estimate.

**Phase 2 DoD** (per build-plan):
- ≥1 real prior month shadow run matches customer's existing Excel exactly
- 100% of slips deliver as LINE messages (or fall back to admin "delivery failed" list)
- PDF renders correctly in 5 readers including LINE in-app
- Override audit captures actor + before + after on every field change

---

## Phase 3 — Excel + Owner expand + Audit UI + PEAK (~3 weeks)

Detailed scope in [build-plan.md §W10–W12](./build-plan.md). Major modules:

| Module | What | Effort |
|---|---|---|
| **W10** — Excel upload + Audit UI | `/admin/attendance/import` + `/admin/audit` with JSON diff viewer | ~1 wk |
| **W11** — Owner expanded views | `/owner/calendar`, `/owner/payroll/[month]` read-only, `/owner/audit`, `/admin/settings/payroll-config` | ~1 wk |
| **W12** — PEAK export + final polish | `exportPeakCsv(month, groupId?)` + `/admin/reports` + final lighthouse/Sentry sweep + Thai admin guide | ~1 wk |

Phase 3 also includes the **bulk CSV employee import** (`/admin/employees/import`, S-N5) — deferred from Phase 1 because manual entry of <10 employees during soft launch is acceptable.

---

## Phase 4 (optional) — Anti-cheat + Branch Manager role (~2-3 weeks)

Build only if customer asks after living with Phase 1-3. Outline:

| Module | What |
|---|---|
| **Face match** (`face-api.js`) | Compare selfie to stored reference photo on Employee profile |
| **Branch QR scan** | Each branch gets printed QR `BRANCH:{id}:{secret}`; LIFF scans via `liff.scanCodeV2`; cross-check with GPS |
| **Liveness check** | Blink-detection during selfie capture |
| **Dispute appeal flow** | Employee "ฉันโต้แย้ง" button on rejected check-in → re-opens admin review |
| **Branch Manager role** | Scoped Admin who only sees own branch's data (requires `requireBranchScope()` RLS-aware helper) |

---

## UX polish backlog (across all phases)

These are spec-quality items from `docs/v1/screens/` that we explicitly skipped in MVP for time but should land before "production polish complete":

| Item | Spec ref | Effort | When |
|---|---|---|---|
| **Empty-state catalog** — consistent illustration + CTA per page | X-E5 | ~3 hr | After Sprint 3 |
| **Loading skeletons** matching final layout | shared-patterns | ~2 hr | After Sprint 3 |
| **Toast catalog audit** — verify all T-E* / T-N* events fire | T-E1..T-N11 | ~2 hr | During Sprint 3 |
| **Slide-in drawers** (`vaul`-style) for leave/advance review on /admin | D-N1, D-N2 | ~4 hr | During Phase 2 |
| **Cancel-confirmation modals** for leave/advance cancel buttons | M-E1, M-E2 | ~1 hr | Sprint 3 |
| **Image preview modal** for receipt/medical-cert thumbnails | M-E5 | ~1 hr | Sprint 3 |

---

## Timeline view

```
Week 1:  [Sprint 1 — Production hardening]
Week 2:  [Sprint 2 — Phase 1 closure]
Week 3:  [Sprint 3 — Soft launch]                      ← Phase 1 complete
Week 4:  ─┐
Week 5:   │ Phase 2 — Payroll Engine
Week 6:   │
Week 7:  ─┘                                            ← Phase 2 complete
Week 8:  ─┐
Week 9:   │ Phase 3 — Excel + Owner + Audit + PEAK
Week 10: ─┘                                            ← Phase 3 complete (V1 fully spec'd)
Week 11+:   Phase 4 only if customer asks for it
```

If everything ships on plan, **V1 fully matches the v1 screen mockups + v2 architecture by end of Week 10 (~2.5 months from today)**. Sprint 1+2+3 alone gives you a production-quality launch you could leave running and stable indefinitely.

---

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Shadow-run UAT in Phase 2/W9 finds calc bugs | High | High (blocks payroll launch) | Reserve 2-3 days in W9 for debugging; have customer's last 3 months of Excel ready in W6 |
| LINE OA verification rejected | Low | High (300 push msg/mo cap) | Apply early (task #43); fall back to in-app bell for above-cap admins |
| PDF Thai font rendering breaks in LINE in-app reader | Medium | Medium | W8 D0 spike: test 3 edge-case names in 5 readers before committing the template |
| Cold-start latency on free Vercel beyond acceptable | Low | Low | Already mitigated by sin1 region + Fluid Compute; observe via Speed Insights |
| Real employees confused by the LIFF flow | Medium | Medium | Sprint 3 captures this; 1-page Thai user-guide + admin walks them through first time |
| Inngest free-tier (~50K runs/mo) blown by misconfigured retry | Low | Medium | Per-event dedup tables in place; observe Inngest dashboard daily during Sprint 3 |

---

## How to use this doc

- **Re-read at sprint start.** The doc reflects priorities as of 2026-05-28. If reality diverges (customer pivots, scope changes), edit the relevant sprint section and commit.
- **Don't edit the build plan.** Keep `build-plan.md` as the historical phase plan; this `launch-plan.md` is the operational layer.
- **Tasks 9 + 10 in the workspace task list** map to Sprint 1 items 1.4 + 1.2 here. Update both as you finish.
- **At end of each sprint:** add a 1-paragraph retrospective at the bottom of this doc (what landed, what slipped, what changed about the plan).

---

## Sprint retrospectives

_(append here as sprints close)_
