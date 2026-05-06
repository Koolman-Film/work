# Post-Launch Maintenance

วิธีดูแลระบบหลัง go-live ของแต่ละ phase.

---

## Warranty (in-scope, ฟรี)

**Coverage:** 14 วันต่อ phase หลัง go-live

**Includes:**
- Critical bug fix (broken feature, data loss, security)
- Cosmetic UI bug (alignment, color, copy typo)
- Server config issues
- Initial DNS / SSL troubleshooting

**Excludes:**
- New feature requests → quote separately
- Scope changes → quote separately
- Customer error (ใส่ข้อมูลผิด / ลบเอง) → ad-hoc charge

**Response time:** within 48 hr (working days)

---

## Beyond warranty — 3 options

### Option A: Self-managed (default)

ลูกค้าจัดการเอง:
- ดู Sentry alerts
- ปรับ Vercel/Supabase plan ตามใช้งาน
- ติดต่อ provider support เอง

ค่าใช้จ่าย: provider cost only (~1,600 ฿/mo Phase 2+)

ข้อดี: ถูกที่สุด · ลูกค้าเรียนรู้ระบบ
ข้อเสีย: ต้องมีคนเทคนิคขั้นพื้นฐาน · เจอปัญหาดึกดื่นก็แก้เอง

---

### Option B: Hourly support (ad-hoc)

จ่ายตามใช้:
- **1,200 ฿/hr** for bug fix
- **1,500 ฿/hr** for minor enhancement
- Block hours (10 hr): **11,000 ฿** (10% discount)

Response time: best effort (no SLA)

เหมาะสำหรับ: ลูกค้าที่มี issue เป็นครั้งคราว

---

### Option C: Managed Retainer ⭐ (recommend)

**5,000 ฿/เดือน** — บิลเดียวง่ายๆ

**Includes:**
- ✅ Provider infra cost (~1,600 ฿/mo) ลูกค้าไม่ต้องจ่าย provider
- ✅ Monthly check-in call (30 นาที) — ดู Sentry, usage, performance
- ✅ Up to **4 hr support / month** (rolled into the 5K)
- ✅ Priority response (within 24 hr working days)
- ✅ Sentry alert monitoring (acknowledge + investigate)
- ✅ Backup verification
- ✅ Minor copy/UI tweaks (ใต้ 1 hr)

**Excludes:**
- New features (quote separately)
- Major scope changes (quote separately)
- Beyond 4 hr/mo (ใช้ rate Option B หลังครบโควต้า)

**Cancel anytime** — แจ้งล่วงหน้า 30 วัน

**คุณกำไร:** ~3,400 ฿/mo (5K - 1,600 infra)
**ลูกค้าได้:** บิลเดียว · มี SLA · เห็นค่าใช้จ่ายชัด

---

## Monitoring checklist (your responsibility, daily)

### Day 1-30 (warranty + early)
- [ ] Sentry: critical errors → respond within 48 hr
- [ ] Vercel: deploy success rate, build time
- [ ] Supabase: DB usage % (warn at 80% of free tier)
- [ ] Resend: email delivery rate
- [ ] Customer Slack/email: any complaints

### Day 30+
- [ ] Sentry weekly summary
- [ ] Supabase weekly DB stats
- [ ] Vercel weekly bandwidth + function invocations
- [ ] Backup verification (Supabase Pro auto-backup)
- [ ] User activity (any pattern of issues?)

---

## Common issues + playbooks

### "พนักงานล็อกอินไม่ได้"
1. Check phone format (E.164 vs 10-digit)
2. Check `auth.users` table — record exists?
3. Check `Employees.status` — Archived?
4. Reset password via admin tool
5. If still broken: investigate Supabase Auth logs

### "อนุมัติคำขอแล้วไม่มี notification"
1. Check Resend status (https://resend.com/status)
2. Check Inngest function logs
3. Check `NotificationPreference` for that user
4. Check email blocked / spam folder

### "Payroll คำนวณผิด" (Phase 2+)
1. **Stop publish** ทันที
2. Compare to `payroll-calc` unit tests
3. Check input data: Attendance, Advance, PayrollConfig
4. Override flow → fix specific row + audit
5. If systematic: revert + redeploy + recalc

### "Database เต็ม / pause"
1. **Free tier auto-pause** = ตื่นขึ้นมาเอง 30 วิ
2. **Free tier 500 MB เต็ม** = upgrade Pro $25/mo
3. Vacuum + reindex if needed
4. Check `Audit` table size (ส่วนใหญ่กิน space)

### "Vercel deploy fail"
1. Check build logs
2. Check env vars (missing/wrong)
3. Check Prisma migration status
4. Rollback if production broken

---

## Phase 2 specific (Payroll)

**Critical:** Payroll = real money. Special protocols:

- **Shadow run** อย่างน้อย 1-2 เดือนก่อน real publish
- **Always Draft → Review → Publish** — never auto-publish
- **Override audit log** — review monthly with Owner
- **Backup before publish** — Supabase point-in-time recovery
- **Rollback plan** — unlock + revise per spec M-N5

---

## Phase 4 specific (LINE)

- **LINE Push API quota** monitor — free tier 200 msg/mo
- **LINE OA verified status** annual renewal
- **Channel access token** rotation every 90 days (LINE policy)
- **Webhook URL** must stay HTTPS — alert if Vercel cert expires

---

## Customer escalation path

1. **Customer support email** → first contact
2. **Slack/LINE chat** → urgent issue, working hours
3. **Phone call** → critical (data loss, system down)

**SLA per option:**
- Self-managed: best effort
- Hourly: best effort
- **Managed retainer:** 24 hr response (working days), 4 hr critical

---

## Annual review

ทุก 12 เดือน คุยกับลูกค้า:
- ระบบยังใช้ดีไหม? Pain points?
- Feature ที่อยากเพิ่ม → quote V2
- Cost optimization (downgrade plan?)
- Annual contract renewal?

---

## Documentation handover

Phase 1 → 4 ทุก phase ส่งมอบ:
- ✅ Source code (GitHub access)
- ✅ Thai user manual (PDF)
- ✅ Admin guide (separate)
- ✅ Architecture overview (this `docs/` folder)
- ✅ Env var template (`.env.example`)
- ✅ Migration history (`prisma/migrations/`)
- ✅ Provider account list + access

ลูกค้าสามารถ:
- ส่งงานต่อให้ dev คนอื่น
- Migrate ไป provider อื่น
- ใช้ source code เอง (license per contract)
