# Koolman HR SaaS — Pricing Strategy

**Status:** Draft · pending first 3 customers to validate
**Last updated:** 2026-05-07

> ทางเลือก SaaS ของ Koolman HR — สำหรับลูกค้าที่ไม่อยาก self-host หรือไม่อยากจ่าย one-time custom build. หลังลูกค้าแรก (Koolman) ใช้ Phase 1 hybrid → ขยายเป็น SaaS public.

---

## Pricing card (public)

```
Koolman HR SaaS

  STARTER      490 ฿/mo · up to 25 emp   · Phase 1 · 30 SMS/mo
  GROWTH       990 ฿/mo · up to 75 emp   · Phase 1 · 100 SMS/mo
  BUSINESS   1,990 ฿/mo · up to 200 emp  · Phase 1+2 · 300 SMS/mo
  PRO        3,490 ฿/mo · up to 500 emp  · All phases · 1,000 SMS/mo
  ENTERPRISE  quote   · 500+ emp · Custom · Unlimited SMS

  + LINE add-on        290 ฿/mo · any tier (Phase 4)
  + Extra SMS pack     290 ฿/mo · 500 additional SMS
  + Storage upgrade    290 ฿/100 GB/mo
  + Priority support   990 ฿/mo · 4hr SLA
  + Custom report      1,000 ฿/hr · one-off

  Setup fee:    9,990 ฿ (waived if annual)
  Free trial:   14 days (no credit card)
  Annual save:  17% (2 months free)
  Founding 5:   First 5 customers — locked rate forever
```

---

## Detailed tier breakdown

| | **Starter** | **Growth** ⭐ | **Business** | **Pro** | **Enterprise** |
|---|---|---|---|---|---|
| **Employees max** | 25 | 75 | 200 | 500 | 500+ |
| **Modules** | Phase 1 | Phase 1 | Phase 1+2 | Phase 1+2+3 | All + custom |
| **Storage** | 100 MB | 500 MB | 2 GB | 10 GB | Unlimited |
| **SMS/mo included** | 30 | 100 | 300 | 1,000 | Unlimited |
| **Admin users** | 1 | 3 | 10 | Unlimited | Unlimited |
| **Custom branding** | ❌ | ❌ | ✅ logo | ✅ full | ✅ white-label |
| **Backup retention** | 7 days | 14 days | 30 days | 90 days | Custom |
| **Support SLA** | Email 48hr | Email 24hr | Email 24hr | Email 8hr | Phone + dedicated |
| **Monthly** | **฿490** | **฿990** | **฿1,990** | **฿3,490** | quote |
| **Annual (save 17%)** | ฿4,900 | ฿9,900 | ฿19,900 | ฿34,900 | quote |
| **Per-emp/mo (annual)** | 16.3 ฿ | 11.0 ฿ | 8.3 ฿ | 5.8 ฿ | <5 ฿ |

### vs Competitors at 124 emp

| Vendor | Annual cost | Modules included |
|---|---|---|
| BetterHR (per-emp 80 ฿) | ~119,040 ฿ | KPI, ATS, asset, multi-country |
| empeo (estimate per-emp 100 ฿) | ~149,000 ฿ | Full HRM |
| HumanSoft Pro (flat) | ~18,900 ฿ | Cap on emp count, full Thai HR |
| **Koolman HR Business** ⭐ | **฿19,900** | Phase 1+2 (Leave/Att/Adv/Payroll/Slip) |
| FlowAccount Payroll | ฿5,490 | Tiny SME, payroll only |

**Koolman HR = ~6× cheaper than BetterHR + competitive vs HumanSoft + includes Payroll.**

---

## Cost analysis

### Fixed infra cost (regardless of customer count)

#### Stage A — Free tier (0-2 customers, <100 emp total)

| Service | Cost | Limit |
|---|---|---|
| Vercel Hobby | ฿0 | 100 GB BW, 100K invocations/mo |
| Supabase Free | ฿0 | 500 MB DB, 1 GB storage, **auto-pause 7 days** |
| Resend Free | ฿0 | 3,000 emails/mo, 100/day |
| Sentry Free | ฿0 | 5,000 errors/mo |
| Inngest Free | ฿0 | 50,000 runs/mo |
| Domain | 50 ฿/mo | — |
| **Total fixed** | **฿50/mo** | |

⚠️ Vercel Hobby technically requires Pro for commercial use (ToS). Acceptable risk at 1-2 customers.
⚠️ Supabase auto-pause if 7 days idle — mitigate with GitHub Actions cron-ping.

#### Stage B — Pro tier (3-15 customers, ~500-1,500 emp total)

| Service | Cost |
|---|---|
| Vercel Pro | $20 = ฿720/mo |
| Supabase Pro | $25 = ฿900/mo |
| Resend Free (still) | ฿0 |
| Sentry Free (still) | ฿0 |
| Domain | ฿50/mo |
| **Total fixed** | **฿1,670/mo** |

