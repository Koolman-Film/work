# Runbook — ย้อนกลับการ deploy (code + database)

**ผู้อ่าน:** คน deploy (push ขึ้น `main` แล้ว Vercel build อัตโนมัติ)
**ครอบคลุม:** จะย้อนกลับได้ไหม ย้อนยังไง และอะไรที่ย้อน "โค้ด" แล้วยัง **ไม่** ย้อนตาม

---

## สิ่งที่ต้องรู้ก่อนอย่างอื่น

**คำถามที่ตัดสินทุกอย่างคือ: deploy รอบนี้มี DDL ไหม** (`CREATE` / `ALTER` / `DROP` / `ADD COLUMN` / `RENAME`)

- **ไม่มี DDL** → schema ของ prod กับของใหม่เหมือนกันเป๊ะ โค้ดเก่าอ่าน schema เดิมได้ทันที **ย้อนกลับง่ายมาก** ไม่ต้องแตะฐานข้อมูลเลย
- **มี DDL** → ย้อนโค้ดอย่างเดียวไม่พอ ต้องดูเป็นราย migration ว่าโค้ดเก่ายังทำงานกับ schema ใหม่ได้ไหม (เพิ่มคอลัมน์ nullable มักปลอดภัย, ลบ/เปลี่ยนชื่อคอลัมน์ไม่ปลอดภัย)

เช็คก่อน deploy ทุกครั้ง:

```bash
git diff origin/main..HEAD -- prisma/migrations | grep -iE '^\+.*(CREATE|ALTER|DROP|ADD COLUMN|RENAME)' || echo "ไม่มี DDL — ย้อนกลับปลอดภัย"
```

---

## 1. ย้อนโค้ด

ใช้ **Instant Rollback** ของ Vercel — เลือก production deployment ตัวก่อนหน้าแล้วกด Promote

**สำคัญ:** Instant Rollback **ไม่ build ใหม่** มันแค่ชี้ production ไปที่ build เดิมที่มีอยู่แล้ว แปลว่า:

- `prisma migrate deploy` ใน build script **ไม่ถูกรันซ้ำ** → ไม่มีการพยายาม down-migration (ซึ่ง repo นี้ก็ไม่มีอยู่แล้ว)
- migration ที่รันไปแล้วยังอยู่ในฐานข้อมูล และยังถูกบันทึกใน `_prisma_migrations`

---

## 2. ⚠️ กับดัก: migration ที่แจก permission รันได้ครั้งเดียว

repo นี้มี migration แบบ "backfill permission เข้า `RoleDefinition`" อยู่หลายตัว — `0030`, `0038`, `0040` และจะมีอีกเรื่อย ๆ เพราะ `requirePermission` อ่าน `RoleDefinition.permissions` **จากฐานข้อมูล** ไม่ได้อ่านจาก `SYSTEM_ROLES` ใน `roles.ts` (โค้ดนั้นมีผลตอน seed ใหม่เท่านั้น)

**ลำดับเหตุการณ์ที่ทำให้ฟีเจอร์พังแบบหาสาเหตุยาก:**

1. deploy → migration แจก permission ใหม่ให้ role `admin` เรียบร้อย
2. ย้อนโค้ดกลับ (rollback)
3. มีคนเข้าหน้า **ตั้งค่า → บทบาท** แล้วกดบันทึก role ใด ๆ
4. → permission ใหม่ **หายจากฐานข้อมูล**

ที่หายเพราะ `role-form.tsx` วาด checkbox จาก `PERMISSION_GROUPS` **ในโค้ด** โค้ดเก่าไม่รู้จัก permission ตัวใหม่ จึงไม่มี checkbox → ไม่ถูกส่งมาใน form → `readPermissions()` กรองด้วย `isPermission()` แล้วเขียนทับ array เดิมโดยไม่มีตัวนั้น

5. deploy ใหม่อีกครั้ง → **`prisma migrate deploy` ข้าม migration ตัวนั้น** เพราะบันทึกว่ารันแล้วใน `_prisma_migrations`
6. → แอดมินทุกคนเจอ 404 ที่หน้าฟีเจอร์นั้น ทั้งที่โค้ดถูกต้องและ deploy สำเร็จ

