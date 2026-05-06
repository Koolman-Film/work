# Koolman HR — Customer Proposal

ระบบ HR สำหรับ **Koolman** (ติดฟิล์มรถยนต์) — ส่งมอบเป็น **4 phases** แยก quote.

> ลูกค้า commit ทีละ phase. เริ่มจาก **Phase 1** ที่ลูกค้ายังไม่เคยมี — ขาด/ลา/มาสาย + ขอเบิกเงิน. เมื่อใช้งาน stable ค่อยตัดสินใจ Phase 2-4.

---

## ภาพรวม

ระบบประกอบด้วย 3 ส่วน — แต่ละ phase ส่งมอบส่วนละนิด:

1. **พนักงาน** — ขอลา, ขอเบิกเงิน, ดูสลิป, รับ notification
2. **Admin / HR** — อนุมัติ, จัดการพนักงาน, รัน payroll, export ลงบัญชี
3. **Owner** — ดูภาพรวมการขาด/ลา/มาสายทั้งบริษัท (read-only)

**ใช้ได้ทุกอุปกรณ์** — desktop, tablet, มือถือ portrait/landscape.

---

## Phased delivery

### Phase 1 — Core Workflow ⭐ **70,000 ฿**

**Calendar:** 2–3 สัปดาห์
**Stack tier:** Free tier ทั้งหมด (ลูกค้าจ่าย infra 0 ฿/เดือน)

**ส่งมอบ:**
- Auth (เบอร์โทร + รหัสผ่าน)
- จัดการพนักงาน (admin เพิ่ม/แก้ทีละคน)
- พนักงาน: profile + ดูข้อมูลตนเอง
- **ลา/ขาด/มาสาย** — พนักงานขอลา, admin อนุมัติ, admin บันทึก ขาด/มาสาย
- **ขอเบิกเงินล่วงหน้า** — พนักงานขอ, admin อนุมัติ
- Notifications (ในแอป + อีเมล)
- Mobile responsive
- Training session 1 ครั้ง + Thai user manual
- Warranty 14 วัน

**Payment:**
- 30K ตอนเซ็นสัญญา
- 20K mid-phase demo
- 20K go-live + handover

---

### Phase 2 — Payroll Engine **85,000 ฿**

**Calendar:** 3–4 สัปดาห์
**Stack tier:** Pro tier (ลูกค้าจ่ายเพิ่ม ~$45/เดือน = ~1,600 ฿/เดือน)
**Prerequisites:** Phase 1 เสถียร + 1 เดือน real data

**ส่งมอบ:**
- คำนวณเงินเดือนรายเดือนอัตโนมัติ (BaseSalary + OT - SSO - หัก - เบิก)
- Override field-level (พร้อม note + audit log)
- Publish + lock สลิป + ส่ง email พร้อม PDF
- Pay slip PDF (Thai font, brand-colored)
- พนักงานดู/ดาวน์โหลดสลิปของตนเอง
- Revision (unlock + แก้ + ส่งใหม่)
- Payroll config (SSO rate, OT rate, cycle)

**Payment:**
- 30K ตอนเซ็นสัญญา
- 30K first payroll cycle published
- 25K UAT pass + warranty start

---

### Phase 3 — Polish **50,000 ฿**

**Calendar:** 2–3 สัปดาห์
**Prerequisites:** Phase 1+2 + 1 เดือน live usage

**ส่งมอบ:**
- Excel attendance upload (จากเครื่องสแกนลายนิ้วมือ)
- Bulk CSV employee import
- PEAK accounting export (CSV/XLSX)
- Audit log UI พร้อม before/after diff
- **Owner role** — ภาพรวมบริษัท + calendar + read-only payroll
- Settings 5 sub-pages (branches, departments, leave types, holidays, payroll config)

**Payment:**
- 20K ตอนเซ็นสัญญา
- 15K Excel + PEAK + Owner working
- 15K UAT pass

---

### Phase 4 — LINE Integration (optional) **25,000 ฿**

**Calendar:** 1–2 สัปดาห์
**Prerequisites:** LINE OA verified (~1-2 wk wait — submit early)

**ส่งมอบ:**
- พนักงานเชื่อม LINE 1 click ผ่าน LIFF
- รับแจ้งเตือนคำขอลา/อนุมัติ/เงินเดือน เข้า LINE
- ไม่ใช่ login ด้วย LINE — ยังคงใช้เบอร์ + รหัสผ่าน