#### Stage C — Scale (15+ customers, 2,000+ emp)

| Service | Cost |
|---|---|
| Vercel Pro | ฿720/mo |
| Supabase Pro + storage addon | ฿900–1,800/mo |
| Resend Pro 50K | ฿720/mo |
| Sentry Team | ฿935/mo |
| Domain | ฿50/mo |
| **Total fixed** | **~฿3,400/mo** |

### Variable cost per customer

| Item | Per customer/mo |
|---|---|
| DB storage marginal | 10–80 MB |
| Bandwidth | ~1 GB |
| Email | ~200-500 emails |
| **Compute (Vercel functions)** | negligible |
| **SMS (within tier bundle)** | 5-150 ฿ depending on tier |
| **Total marginal** | **~50-200 ฿/mo** |

### SMS cost detail

Provider: **ThaiBulkSMS** (recommended)
- Volume rate: 0.30-0.60 ฿/SMS (lower at higher volume)
- Setup: register sender ID "KoolmanHR" (~3-5 days approval)
- Prepaid model — buy credits in advance

Per-tier SMS economics:

| Tier | Bundle | Cost @ avg rate | % of revenue |
|---|---|---|---|
| Starter (30 SMS) | 30 × 0.50 = 15 ฿ | 15 | 3% |
| Growth (100 SMS) | 100 × 0.50 = 50 ฿ | 50 | 5% |
| Business (300 SMS) | 300 × 0.40 = 120 ฿ | 120 | 6% |
| Pro (1,000 SMS) | 1,000 × 0.30 = 300 ฿ | 300 | 9% |

Overage: customer pays 1.0 ฿/SMS (Starter) → 0.5 ฿/SMS (Pro). Margin remains positive.

### Your time cost (semi-fixed)

| Activity | Hours | Monthly cost @ 1,000 ฿/hr |
|---|---|---|
| Compliance update (Thai tax/SSO yearly) | 10-15 hr/yr | ~1,000 ฿/mo amortized |
| Bug fix + monitoring (regardless) | 5 hr/mo | 5,000 ฿/mo |
| Per-customer support | 0.5-1 hr/mo | 500-1,000 ฿/mo per customer |

---

## Profit/loss table (1 to 20 customers)

Assumes Growth tier (฿990/mo) baseline + 50 ฿/mo SMS:

### Cash margin view (your time = sunk founder cost)

| Customers | Stage | Revenue/mo | Infra | SMS | Cash margin |
|---|---|---|---|---|---|
| 1 | A · Free | 990 | 50 | 50 | **+890 ฿** ✓ |
| 2 | A · Free | 1,980 | 50 | 100 | **+1,830 ฿** ✓ |
| 3 | B · Pro | 2,970 | 1,670 | 150 | **+1,150 ฿** ✓ |
| 5 | B · Pro | 4,950 | 1,670 | 250 | **+3,030 ฿** ✓ |
| 10 | B · Pro | 9,900 | 1,670 | 500 | **+7,730 ฿** ✓ |
| 20 | B · Pro | 19,800 | 1,670 | 1,000 | **+17,130 ฿** ✓ |

### Realistic view (your time @ 1,000 ฿/hr)

| Customers | Cash margin | Time cost | Net (real) |
|---|---|---|---|
| 1 | +890 | 5,500 | **-4,610 ❌** |
| 2 | +1,830 | 6,000 | **-4,170 ❌** |
| 3 | +1,150 | 6,500 | **-5,350 ❌** |
| 5 | +3,030 | 7,500 | **-4,470 ❌** |
| 10 | +7,730 | 10,000 | **-2,270 ❌** |
| **15** | +12,930 | 12,500 | **+430 ✓** |
| 20 | +17,130 | 15,000 | **+2,130 ✓** |

**Break-even (counting your time): ~15 Growth-tier customers.**

Higher-tier customers shift break-even down. At 15 Business-tier customers (mostly):
- 15 × ฿1,990 = ฿29,850/mo revenue
- ฿2,170 infra + SMS
- ฿15,000 your time
- = **+฿12,680 net** ✓

So: **Mix of tiers** = real path to break-even faster.

---

## Strategic launch path

### Stage 1 — Validation (Month 0-3)

**Goal:** First 1-3 customers · validate model · iterate fast

- Stay on Free tier infra (฿50/mo)
- No marketing spend — direct outreach (network, referral)
- Focus: Koolman onboarding + 2 reference customers
- Charge **founding member rate**: same as public but locked rate forever

**Cash forecast:** +1,000 to +2,500 ฿/mo. ขาดทุนถ้าคิดเวลาตัวเอง · OK ใน founder mode.

### Stage 2 — Scale (Month 3-12)

