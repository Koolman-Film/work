# UAT Script — 20 steps to validate everything end-to-end

Run this BEFORE inviting real pilot employees. Tests every Phase-1 flow on a real phone + real admin browser. Total time: ~25-30 minutes.

**You'll need:**
- A computer with the admin web open (`https://work.kool-man.com`)
- A real phone (iPhone or Android) with LINE app installed and logged in
- The seeded Owner account credentials (in `docs/v2/credentials.local.md`)
- A second LINE account on a friend's phone for the employee test (optional but better — avoids using your own LINE)

---

## Section A — Admin foundation (5 steps, ~5 min)

- [ ] **1. Log in as Admin** — open `/login` → enter Admin credentials (`goodytong+admin@gmail.com`) → confirm redirect to `/admin` dashboard
- [ ] **2. Verify KPI cards render** — all 4 cards visible (pending leave, pending advance, today's check-ins, not-checked-in)
- [ ] **3. Confirm sidebar nav loads** — hover each menu item; no broken links; current page highlighted
- [ ] **4. Create a test branch** with real lat/lng:
  - Settings → สาขา → + เพิ่ม
  - Name: "Test Branch UAT"
  - Click on map → place pin at YOUR current location (so you can check-in from here)
  - Save → confirm pin appears in branch list
- [ ] **5. Create a test employee** assigned to that branch:
  - Employees → + เพิ่มพนักงาน
  - Name: e.g., "UAT Test"
  - Branch: "Test Branch UAT"
  - Department: any
  - Salary: ฿15,000 monthly
  - Save → confirm appears in list

---

## Section B — Pairing flow (3 steps, ~5 min — REAL PHONE)

- [ ] **6. Generate pairing link** — open the test employee's edit page → in "การเชื่อม LINE" card → click "📩 สร้างลิงก์ LINE" → confirm QR appears + amber "รอพนักงานเปิดลิงก์" status
- [ ] **7. Scan QR on real phone** — open phone camera → scan → browser opens `/i/<token>` → tap "เปิดในแอป LINE →" → LINE opens
- [ ] **8. Complete pairing in LIFF** — confirm:
  - "Add Koolman Work as friend" popup appears → tap Add
  - "กำลังเตรียมการเชื่อมต่อกับ LINE..." spinner
  - "เชื่อมบัญชีสำเร็จ — ยินดีต้อนรับ, UAT Test"
  - Auto-redirect to `/liff/check-in`
  - Back on admin browser → refresh employee page → card now green ✅ "พนักงานเชื่อมบัญชี LINE แล้ว"

---

## Section C — Daily attendance flow (3 steps, ~3 min — REAL PHONE)

- [ ] **9. Check in from LIFF** — on phone in LIFF → tap "เช็คอินเข้างาน":
  - GPS permission prompt → Allow
  - (If branch requires selfie) — camera opens → take photo → confirm
  - Success message: "เช็คอินสำเร็จ ที่ Test Branch UAT"
- [ ] **10. Admin sees live update** — on admin browser → `/admin/attendance/live` → confirm test employee appears in table within ~5 seconds (Realtime push); status badge "Confirmed"
- [ ] **11. Check out** — phone → tap "เช็คเอาท์" → confirm "เช็คเอาท์สำเร็จ"; admin browser shows clock-out time

---

## Section D — Leave flow (3 steps, ~5 min)

- [ ] **12. Submit leave request** (phone) — tap 📅 คำขอลา → + ส่งคำขอ → fill:
  - Type: ลาป่วย
  - Start: tomorrow
  - End: day after tomorrow
  - Reason: "UAT test leave"
  - Submit → confirm appears in "คำขอลาของฉัน" list with "รออนุมัติ" status
- [ ] **13. Admin approves leave** (browser) — `/admin/leave` → click the pending row → see employee + dates + working-day count → click อนุมัติ → fill optional note → confirm "อนุมัติแล้ว" badge appears
- [ ] **14. LINE push arrives** (phone) — within ~5 seconds, LINE notification banner: "Koolman Work: ✅ คำขอลาได้รับการอนุมัติแล้ว" → tap → opens LIFF leave detail showing Approved status

---

## Section E — Cash advance flow (2 steps, ~3 min)

- [ ] **15. Submit advance request** (phone) — tap 💰 ขอเบิก → + ส่งคำขอ → amount ฿2,500 → submit → confirm "รออนุมัติ"
- [ ] **16. Admin approves with receipt** (browser) — `/admin/advance` → click pending row → **upload a test image file** as receipt → click อนุมัติ → confirm status flips to Approved → phone receives LINE push notification

---

## Section F — Edge cases (3 steps, ~5 min)

- [ ] **17. Disputed check-in handling** — IF possible, move ~200m away from branch + try to check in again (or use Chrome DevTools location spoof on a desktop to simulate). Should land on `/admin/attendance/disputed`:
  - admin sees the row with selfie thumbnail + map
  - click อนุมัติ to override → row disappears from disputed inbox
- [ ] **18. Manual attendance entry** (browser) — `/admin/attendance/manual` → select test employee → date: today → type: "มาสาย" → duration: 30 → save → confirm appears in `/admin/attendance` with source="คีย์มือ"
- [ ] **19. Profile edit** (phone) — tap 👤 โปรไฟล์ → change phone number to "082-345-6789" → save → confirm "บันทึกแล้ว ✓" affirmation; refresh page → number persists

---

## Section G — Owner view (1 step, ~2 min)

- [ ] **20. Log in as Owner** — sign out → log in with Owner credentials (`goodytong@gmail.com`) → confirm:
  - Redirected to `/owner` (NOT `/admin`)
  - KPI cards render with the test data we just created
  - Attempting to visit `/admin/employees` → 404 page (expected — Owner has no admin access)

---

## ✅ All passed?

Congratulations — Phase 1 is production-ready. You can move on to:
1. **Onboard 2-3 real pilot employees** (Sprint 3.3) — repeat steps 6-11 with their accounts
2. **Watch Sentry + Vercel logs daily** for 1 week (Sprint 3.4)
3. **Customer retrospective** at end of week (Sprint 3.6)

## ❌ Any step failed?

Don't continue to pilot rollout. Investigate the specific failure:
- **Pairing flow broken** → check LIFF Endpoint URL in LINE Console points to `/liff/pair`
- **LINE push doesn't arrive** → check Inngest dashboard for failed runs; verify access token is fresh
- **GPS check-in always Disputed** → check branch lat/lng + radius accurate; check phone GPS accuracy
- **Anything else** → check Vercel runtime logs (NOT browser console — server errors are masked client-side)

---

## Clean-up after UAT

When all tests pass, before inviting real employees:

- [ ] Delete the "Test Branch UAT" branch (or rename)
- [ ] Delete the "UAT Test" employee row
- [ ] Cancel any leave/advance test requests created
- [ ] Verify admin dashboard returns to "0 pending" state

---

_Per launch-plan.md Sprint 3.2._
