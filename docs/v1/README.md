# Koolman HR — V1 Implementation

**Audience:** Solo developer (you) — actionable plan + reference for V1 build

---

## Phased delivery

V1 = 4 phases · separate quotes · sequential delivery. ดู [build-plan.md](./build-plan.md) สำหรับ detailed checklists.

| Phase | Scope | Hours (AI-heavy) | Calendar | Quote | Stack tier |
|---|---|---|---|---|---|
| **Phase 1** ⭐ | Auth + Employee + Leave + Attendance + Cash Advance | 40–50 | 2–3 wk | 70K | Free tier |
| Phase 2 | Payroll Engine + Pay Slip PDF | 62–74 | 3–4 wk | 85K | Pro tier (~$45/mo) |
| Phase 3 | Excel + PEAK + Owner + Audit + Settings | 44–54 | 2–3 wk | 50K | Pro tier |
| Phase 4 (optional) | LINE LIFF + Messaging API | 20–25 | 1–2 wk | 25K | Pro + LINE OA |
| **V1 complete** | All phases | 166–203 | 8–12 wk | **230K** | — |

**Auth lock:** phone + password (primary), SMS OTP for password reset only (Phase 1 uses admin-reset, no SMS provider needed).

---

## Documents

| File | Purpose |
|---|---|
| **[build-plan.md](./build-plan.md)** ⭐ | Phased delivery — detailed checklists, payment milestones, DoD per phase |
| **[pre-implementation.md](./pre-implementation.md)** ⭐ | Setup checklist — accounts, CI/CD, env, domain, AI tools — ทำก่อนเริ่ม code |
| [architecture.md](./architecture.md) | Folder structure, auth flows, server actions, jobs, RLS, schema, roles |
| [feature-spec.md](./feature-spec.md) | Detailed feature spec per module (validations, edge cases, acceptance) |
| [design-system.md](./design-system.md) | Locked design tokens — Theme 1 + IBM Plex + Soft Modern · Tailwind 4 `@theme` ready |
| [dev-environment.md](./dev-environment.md) | Local + Preview + Production env setup, Supabase CLI workflow, daily commands |
| [maintenance.md](./maintenance.md) | Post-launch operations + retainer options + monitoring playbooks |
| [future-work.md](./future-work.md) | Backlog — features Thai HR systems have but V1 doesn't (Tier 1-4, ~40% parity gap analysis) |
| [design-previews/](./design-previews/) | Visual HTML previews of design directions + font + style comparisons |
| **[screens/](./screens/)** ⭐ | UI specs per role + flows + navigation + shared patterns + 28 mockups |

---

## Reading order (first-time dev)

1. **[../proposal.md](../proposal.md)** — understand the deal
2. **[pre-implementation.md](./pre-implementation.md)** — get accounts ready
3. **[build-plan.md § Phase 1](./build-plan.md#phase-1--core-workflow-leave--attendance--cash-advance)** — know what to build first
4. **[architecture.md](./architecture.md)** — understand the system
5. **[design-system.md](./design-system.md)** — understand visual conventions
6. **[screens/mockups/index.html](./screens/mockups/index.html)** — see the UI
7. **[feature-spec.md](./feature-spec.md)** — implement details

---

## Quick navigation by role

### Employee (mobile-first, Phase 1+2)
- Login → Dashboard
- ขอลา + ดูประวัติ + ปฏิทิน
- ขอเบิกเงิน + ดูประวัติ
- ดู attendance ของตนเอง
- ดูสลิปเงินเดือน (Phase 2)
- Profile + LINE link (Phase 4)

### Admin (desktop, Phase 1+2+3)
- Dashboard (KPI + pending requests)
- จัดการพนักงาน (CRUD + bulk import Phase 3)
- อนุมัติคำขอลา/เบิก
- บันทึก ขาด/ลา/มาสาย (manual + Excel Phase 3)
- รัน payroll + override + publish (Phase 2)
- Export PEAK (Phase 3)
- Audit log (Phase 3)
- Settings (Phase 3)

### Owner (desktop, Phase 3)
- Dashboard read-only (KPI + charts)
- Calendar full company-wide
- Payroll review read-only
- Audit log review

---

## Process

### Daily during dev
- Review **build-plan.md** current phase + sub-section
- Mark items ✅ as done
- Note blockers in commit messages
- Update progress %

### When stuck
- Check **architecture.md** for system design
- Check **screens/* + mockups/** for UI reference
- Check **design-system.md** for component / token
- Check **feature-spec.md** for validation rules

### Customer touchpoints
- Phase 1: kickoff → mid-demo → UAT → handover
- Phase 2: PayrollConfig collection → shadow run → UAT
- Phase 3: PEAK format confirm → bulk test → owner training
- Phase 4: LINE OA setup → device testing → handover