**Goal:** 10-15 customers · pay for own time eventually

- Upgrade to Pro tier (3rd customer signs)
- Light marketing — landing page + SEO + 1-2 case studies
- Add referral program (Month 6+)
- Refine onboarding to <30 min self-service

**Cash forecast:** +5,000 to +12,000 ฿/mo by Month 12.

### Stage 3 — Sustainable (Month 12-24)

**Goal:** 20+ customers · cover full cost incl. your time · pay yourself

- Stable infra (Pro tier sufficient up to ~50 customers)
- Hire part-time customer support (~5K/mo) at 25+ customers
- Add Tier 1 features (ภ.ง.ด./ส.ป.ส. forms) from `future-work.md`
- Charge slightly higher for new customers

**Cash forecast:** +20,000 to +50,000 ฿/mo by Month 24.

---

## Customer-facing details

### What customer gets

✅ All features of subscribed tier
✅ Auto-update with Thai labor law / tax bracket changes (Tier 1+ when added)
✅ Unlimited Admin/Owner users (within emp count limit)
✅ Daily Supabase backups (Pro tier+)
✅ 99.5% uptime target (post-launch SLA)
✅ Email support (response per tier SLA)
✅ Mobile + desktop responsive
✅ Data export anytime (CSV/JSON dump)
✅ Cancel anytime — no long-term lock-in

### What customer DOES NOT get

❌ Source code (locked unless source-out package)
❌ Full white-label (Pro+ tier only)
❌ Custom modifications (use Pro+ for limited customization)
❌ Self-host option

### Source-out option

Customer can buy source code + transition help if changes mind:

| When | Price |
|---|---|
| Year 1 | 200,000 ฿ |
| Year 2 | 100,000 ฿ |
| Year 3+ | 50,000 ฿ |

Includes: full source code, Prisma migrations, deployment scripts, 4 hr handover call.

---

## SMS handling details

### What's covered by SMS bundle

✅ Password reset OTP (always)
✅ New employee invite SMS (with magic link)
✅ Critical alerts (configurable per customer):
  - Leave approved/rejected
  - Cash advance approved/rejected
  - Payroll published
  - Late warning (Phase 2)

### What customer can disable (default ON)

- Per-employee notification preferences
- Per-event toggle in Settings → Notifications
- Customer admin can override organization-wide policy

### Volume management

| Customer at | Bundle | Status |
|---|---|---|
| <80% of bundle | OK | normal |
| 80-100% | Warning email to admin | "approaching limit" |
| 100-200% | Send + invoice overage | per-SMS rate |
| >200% | **Hard stop** until next month or upgrade | prevents bill shock |

### International phones (foreign workers)

- Thai SMS API works for **+66** (Thai numbers) only
- Foreign workers (มอญ/พม่า/ลาว) → email reset fallback
- Customer admin can pre-assign email instead of phone for those employees

### SMS provider failover

Primary: ThaiBulkSMS
Fallback: SMS Master (if primary down >5 min)
Last resort: Email reset (still works)

---

## Add-ons detail

### LINE notification add-on (฿290/mo)

- Phase 4 features (LIFF link + push notifications)
- Customer must set up LINE OA + verify (~1-2 wk wait)
- LINE Push API quota: 200 free, beyond = customer's LINE bill (~1,150 ฿/mo paid tier)
- Recommend: included in Pro+ tier, add-on for Starter/Growth/Business

### Extra SMS pack (฿290/mo)

- 500 additional SMS for any tier
- Cost to us: 500 × 0.40 = 200 ฿
- Margin: 90 ฿ (31%)
- Cumulative — buy multiple packs if needed

### Storage upgrade (฿290 per 100 GB)

- For customers with heavy attachments (medical certs, receipts)
- Most customers won't need

### Priority support (฿990/mo)

- 4hr response SLA on critical issues
- Phone support during working hours
- Optional for any tier

### Custom report (฿1,000/hr)

- One-off custom dev work
- Customer signs scope before work starts
- Min 4 hr engagement

---

## Promotions & retention

### Founding member program (first 5 customers)

- **Locked rate forever** — even if public price increases
- Direct founder support (you, personally)
- Influence on roadmap (top 3 feature requests prioritized)
- "Founding partner" badge in customer dashboard
- Marked publicly as launch partner if customer agrees

### Annual prepay incentive

- 17% off (2 months free)
- Setup fee waived
- Locked rate for 1 year (immune to mid-year price hike)

### Referral program

- Refer customer who signs up → 1 month free for both
- 5 successful referrals → 1 year free
- Reward credited as account credit, not cash

### Tier upgrade incentive

