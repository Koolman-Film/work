# Future Possible Work

Features ที่ระบบ HR ไทยอื่น (HumanSoft, Bplus, Prosoft, empeo, Workplaze, Better HR) มี — แต่ Koolman V1 (ทุก phase) ยังไม่มี.

> **Status:** เก็บเป็น backlog · ไม่อยู่ใน V1 quote · ลูกค้าตัดสินใจทีละอันว่าจะเพิ่มเมื่อพร้อม.
> **Approach:** เสนอเป็น V2 / V3 add-on packages ภายหลัง · บางอันอาจรวมเข้า Phase 2 / 3 ถ้าลูกค้าจ่ายเพิ่ม

---

## 🔴 Tier 1 — Thai legal compliance (most likely needed eventually)

ระบบไทยทุกตัวมี · ลูกค้าอาจเจอจริงตอน file รายเดือน:

| Feature | Description | Est. effort | Priority |
|---|---|---|---|
| **ภ.ง.ด.1** monthly form | Withholding tax filing per month — auto-generate PDF + CSV ส่งกรมสรรพากร | 8 hr | High |
| **ภ.ง.ด.1ก** annual | Yearly summary, due ก.พ. | 4 hr | High |
| **50 ทวิ (50 Twi)** | Employee annual tax certificate (ใช้ยื่น ภ.ง.ด.91) — PDF per employee | 6 hr | High |
| **ส.ป.ส.1-10** monthly | SSO monthly contribution form CSV (กรอกผ่าน eSPS) | 6 hr | High |
| **ส.ป.ส.1-03** new hire | SSO registration form (ตอน admin add employee) | 3 hr | Medium |
| **ส.ป.ส.6-09** termination | SSO termination form (ตอน archive) | 2 hr | Medium |
| **กยศ deduction** | Student loan auto-deduct in payroll | 4 hr | Medium |
| **PVD** Provident Fund | Member contribution + employer match calc, integrate with PVD provider | 16 hr | Medium |
| **กท. (workmen comp)** | Workmen's compensation 0.2-1% calc | 3 hr | Medium |
| **Tax bracket calculator** | Progressive rate table 0-35% + ลดหย่อนภาษี declaration UI | 12 hr | High |

**Tier 1 total:** ~64 hr · suggested package quote **80–100K** (V1.5 / V2)

---

## 🟡 Tier 2 — Industry common features

| Feature | We have | Thai system have | Effort | Priority |
|---|---|---|---|---|
| OT multi-rate | flat 1.5x | 1.5x weekday / 2x weekend / 3x holiday | 6 hr | High |
| Bonus types | nothing | Annual / mid-year / สัญญา | 5 hr | Medium |
| Allowances | nothing | ค่าเดินทาง / โทรศัพท์ / รักษา / เบี้ยขยัน | 8 hr | Medium |
| **Commission tracking** | nothing | Sales / manager / team-based | 12 hr | **High for Koolman (sales staff)** |
| Late tolerance tier | flat | เกิน 5 นาที = หัก, เกิน 30 = ลาครึ่งวัน | 4 hr | Medium |
| Multi-shift | none | กะเช้า/บ่าย/ดึก/หมุน | 16 hr | Low (Koolman ไม่มีกะ) |
| Leave carry-over | none | สะสมไม่เกิน N วัน ปีถัดไป | 6 hr | Medium |
| Leave-to-cash | none | สิ้นปี ลาเหลือ → จ่ายเงิน | 5 hr | Medium |
| Bank payment file | manual | KBank Cash Connect / SCB Bizz / Bangkok Bank | 8 hr per bank | High |
| GPS mobile clock-in | Phase 4 LINE only | Native mobile + selfie + geofence | 30 hr | Medium |

**Tier 2 total:** ~100 hr · suggested package quote **120–150K** (V2)

---

## 🟢 Tier 3 — Full HRM modules (large add-ons)

ลูกค้า 124 emp อาจไม่จำเป็น — ระบบใหญ่มีหมด:

