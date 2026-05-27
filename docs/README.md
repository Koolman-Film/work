# Koolman Work System

ระบบ HR สำหรับ **Koolman** (ธุรกิจติดฟิล์มรถยนต์) ครอบคลุม การลงเวลา, การลา, การเบิกเงินล่วงหน้า, และการออกสลิปเงินเดือนแบบอัตโนมัติ

**Project codename:** Koolman Work
**Customer:** Koolman — car window film installation, multi-branch
**Operating model:** หลายสาขา, Tue–Sun 9:00–18:00, ปิด Monday

---

## Phased delivery

V1 ส่งมอบเป็น **4 phases** — ลูกค้า commit ทีละ phase. ดู [proposal.md](./proposal.md) สำหรับ pitch ลูกค้า.

| Phase | Scope | Calendar | Quote |
|---|---|---|---|
| **Phase 1** ⭐ | Auth + Employee + Leave + Attendance + Cash Advance | 2–3 wk | **70K ฿** |
| Phase 2 | Payroll Engine + Pay Slip PDF | 3–4 wk | 85K ฿ |
| Phase 3 | Excel + PEAK + Owner + Audit + Settings | 2–3 wk | 50K ฿ |
| Phase 4 (optional) | LINE LIFF + Messaging API | 1–2 wk | 25K ฿ |
| **V1 complete** | All phases | 8–12 wk | **230K ฿** |

---

## Documents

### For customer-facing
- **[proposal.md](./proposal.md)** ⭐ — clean pitch with phased pricing, infra cost breakdown, terms
- [questions.md](./questions.md) — open questions waiting customer answers (9 remaining)

### For engineering
- **[v1/build-plan.md](./v1/build-plan.md)** ⭐ — phased delivery checklists per phase
- **[v1/pre-implementation.md](./v1/pre-implementation.md)** ⭐ — setup checklist before W1 (accounts, CI/CD, AI tools)
- [v1/architecture.md](./v1/architecture.md) — folder structure, auth, schema, server actions, RLS, roles
- [v1/feature-spec.md](./v1/feature-spec.md) — detailed feature spec per module
- [v1/design-system.md](./v1/design-system.md) — design tokens, components, Tailwind theme
- [v1/dev-environment.md](./v1/dev-environment.md) — local + staging + production env setup
- [v1/maintenance.md](./v1/maintenance.md) — post-launch ops + retainer options
- [v1/future-work.md](./v1/future-work.md) — V2/V3 backlog (features Thai HR systems have but V1 doesn't)
- [v1/saas-pricing.md](./v1/saas-pricing.md) — SaaS pricing strategy (5 tiers, cost viability, SMS bundles)
- [v1/screens/](./v1/screens/) — UI specs for every screen, form, modal, toast, edge case
- [v1/screens/mockups/](./v1/screens/mockups/) — 28 visual HTML mockups grouped by phase

### Reference
- [tech-stack.md](./tech-stack.md) — stack rationale + cost estimate

---

## Quick start (dev)

1. Read [proposal.md](./proposal.md) — understand the deal
2. Read [v1/pre-implementation.md](./v1/pre-implementation.md) — get accounts ready
3. Read [v1/build-plan.md § Phase 1](./v1/build-plan.md#phase-1--core-workflow-leave--attendance--cash-advance) — know what to build
4. Open [v1/screens/mockups/index.html](./v1/screens/mockups/index.html) — visual reference
5. Start coding Phase 1.1 (Foundation) following build-plan checklist

---

## Quick start (customer)

1. Read [proposal.md](./proposal.md) — understand scope + pricing
2. Sign Phase 1 contract + 30K deposit
3. Provide onboarding info (admin contact, branches, leave types, logo)
4. Wait 2-3 weeks → live demo → UAT → go-live

---

## Status (2026-05-06)

- ✅ V1 spec complete (architecture + feature-spec + screens + mockups)
- ✅ Phased delivery plan locked
- ✅ Pre-implementation checklist done
- ⏳ Customer Phase 1 commitment pending
- ⏳ Pre-Phase 1 onboarding (waiting customer signal)

---

## Tech overview

- **Frontend:** Next.js 16 + React 19 + Tailwind 4 + shadcn/ui
- **Backend:** Supabase (Postgres + Auth + Storage + Realtime)
- **Background jobs:** Inngest
- **Email:** Resend (free tier covers Phase 1)
- **Hosting:** Vercel (Hobby tier Phase 1, Pro Phase 2+)
- **Errors:** Sentry (free tier)
- **Auth:** Phone + Password (Supabase Auth), SMS OTP for reset only

ดู [tech-stack.md](./tech-stack.md) สำหรับ rationale + alternative considered.

---

## Cost summary

### Customer one-time (dev)
- Phase 1: 70K · Phase 2: 85K · Phase 3: 50K · Phase 4: 25K
- **V1 complete: 230K**

### Customer recurring (infra, pass-through)
- Phase 1: 0–50 ฿/mo (free tier all)
- Phase 2+: ~1,600 ฿/mo (Vercel + Supabase Pro)
- Phase 4: + 1,150 ฿/mo (LINE Push API)
- Domain: 600 ฿/yr

### Customer optional
- Managed retainer: 5,000 ฿/mo (รวม infra + 4 hr support) — ดู [v1/maintenance.md](./v1/maintenance.md)

---

> **Audience:** This doc is the entry point for both customer and dev team. For customer pitch use [proposal.md](./proposal.md). For dev work use [v1/](./v1/).