- Move from monthly → annual: instant 17% discount
- Move up tier: pro-rate previous payment
- Move down tier: credit unused days (no refund)

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Multi-tenant data leak | Low | High | RLS strict + audit logs + penetration test pre-launch |
| Customer demands feature outside tier | High | Med | "Quote separately" or upgrade tier |
| Customer wants source mid-contract | Med | Med | Source-out option Year 1: 200K |
| Stripe chargebacks / Thai bank issues | Low | Med | Annual prepay reduces, provide tax invoice |
| Solo dev unavailable (illness/holiday) | Med | High | Document playbooks, partner with backup dev |
| Compliance update missed (Thai tax bracket change) | Med | High | Annual review · subscribe Thai tax law newsletter |
| SMS provider outage | Low | Med | Fallback provider + email backup |
| Vercel/Supabase price hike | Med | Low | Customer pays infra cost embedded; raise prices accordingly with notice |
| Free tier abuse (50 fake employees) | Low | Low | CAPTCHA on signup + monitor unusual patterns |

---

## Operational requirements

### Pre-launch checklist

- [ ] Multi-tenant DB schema (every table has `tenantId` + RLS)
- [ ] Stripe + Thai bank payment integration
- [ ] Self-service signup + onboarding flow
- [ ] Admin panel (super-admin) to manage tenants
- [ ] Backup + DR plan documented
- [ ] Status page (cachet/atlassian-statuspage) for uptime
- [ ] Privacy policy + Terms of Service (Thai version)
- [ ] PDPA compliance review
- [ ] Tax invoice generation per customer
- [ ] VAT registration (when revenue > 1.8M ฿/yr)

### Monthly operational tasks

- Monitor Sentry (daily glance)
- Supabase usage check (weekly)
- SMS credit refill check (weekly)
- Customer health check (monthly per tier)
- Compliance update review (monthly)
- Backup restore test (quarterly)

### Yearly tasks

- Thai tax bracket update (Q1 each year)
- SSO rate update (when changes)
- Annual security audit
- Customer satisfaction survey
- Pricing review (raise 5-10% if costs rise)

---

## Decision points before launch

### Q1: Multi-tenant build first OR single-tenant Koolman first?

**Recommend: Single-tenant Phase 1 for Koolman (current plan), then refactor multi-tenant when 2nd customer signs.**

- Multi-tenant from day 1 = +120 hr
- Refactor later = +60 hr (less complete rewrite)
- Risk: refactor pain when scaled
- Benefit: faster Koolman delivery, validate model first

### Q2: Phase 1 only OR full Phase 1+2 for SaaS launch?

**Recommend: Phase 1 only for first 3 customers, then Phase 2 ready.**

- Phase 1 = differentiator vs competitors (cheaper for small SME, no payroll noise)
- Phase 2 = needed for serious customers (real money)
- Roadmap clearly visible to attract Phase 2 needers

### Q3: Bring-your-own SMS account vs bundled?

**Recommend: Bundled (current plan).**

- Customer doesn't manage SMS credits
- We get small markup
- Single bill, simpler UX
- Failure mode: customer abuses bundle → hard cap protects us

### Q4: Founding member rate — public or only direct outreach?

**Recommend: Direct outreach only.** Don't advertise; offer privately to selected first 5.

- Maintain perceived value of public rate
- First 5 feel special
- After 5 → public rate

---

## When to recommend custom build instead of SaaS

If customer asks for any of:
- Heavy customization (outside tier scope)
- Multi-company / multi-brand under one parent
- Integration with internal ERP
- 500+ employees with seasonal scaling
- Specific data residency (on-premise)
- Source code ownership upfront

→ Quote custom build (per `proposal.md` Phase 1-4 model). Don't try to fit into SaaS tier.

---

## Honest summary

✅ **Pricing works at 5+ Growth+ customers** healthy.
⚠️ **At 1-3 customers** — sustainable cash-wise only if your time is "sunk" (founder mode).
❌ **Pure SaaS for Koolman alone = unprofitable** if counting your time properly.

### Recommended approach

**For Koolman (first SaaS customer):**
- Use **hybrid model** — Phase 1 = ฿70K custom + Phase 2+ = SaaS subscription
- Customer keeps Phase 1 source · pays for Phase 2-4 as service
- 5-yr LTV: 70K + 4 × 19,900 = **฿149,600**

**For SaaS launch (when ready, post-Koolman):**
- Stage 1: Free tier infra + 1-2 customers
- Stage 2: Pro tier infra + 3-15 customers (Month 3-12)
- Stage 3: Scale + 20+ customers (Month 12+)
- Founding member program for first 5

---

## See also

- [proposal.md](../proposal.md) — customer-facing custom build proposal
- [pre-implementation.md](./pre-implementation.md) — setup checklist (incl. ThaiBulkSMS)
- [build-plan.md](./build-plan.md) — phased delivery plan
- [future-work.md](./future-work.md) — V2/V3 backlog (features Thai HR systems have)
- [maintenance.md](./maintenance.md) — post-launch ops + retainer