### Recruitment Module (~60K, 4 wk)
- Job posting page (public)
- Application form
- Resume tracking + status
- Interview scheduling
- Offer letter generation
- Onboarding checklist
- New hire document upload (สำเนาบัตรประชาชน, ทะเบียนบ้าน, วุฒิการศึกษา)

### Performance Evaluation (~50K, 3 wk)
- KPI / OKR tracking per employee
- 360-degree feedback (self / peer / manager / subordinate)
- Probation review (90/120 day cycle)
- Annual review cycle
- Salary adjustment workflow with audit
- Grade / score range output

### Training & Learning (~40K, 2 wk)
- Course catalog
- Training records per employee
- Certificate upload + expiry tracking
- Required training compliance (SHE, fire safety, etc.)
- Internal trainer assignment

### Document Management (~30K, 2 wk)
- Employee document folder (ID copies, contracts, certs)
- Contract expiry alerts
- Employee handbook distribution + acknowledgment workflow
- Memo broadcast with read receipt

### Asset Tracking (~25K, 1 wk)
- Laptop/phone/uniform/tool per employee
- Issue + return history
- Damage / loss reporting
- Depreciation tracking

### Welfare Management (~30K, 2 wk)
- Group insurance enrollment
- Health claim submission + tracking
- Dental / vision / annual checkup tracking
- Employee handbook benefits page

### Employee Self-Service Extras (~20K, 1 wk)
- Tax allowance declaration UI (ลดหย่อนภาษี — บิดามารดา, คู่สมรส, บุตร, ประกัน, RMF/SSF/Easy E-Receipt, ดอกเบี้ยกู้บ้าน)
- Annual tax certificate self-download
- Employment certificate (หนังสือรับรองการทำงาน) self-generate

### Internal Transfer / Promotion (~15K, 1 wk)
- Internal job posting
- Transfer request workflow (employee → manager → HR)
- Salary adjustment on transfer
- Position history log

### Exit Workflow (~25K, 2 wk)
- Resignation form
- Manager approval + handover checklist
- Asset return tracking
- Exit interview form
- Final salary calculation:
  - Severance pay (ค่าชดเชย — 1-10 month tier by tenure)
  - Leave-to-cash conversion
  - Last month pro-rated
  - PVD payout calculation

**Tier 3 total:** ~265 hr · suggested as **separate V2 quotes per module** (customer picks)

---

## 🔵 Tier 4 — Advanced tech features

### Mobile App (V1.5 already in plan, but currently spec'd as light)

Expand to full native-feel:
- GPS clock-in with geofence per branch
- Selfie / face recognition on clock-in
- Offline mode (sync when reconnect)
- Push notifications native (vs LINE only)
- App Store / Play Store distribution

**Effort:** 60-80 hr (was ~25 hr in V1.5 LIFF only) · **Quote add: ~80K**

### Fingerprint Scanner Direct API (~25K, 2 wk)

Instead of Excel upload, integrate directly:
- ZKTeco / Suprema / FingerTec brand SDK
- Real-time push from scanner → server
- No manual Excel anymore

### Government E-Filing Integration (~40K, 2-4 wk)

When SSO + RD open API:
- Submit ภ.ง.ด.1 + ส.ป.ส.1-10 directly via API
- No more manual upload to portals
- Currently most systems still file manual / portal upload (no public API yet 2026)

### Bank Statement Reconciliation (~20K, 1 wk)

Verify salary actually paid:
- Upload bank statement CSV
- Auto-match against payroll Published amounts
- Flag mismatches

### Advanced Dashboard Analytics (~30K, 2 wk)

Beyond V1 dashboard:
- Headcount trend (12 months)
- Turnover rate calculation
- Cost-per-employee analytics
- Drill-down by branch / department / role
- Scheduled report email (weekly / monthly auto-send)

---

## How to use this doc

### When customer asks "Can it do X?"

