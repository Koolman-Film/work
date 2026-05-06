# Time Log — Koolman HR (Koolman)

Internal tracking ของชั่วโมงทำงานในโปรเจกต์นี้ — สำหรับ billing, retro, และ accuracy ของ estimate ครั้งหน้า

> **Note:** ไฟล์นี้คือ internal — ไม่อยู่ใน `docs/` ที่ส่งให้ลูกค้า

---

## Project Info

| | |
|---|---|
| Customer | **Koolman** |
| Project codename | **Koolman HR** |
| Solo developer | _(your name)_ |
| Hourly rate | **1,500 THB/hr** |
| Contract type | _(TBD — Phased fixed-price แนะนำ ดู [proposal.md](./docs/proposal.md))_ |
| Project start | _(TBD — รอเซ็น contract)_ |
| Discovery start | **2026-05-05** |
| V1 target live | _(TBD — ~10–11 weeks หลัง start)_ |

---

## Rate sheet

| Activity type | Rate (THB/hr) | Billable? | Note |
|---|---|---|---|
| Discovery / requirement / spec | 1,500 | ⚠️ พิจารณา | บางที pre-sale ไม่ bill ถ้ายังไม่เซ็น contract — ตัดสินใจตามดีล |
| Design / architecture | 1,500 | ✅ | |
| Implementation (build) | 1,500 | ✅ | |
| Testing (unit / E2E) | 1,500 | ✅ | รวมใน fixed-price quote |
| Bug fix (in-warranty) | 0 | ❌ | ฟรี 30 วันหลัง go-live |
| Bug fix (post-warranty / MA) | 1,500 | ✅ | นับใน MA hours (4 hr/month) |
| Change request | 1,500 | ✅ | นอก scope V1 — ต้อง written approval |
| Customer meeting / call | 1,500 | ⚠️ | bill ถ้าเกิน 2 hr/week |
| Travel | 0 | ❌ | onsite ไม่บ่อย |
| Documentation handover | 1,500 | ✅ | รวมใน fixed-price |
| Training session | 1,500 | ✅ | 1 session รวม |

---

## Phase / Module Categories

ใช้ใน column `Phase` ของ entry log เพื่อ rollup คำนวณ vs estimate

| Code | Phase | Estimate (hr) | จาก |
|---|---|---|---|
| `DISC` | Discovery / Requirement | — | pre-V1, may not bill |
| `SETUP` | Setup & Infra | 40 | proposal.md |
| `AUTH` | Auth & Users | 40 | |
| `DB` | DB & Models | 35 | |
| `EMP` | Employee Mgmt | 30 | |
| `TIME` | Time Tracking (manual + Excel) | 35 | |
| `LEAVE` | Leave Management | 35 | |
| `ADV` | Cash Advance | 30 | |
| `PAY` | Payroll Engine | 60 | |
| `SLIP` | Pay Slip (Employee) | 15 | |
| `OVR` | Attendance Override | 15 | |
| `EXP` | Accounting Export (PEAK) | 25 | |
| `OWN` | Owner Calendar + Admin Dash | 25 | |
| `NOTIF` | Notifications (in-app + Email) | 35 | |
| `FILE` | File Storage S3 | 10 | |
| `AUDIT` | Audit Log UI | 10 | |
| `RESP` | Responsive Polish | 15 | |
| `TEST` | Testing | 50 | |
| `DOCS` | Docs + Deploy + Training | 20 | |
| `BUF` | Buffer / Unknowns | 48 | |
| `LINE` | V1.5 LINE Integration | 30 | |
| `MEET` | Customer meeting / Q&A | — | |
| `MGMT` | PM / Coordination | — | |

**V1 total estimate:** 520 hr
**V1.5 total estimate:** +30 hr

---

## Entry Log

> Format: `| date | hours | phase | description | billable |`
> Add new rows ที่ **bottom** — ห้ามแก้ entry เก่า (ใช้ note column ถ้าผิด)

| Date | Hours | Phase | Description | Billable |
|---|---|---|---|---|
| 2026-05-05 | _TBD_ | DISC | อ่าน requirement.docx + เริ่ม draft schema/features/roles/questions | ⚠️ |
| 2026-05-05 | _TBD_ | DISC | Customer Q&A round 1 — answered 60+ questions, updated docs | ⚠️ |
| 2026-05-05 | _TBD_ | DISC | Q&A round 2 — Koolman context, dept seed, leave seed, PDPA | ⚠️ |
| 2026-05-05 | _TBD_ | DISC | Drafted MVP V1 plan ([proposal.md](./docs/proposal.md)) — scope, schema, tech, pricing | ⚠️ |
| 2026-05-05 | _TBD_ | DISC | Comparison V1 vs requirement.docx — gap analysis | ⚠️ |
| 2026-05-05 | _TBD_ | DISC | Adjust V1 → add Email V1 + LINE V1.5 (Option B) | ⚠️ |
| | | | | |

> **Action:** กลับมา fill _TBD_ hours จากความจำ / time tracker (Toggl, Clockify) ถ้าใช้

---

## Running Summary

> Update manually หลัง add entries — หรือใช้ script awk/python summarize

### By Phase (V1)