**Customer recurring cost:** ~1,150 ฿/เดือน (LINE Push API paid tier)

---

## สรุปราคา

| Phase | ราคา | Calendar | Status |
|---|---|---|---|
| Phase 1 ⭐ | **70,000 ฿** | 2–3 wk | Recommended start |
| Phase 2 | 85,000 ฿ | 3–4 wk | After Phase 1 stable |
| Phase 3 | 50,000 ฿ | 2–3 wk | After Phase 2 |
| Phase 4 (optional) | 25,000 ฿ | 1–2 wk | When LINE OA ready |
| **V1 complete** | **230,000 ฿** | 8–12 wk | All 4 phases |

---

## Infrastructure cost (ลูกค้ารับผิดชอบเอง — ไม่อยู่ในราคาด้านบน)

| | Phase 1 | Phase 2+ | Phase 4 |
|---|---|---|---|
| Hosting (Vercel) | Hobby ฟรี | Pro $20/mo | Pro $20/mo |
| Database (Supabase) | Free | Pro $25/mo | Pro $25/mo |
| Email (Resend) | ฟรี (3K/mo) | ฟรี | ฟรี |
| Domain (optional) | 600 ฿/ปี | 600 ฿/ปี | 600 ฿/ปี |
| LINE Push API | — | — | 1,150 ฿/mo |
| **Total** | **0–50 ฿/mo** | **~1,600 ฿/mo** | **~2,750 ฿/mo** |

ลูกค้าสมัคร provider ตรง บัตรของตัวเอง — เป็นเจ้าของ account 100%.

---

## บริการต่อเนื่อง (post-launch)

| ตัวเลือก | ค่าใช้จ่าย | รวมอะไร |
|---|---|---|
| Warranty (in scope) | ฟรี 14 วันต่อ phase | bug fix critical |
| Hourly support | 1,200 ฿/hr | ad-hoc bug fix beyond warranty |
| **Managed retainer** ⭐ | **5,000 ฿/เดือน** | infra cost + monitoring + 4 hr support + monthly check-in |
| Major feature add | quote case-by-case | — |

> **Managed retainer แนะนำ** สำหรับลูกค้าที่ไม่อยากดูแล provider เอง — บิลเดียวง่ายๆ.

---

## What ลูกค้าได้กลับ

✅ **Source code** ส่งมอบครบ — ลูกค้าเป็นเจ้าของ
✅ **Documentation** Thai user manual + admin guide
✅ **Training** session ละ 1 ชม. (per phase)
✅ **Warranty** 14 วันต่อ phase (bug fix critical free)
✅ **Account ownership** — Vercel/Supabase/Domain ในชื่อลูกค้า
✅ **Migration option** — ย้ายไป provider อื่นได้ทุกเมื่อ

---

## ทำไมเลือกแบบนี้

- **Phase 1 ก่อน** = ลูกค้าได้สิ่งที่ใช้งานได้เร็วที่สุด ไม่ต้องรอยาว
- **Phased commit** = ทดลองก่อน ค่อยตัดสินใจ phase ถัดไป
- **Free tier Phase 1** = ลูกค้าทดสอบได้โดยไม่มีค่า infra
- **Pass-through infra** = โปร่งใส ไม่มี markup ซ่อน
- **Source delivered** = ไม่ติดเรา ไม่ vendor lock
- **AI-heavy dev** = เร็วกว่าเดิม 60% โดยคุณภาพไม่ลด

---

## ขั้นตอนถัดไป

1. ลูกค้า review proposal นี้
2. เลือก commit Phase 1 (70K) หรือต้องการแก้ scope?
3. ถ้าตกลง — เซ็นสัญญา + ค่ามัดจำ 30K
4. ส่ง onboarding info (admin contact, branches, leave types, logo)
5. **เริ่มงาน W1** — kickoff call + dev start

---

> **เอกสารอ้างอิง (สำหรับทีมพัฒนา):**
> - [build-plan.md](./v1/build-plan.md) — phased detailed checklist
> - [pre-implementation.md](./v1/pre-implementation.md) — setup checklist before W1
> - [tech-stack.md](./tech-stack.md) — stack rationale + cost
> - [feature-spec.md](./v1/feature-spec.md) — detailed feature spec per module