1. ค้นหา X ในเอกสารนี้
2. ถ้าอยู่ใน Tier 1-2 → "ทำได้ แต่ต้องเพิ่ม scope ~Y hours, quote เพิ่ม ~Z baht"
3. ถ้าอยู่ใน Tier 3-4 → "เป็น V2 module — quote separate ตามที่เลือก"
4. ถ้าไม่อยู่ที่ไหนเลย → ลูกค้าน่าจะคิด custom — quote brand new

### Recommendation order to customer (after V1 ships)

```
Year 1 (V1 launch + stable):
  Phase 1 → Phase 2 → Phase 3 → Phase 4
  = 230K total

Year 2 (V2 — pick the most painful):
  + Tier 1 Thai compliance package (80-100K)
    ← ลูกค้า file ภ.ง.ด./ส.ป.ส. หลายเดือน → ขอ automate
  + Tier 2 OT multi-rate + Bank file (50-70K)
    ← เจอเรื่องคำนวณ OT พลาด หรือ ทำ bank file ด้วยมือเหนื่อย
  + Commission tracking (~30K)
    ← Sales staff ทักท้วงว่าคำนวณ commission ลำบาก

Year 3 (V3 — if growth):
  + Recruitment / Performance / Training (~150K)
    ← พนักงานเพิ่ม → ต้องการ workflow ครบ
  + Mobile app native (~80K)
    ← พนักงานนอก office, GPS clock-in
```

### Honest comparison to Thai HR systems

| Feature category | Koolman V1 (all phases) | HumanSoft / empeo |
|---|---|---|
| Auth + Employee CRUD | ✅ | ✅ |
| Leave + Attendance + Advance | ✅ | ✅ |
| Payroll calc (basic) | ✅ | ✅ |
| Thai tax forms (Tier 1) | ❌ | ✅ |
| SSO forms (Tier 1) | ❌ | ✅ |
| PVD (Tier 1) | ❌ | ✅ |
| OT multi-rate (Tier 2) | ❌ | ✅ |
| Bank file (Tier 2) | ❌ | ✅ |
| Recruitment (Tier 3) | ❌ | ✅ |
| Performance (Tier 3) | ❌ | ✅ |
| Training (Tier 3) | ❌ | ✅ |
| Mobile native (Tier 4) | ❌ V1.5 LIFF only | ✅ |

**~40% feature parity** of full HumanSoft / empeo.

**Trade-offs Koolman wins on:**
- Custom build → ปรับ business logic ของ Koolman ตรงๆ (ไม่ต้องสู้ vendor)
- Source code ownership → ไม่มี vendor lock
- Lower TCO if not subscribing 5+ years
- No mandatory monthly subscription

**Trade-offs HumanSoft wins on:**
- 100% feature complete day 1
- Auto-update with กฎหมายแรงงานไทย (เปลี่ยน tax bracket / SSO rate ปี 2569 ก็ update ให้)
- Trained Thai accountant support
- ภ.ง.ด./ส.ป.ส. integrated

### When to recommend HumanSoft instead

ถ้าลูกค้าอยาก feature parity เต็ม + budget < 230K → แนะนำ HumanSoft (~5-10K/mo) ดีกว่าทำ custom. ตรงไปตรงมา.

ถ้าลูกค้าอยาก:
- Customization บ่อย (workflow business-specific)
- Brand ของตัวเอง
- Long-term ownership > 3 ปี
- Multi-company / multi-branch ของกลุ่มเครือ

→ Custom build (Koolman approach) คุ้มกว่า

---

## Backlog tracking format

ถ้าลูกค้า request feature เพิ่มในอนาคต — เพิ่ม row ในตารางนี้:

| Date | Customer request | Tier | Effort est. | Quote (THB) | Status |
|---|---|---|---|---|---|
| _(empty)_ | | | | | |

---

> **Last updated:** 2026-05-07 (post Thai HR system research)
> **Next review:** หลัง Phase 1 launch — ดู feedback ลูกค้าจริง ว่าอยากได้ feature ไหนก่อน