**วิธีแก้:** grant ซ้ำด้วยมือ (idempotent ปลอดภัย รันซ้ำได้)

```sql
UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'PERMISSION_KEY_ที่หาย')
WHERE "key" = 'admin'
  AND NOT ('PERMISSION_KEY_ที่หาย' = ANY("permissions"));
```

> Superadmin ไม่ได้รับผลกระทบ เพราะผ่านด้วย `isSuperadmin` ไม่ได้เช็ค array

**วิธีเลี่ยง:** ถ้า rollback แล้ว **อย่าเพิ่งแตะหน้าตั้งค่าบทบาท** จนกว่าจะ deploy กลับขึ้นไป

---

## 3. ข้อมูลที่เขียนไปแล้วตอนฟีเจอร์ยัง live

ย้อนโค้ดได้ ไม่ได้แปลว่าย้อน **ผลของข้อมูล** ได้ ต้องดูเป็นฟีเจอร์ ๆ ไป

| ข้อมูลที่ถูกเขียน | ย้อนได้ไหม |
|---|---|
| **แก้ประเภทการลา** (`LeaveRequest.leaveTypeId` + `overQuotaMinutes` + `deductAmount` ของตัวเองและ sibling) | ย้อนได้ **ตอนโค้ดยัง live** — แก้กลับเป็นประเภทเดิมได้เลย เพราะ `correct-type.ts` บังคับให้ทั้งต้นทางและปลายทางเป็น `DeductPay` การแก้จึงสมมาตรเสมอ **แต่** ถ้าถูก sweep เข้า payroll แล้ว (`deductedInPayrollId != null`) จะถูกตรึง และถ้า rollback ไปแล้วเครื่องมือจะหายไป ต้องแก้ที่ฐานข้อมูล |
| **Backfill แถว `Late`** (soft-delete / ลด `durationMinutes`) | ย้อนได้ **แม้ rollback แล้ว** — ทุกการแก้เขียน `before: { durationMinutes, deletedAt }` ลง AuditLog และ path `attendance.restore` อยู่ใน `src/lib/attendance/void.ts` ซึ่ง live บน prod อยู่แล้ว กู้ผ่านหน้าแอดมินได้ |
| **แถว AuditLog ที่มี action ใหม่** | ไม่ต้องย้อน — `actionLabel()` เป็น `ACTION_LABELS[action] ?? action` โค้ดเก่าจะแสดง string ดิบ ไม่ crash |
| **ตรรกะการคิดสายแบบใหม่** | rollback มีผลกับการลงเวลา **ในอนาคต** เท่านั้น แถวที่บันทึกถูกต้องไปแล้วยังถูกต้องอยู่ |

---

## 4. เช็คลิสต์ก่อน deploy

1. `git diff origin/main..HEAD -- prisma/migrations` — มี DDL ไหม (ดูข้อ 0)
2. `npm run lint && npm test` ผ่าน
3. `npm run test:integration` ผ่าน (ต้องมี Postgres local ที่ port `54422` — ดู `vitest.integration.config.ts`)
4. ถ้ามี migration ใหม่ → `npm run db:test:deploy` ก่อนรัน integration test
5. จด deployment id ของ production ปัจจุบันไว้ เผื่อต้อง Promote กลับ
6. **งานที่ต้องกดเองหลัง deploy** (migration ไม่ได้ทำให้) เช่น backfill — เว้นระยะไว้อย่างน้อย 1 วัน ให้ path ที่ live ได้พิสูจน์ตัวเองก่อน อย่ารันพร้อม deploy

---

## เกี่ยวข้อง

- `docs/runbooks/penalty-settled-with-leave.md` — แก้ settlement ที่เผยแพร่ไปแล้ว
- `prisma/migrations/0040_leave_correct_type_permission/` — ตัวอย่าง permission backfill ที่เขียนคอมเมนต์อธิบายไว้ครบ
