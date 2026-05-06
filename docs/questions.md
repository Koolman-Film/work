# Open Questions for Customer

คำถามที่ยังไม่ชัดเจน — รอลูกค้าตอบ. ข้อที่ตอบแล้วถูกบันทึกไว้ใน [proposal.md](./proposal.md), [feature-spec.md](./v1/feature-spec.md), หรือ [architecture.md](./v1/architecture.md).

> **Last updated:** 2026-05-06
> **Resolved questions:** ดูใน git history หรือ docs ที่ระบุ

---

## 🔴 Critical (block Phase 1 start)

ไม่มี — ทุกอย่างที่ block Phase 1 ตอบแล้ว.

---

## 🟡 Important (block Phase 2 start)

### Q1 — Income_Other source
**Context:** ใน Phase 2 (payroll) มี field `Income_Other` (commission, ค่ารถ, ค่าโทร).
**Question:** ที่มาจากไหน?
- (A) Admin คีย์มือทุกเดือน
- (B) Sync API จากระบบขาย (POS)
- (C) Excel upload ตาม pattern attendance

**Default ถ้าไม่ตอบ:** Admin คีย์มือ (option A) — เร็วสุด, ปรับได้ตอน V2.

### Q2 — Standard reports list
**Context:** Phase 3 (PEAK export) มี report module.
**Question:** ลูกค้าต้องการรายงานอะไรบ้างเป็น standard?
- (A) Monthly attendance summary
- (B) Leave summary (per employee, per dept)
- (C) Cash advance summary
- (D) Late/absent ranking
- (E) อื่นๆ (specify)

**Default:** A + B + C (พื้นฐาน). อื่นๆ ขึ้นกับลูกค้าตอบ.

### Q3 — Admin KPI dashboard
**Context:** Phase 1 (admin dashboard).
**Question:** Admin อยากเห็น KPI อะไรเด่นที่สุด?
- (A) คำขอลา/เบิก รออนุมัติ (default mockup)
- (B) ใครลาวันนี้
- (C) Trend ยอดหัก
- (D) อื่นๆ

**Default:** A + B + alert banner (ตาม mockup `adm-dashboard.html`).

---

## 🟢 Nice to know (Phase 3+)

### Q4 — Fingerprint scanner
**Context:** Phase 3 (Excel attendance upload).
**Questions:**
- ยี่ห้อ / รุ่นอะไร?
- รองรับ API / SDK / direct DB access ไหม? (ถ้าไม่ → Excel only)
- รูปแบบไฟล์ Excel: column layout, encoding (UTF-8/TIS-620), format วันที่?
- ความถี่ export ที่ทำได้?
- มีสาขา/จุดสแกนกี่จุด?

**Action:** ขอ sample Excel จริง 3-5 ไฟล์ก่อน Phase 3 W0.

### Q5 — Domain
**Context:** Phase 1+ (production deploy).
**Question:** ลูกค้ามี domain หรือยัง?
- ถ้ามี: ส่ง DNS access ให้ (CNAME setup)
- ถ้าไม่มี: ใช้ `*.vercel.app` ก่อน, ซื้อทีหลังได้

**Default:** ใช้ vercel.app ก่อน — ไม่บังคับซื้อ domain Phase 1.

### Q6 — Thai labor law compliance check
**Context:** SSO rate, OT rate, leave policy.
**Question:** Default ตาม กฎหมายแรงงานไทย ปัจจุบันใช่ไหม?
- SSO 5% (capped at ฿750/mo)
- OT minimum 1.5x base hourly
- ลาพักร้อน minimum 6 วัน/ปี (เริ่มหลังทำงาน 1 ปี)

**Action:** ผม research กฎหมายเอง + confirm กับลูกค้าก่อน Phase 2 W0.

---

## 🔧 Configurable (ไม่ต้อง pre-answer)

| # | Item | Where it's set |
|---|---|---|
| - | Cut-off date | Settings → Payroll Config (default = สิ้นเดือน) |
| - | Shift/กะ | Settings → Branches (default ไม่มี) |
| - | Multi-device login policy | architecture.md § Auth (default = อนุญาต) |
| - | Session expiry | architecture.md § Auth (default = 7 วัน) |
| - | Late threshold | Settings → Payroll Config (default = 15 นาที) |
| - | Probation salary rate | Per-employee field |
| - | Holidays | Settings → Holidays (Thai 2026 seeded) |

---

## ⏳ Customer commitment items

### Q7 — Phase 1 commitment
**Status:** กำลังคุย
**Decision needed:** ลูกค้าจะ commit Phase 1 (70K) หรือต้องการแก้ scope?

### Q8 — Phase 2-4 commitment
**Status:** หลัง Phase 1 stable
**Decision needed:** ทำต่อทันที, หรือ pause + รอ feedback?

### Q9 — Managed retainer
**Status:** offer หลัง warranty 14 วัน
**Decision needed:** ลูกค้าจะใช้ managed retainer (5K/mo) หรือ self-managed?

---

## How to use this doc

1. **Before each phase W0** — review related questions, ดัน decision จากลูกค้า
2. **After answer** — move to relevant doc (proposal.md / feature-spec.md / architecture.md), delete from here
3. **Archive log** — git history เก็บ context ของคำถามเดิม

---

> เก่ามีคำถาม 119 ข้อ ตอบ/configurable ไปแล้ว ~107 ข้อ. เหลือ 9 ข้อใน doc นี้ — ดู git history สำหรับ context เก่า.