| Phase | Spent (hr) | Estimate (hr) | Remaining | % |
|---|---|---|---|---|
| DISC | 0 | — | — | — |
| SETUP | 0 | 40 | 40 | 0% |
| AUTH | 0 | 40 | 40 | 0% |
| DB | 0 | 35 | 35 | 0% |
| EMP | 0 | 30 | 30 | 0% |
| TIME | 0 | 35 | 35 | 0% |
| LEAVE | 0 | 35 | 35 | 0% |
| ADV | 0 | 30 | 30 | 0% |
| PAY | 0 | 60 | 60 | 0% |
| SLIP | 0 | 15 | 15 | 0% |
| OVR | 0 | 15 | 15 | 0% |
| EXP | 0 | 25 | 25 | 0% |
| OWN | 0 | 25 | 25 | 0% |
| NOTIF | 0 | 35 | 35 | 0% |
| FILE | 0 | 10 | 10 | 0% |
| AUDIT | 0 | 10 | 10 | 0% |
| RESP | 0 | 15 | 15 | 0% |
| TEST | 0 | 50 | 50 | 0% |
| DOCS | 0 | 20 | 20 | 0% |
| BUF | 0 | 48 | 48 | 0% |
| **V1 Total** | **0** | **520** | **520** | **0%** |
| LINE (V1.5) | 0 | 30 | 30 | 0% |
| **Grand Total** | **0** | **550** | **550** | **0%** |

### By Week

| Week | Hours | Notes |
|---|---|---|
| W0 (2026-05-05) | _TBD_ | Discovery + spec |
| W1 | | |
| W2 | | |
| ... | | |

---

## Milestones (Billing checkpoints)

ตาม [proposal.md](./docs/proposal.md)

| Milestone | Trigger | Amount (THB) | Status | Date |
|---|---|---|---|---|
| Contract sign | เซ็น contract | 216,000 (30%) | ⏳ pending | — |
| Week 5 demo | Cash advance + Payroll engine working | 216,000 (30%) | ⏳ | — |
| UAT pass (W9) | All UAT criteria met | 216,000 (30%) | ⏳ | — |
| Go-live + 30d warranty | live สำเร็จ + 30 วันหลัง | 72,000 (10%) | ⏳ | — |
| **V1 Total** | | **720,000** | | |
| V1.5 start | LINE OA verified + work start | 22,500 (50%) | ⏳ optional | — |
| V1.5 live | LINE notif live | 22,500 (50%) | ⏳ | — |
| **V1.5 Total** | | **45,000** | | |

---

## Out-of-scope / Change Requests Log

> ทุกครั้งที่ลูกค้าขอ feature นอก V1 scope — บันทึกที่นี่ก่อน quote

| Date | Request | Estimate (hr) | Quote (THB) | Customer decision | Status |
|---|---|---|---|---|---|
| | | | | | |

---

## Expenses Log

> ค่าใช้จ่ายที่ pass-through ลูกค้าหรือเรา advance ไปก่อน

| Date | Item | Amount (THB) | Pass-through? | Reimbursed? |
|---|---|---|---|---|
| | | | | |

**ที่อาจมี:**
- AWS hosting (ลูกค้าจ่ายตรง — ไม่ผ่านเรา)
- Domain registration (TBD ใครจ่าย)
- LINE Messaging API plan (ลูกค้าจ่ายตรง)
- SSL cert (free Let's Encrypt — no cost)

---

## Estimate Accuracy Retrospective

> หลังจบแต่ละ phase กลับมา compare estimate vs actual

| Phase | Estimate (hr) | Actual (hr) | Variance | Lesson |
|---|---|---|---|---|
| | | | | |

---

## Tools (recommend)

ใช้ external tracker + log สรุปที่นี่ทุกสัปดาห์:

- **Toggl Track** — free, web + mobile, project/tag system, export CSV
- **Clockify** — free, similar to Toggl, unlimited users
- **Harvest** — paid, มี invoicing built-in (ดีถ้าออก invoice บ่อย)
- **Manual md log** — ถ้าโปรเจกต์เดียว เร็วและ private

---

## Process

1. **เริ่ม session:** start timer ใน Toggl/Clockify ก่อน — หรือ note เวลาเริ่ม
2. **จบ session:** stop timer + add entry ใน table นี้ (ใส่ phase code + 1 บรรทัดอธิบาย)
3. **End of week:** update Running Summary + send invoice ถ้าถึง milestone
4. **End of phase:** retrospective — note variance + lesson

---

## Pre-contract DISC hours decision

> Discovery รอบแรกๆ ที่ทำก่อนเซ็น contract — ตัดสินใจ:

**Option A — ฟรี (sunk cost):**
- ยังไม่ bill DISC hours ใดๆ ก่อนเซ็น
- ถ้าเซ็นไม่สำเร็จ → ลงเป็น sales/marketing cost
- ทำได้สูงสุด ~20–30 hr ก่อน decline

**Option B — bill ตามจริง:**
- คิด DISC hours จริงทุกชั่วโมง ลูกค้าจ่าย
- เหมาะถ้าลูกค้า committed แต่งบยังไม่ตกผลึก
- ต้อง quote rate ก่อนเริ่ม discovery

**Option C — fixed discovery fee:**
- เก็บค่า discovery แบบเหมา (เช่น 30,000 THB เหมา) สำหรับ output ชัดเจน:
  - requirement doc complete
  - MVP V1 plan
  - quote สำหรับ V1
- ลูกค้าจ่าย deposit ก่อนเริ่ม
- ถ้าตกลง V1 → 30K หัก discount จาก V1 quote

**แนะนำ:** **Option C** — protect เวลา + lock in commitment + flexibility ของลูกค้า

---

## Quick template — copy เข้า log ใหม่

```
| YYYY-MM-DD | X.X | CODE | description ของงาน 1 บรรทัด | ✅/⚠️/❌ |
```
