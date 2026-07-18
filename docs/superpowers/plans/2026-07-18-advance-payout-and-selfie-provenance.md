# Advance Payout Details + Selfie Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้คนจ่ายเงินเห็นเลขบัญชีบนหน้าจ่าย, ทำให้แนบสลิปเป็นทางเลือกไม่ใช่บังคับ, และติดธง "ต้องตรวจสอบ" ให้เช็คอินที่รูปเซลฟี่ไม่ได้มาจากกล้องสด

**Architecture:** ขยาย select ของหน้าเบิกเงินให้ดึงข้อมูลธนาคาร, เปลี่ยน `receiptKey` ใน `markAdvancePaid` เป็น optional, และเพิ่มธง `selfieCapture` จาก client เข้าไปมีผลกับ `checkInStatus`

**Tech Stack:** Next.js 16 App Router, Prisma/Postgres, Vitest (node env — ไม่มี jsdom), Tailwind v4, next-intl (6 ภาษา), Biome

**Spec:** `docs/superpowers/specs/2026-07-18-advance-payout-and-selfie-provenance-design.md`

## Global Constraints

- **ห้ามแก้ schema / migration** — แก้ได้เฉพาะ *คอมเมนต์* ใน `schema.prisma:618`
- **ห้ามแตะ** `src/lib/payroll/**` และสูตรการหักเงินใด ๆ
- **ห้ามบังคับ** ให้คนอนุมัติกับคนจ่ายเป็นคนละคน (เป็นนโยบายที่ยังไม่ตัดสิน)
- **ห้ามตัดเส้นทางสำรองของกล้องทิ้ง** — งานนี้ *ติดธง* ไม่ใช่ *ปิดกั้น*
- **ธงเซลฟี่ต้องเพิ่มการตรวจสอบได้อย่างเดียว ห้ามลดทอน** — ถ้า GPS ตัดสิน `Disputed` อยู่แล้ว ต้องคงเหตุผลของ GPS ไว้ ห้ามเขียนทับด้วยเหตุผลเรื่องเซลฟี่
- คง gate เดิมทุกตัวใน `markAdvancePaid`: `requirePermission('advance.approve')`, branch scope, ต้อง `status='Approved'`, audit log
- ข้อความผู้ใช้ฝั่งแอดมินเป็นภาษาไทย; ฝั่ง LIFF ใช้ `t()` (6 ภาษา, เพิ่ม key ที่ th + en พอ ที่เหลือ fallback)
- Vitest รันบน **node** — ไม่มี jsdom / testing-library
- `pnpm test` ต้องผ่านทั้งหมดก่อนจบแต่ละ task (ฐานปัจจุบัน 1282)

## File Structure

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `src/lib/advance/admin.ts` | แก้ | `receiptKey` เป็น optional; `paidAt` ไม่ผูกกับสลิป |
| `src/lib/advance/mark-paid.test.ts` | แก้ | เพิ่มเคสจ่ายโดยไม่มีสลิป |
| `prisma/schema.prisma` | แก้ **คอมเมนต์เท่านั้น** | บรรทัด 618 ไม่จริงอีกต่อไป |
| `src/app/(liff)/liff/admin/advance/[id]/_load.ts` | แก้ | select ข้อมูลธนาคาร |
| `src/app/(liff)/liff/admin/advance/[id]/page.tsx` | แก้ | บล็อกบัญชีปลายทาง + ปุ่มจ่ายโดยไม่ต้องแนบสลิป |
| `src/app/(liff)/liff/admin/advance/[id]/advance-review-actions.tsx` | แก้ | ปุ่ม "บันทึกว่าจ่ายแล้ว" |
| `src/app/(admin)/admin/advance/advance-row-vm.ts` | แก้ | select `paidAt` + ธนาคาร ลง VM |
| `src/app/(admin)/admin/advance/advance-review-modal.tsx` | แก้ | แสดงบัญชีปลายทาง |
| `src/lib/attendance/selfie-provenance.ts` | **สร้าง** | pure fn ตัดสิน status/reason จาก verdict + ธง |
| `src/lib/attendance/selfie-provenance.test.ts` | **สร้าง** | unit tests |
| `src/lib/attendance/check-in.ts` | แก้ | รับ `selfieCapture`, ใช้ pure fn |
| `src/app/(liff)/liff/check-in/selfie-step.tsx` | แก้ | ส่งวิธีจับภาพกลับไปให้ parent |
| `src/app/(liff)/liff/check-in/check-in-client.tsx` | แก้ | ส่งต่อเข้า `submitCheckIn` |
| `messages/th.json`, `messages/en.json` | แก้ | key `checkin.disputeReason.selfieFallback` |

---

### Task 1: `markAdvancePaid` — แนบสลิปเป็นทางเลือก

**Files:**
- Modify: `src/lib/advance/admin.ts`
- Modify: `src/lib/advance/mark-paid.test.ts`
- Modify: `prisma/schema.prisma` (คอมเมนต์บรรทัด ~618 เท่านั้น)

**Interfaces:**
- Produces: `markAdvancePaid({ cashAdvanceId, receiptKey?: string | null })` — Task 2 เรียกใช้

**บริบท:** ปัจจุบัน `paidAt` ถูกเซ็ตอยู่ใน `update` เดียวกับ `receiptUrl` (`admin.ts:390-393`) จึงไม่มีทางไปถึงสถานะจ่ายแล้วโดยไม่แนบไฟล์ ลูกค้าขอว่า *"แนบสลิปโอนเงิน (ไม่บังคับ)"*

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

เพิ่มใน `src/lib/advance/mark-paid.test.ts` **ภายใน `describe('markAdvancePaid')`
ที่มีอยู่แล้ว** โดยใช้ harness เดิมของไฟล์ (`txFindUnique`, `txUpdate`,
`approvedRow()`, `VALID_KEY`) — ห้ามสร้าง mock ชุดใหม่:

```ts
  it('no slip supplied → paidAt set, receiptUrl left alone', async () => {
    txFindUnique.mockResolvedValue(approvedRow());

    const r = await markAdvancePaid({ cashAdvanceId: 'ca-1' });

    expect(r).toEqual({ ok: true });
    const data = txUpdate.mock.calls[0]![0]!.data;
    expect(data.paidAt).toBeInstanceOf(Date);
    expect('receiptUrl' in data).toBe(false);
  });

  it('slip attached later → receiptUrl written, paidAt not moved', async () => {
    txFindUnique.mockResolvedValue(
      approvedRow({ paidAt: new Date('2026-06-01T00:00:00Z') }),
    );

    const r = await markAdvancePaid({ cashAdvanceId: 'ca-1', receiptKey: VALID_KEY });

    expect(r).toEqual({ ok: true });
    const data = txUpdate.mock.calls[0]![0]!.data;
    expect(data.receiptUrl).toBe(VALID_KEY);
    expect('paidAt' in data).toBe(false);
  });

  it('explicit null receiptKey behaves like no slip', async () => {
    txFindUnique.mockResolvedValue(approvedRow());

    const r = await markAdvancePaid({ cashAdvanceId: 'ca-1', receiptKey: null });

    expect(r).toEqual({ ok: true });
    const data = txUpdate.mock.calls[0]![0]!.data;
    expect(data.paidAt).toBeInstanceOf(Date);
    expect('receiptUrl' in data).toBe(false);
  });
```

เทสต์เดิมในไฟล์ที่ส่ง `receiptKey: VALID_KEY` มาต้องยังผ่านโดยไม่ต้องแก้ —
เป็นการยืนยันว่าการเปลี่ยนนี้ *ผ่อนคลาย* กฎ ไม่ได้เปลี่ยนพฤติกรรมเดิม

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/lib/advance/mark-paid.test.ts`
Expected: เคสใหม่ FAIL (ตอนนี้ `receiptKey` ยังบังคับ)

- [ ] **Step 3: แก้ `markAdvancePaid`**

เปลี่ยน signature และตรรกะ:

```ts
export async function markAdvancePaid(input: {
  cashAdvanceId: string;
  /**
   * Optional — the customer asked for the slip to be evidence, not a gate
   * ("แนบสลิปโอนเงิน (ไม่บังคับ)"). Money can be recorded as sent first and
   * the slip attached later, or never.
   */
  receiptKey?: string | null;
}): Promise<MarkPaidResult> {
  const { user, authUserId } = await requirePermission('advance.approve');
  const permitted = await getPermittedBranches(user, 'advance.approve');

  const key = input.receiptKey?.trim() || null;
  // Validate the path only when a slip is actually supplied.
  if (key && !/^https?:\/\//i.test(key) && !key.startsWith(`${authUserId}/advance-receipts/`)) {
    return { ok: false, code: 'forbidden', message: 'ลิงก์สลิปไม่ถูกต้อง' };
  }
  ...
```

และในทรานแซกชัน เปลี่ยนการเขียนเป็น:

```ts
      const firstAttach = row.paidAt === null;
      await tx.cashAdvance.update({
        where: { id: row.id },
        data: {
          // paidAt marks "money sent" on its own now — it no longer waits
          // for a slip. Set once; a later slip upload never moves it.
          ...(firstAttach ? { paidAt: new Date() } : {}),
          ...(key ? { receiptUrl: key } : {}),
        },
      });
```

- [ ] **Step 4: แก้คอมเมนต์ใน schema**

ใน `prisma/schema.prisma` ราวบรรทัด 617-620 เปลี่ยนคอมเมนต์ที่บอกว่า
`receiptUrl + paidAt together mean "money sent"` เป็น:

```prisma
  /// `paidAt` alone means "money sent" — the transfer slip is optional
  /// evidence the admin may attach before, after, or never. Set once;
  /// re-uploading a slip replaces receiptUrl but never moves paidAt.
```

**ห้ามแก้ชนิดข้อมูลหรือชื่อคอลัมน์** — แก้คอมเมนต์เท่านั้น จึงไม่เกิด migration

- [ ] **Step 5: รันเทสต์**

Run: `npx vitest run src/lib/advance/` แล้วตามด้วย `pnpm test`
Expected: ผ่านทั้งหมด (เทสต์เดิมที่ส่ง `receiptKey` มาต้องยังผ่าน)

- [ ] **Step 6: ตรวจว่าไม่เกิด migration**

Run: `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --exit-code || true`
Expected: ไม่มีความต่างเชิงโครงสร้าง (คอมเมนต์ไม่นับ)

- [ ] **Step 7: Commit**

```bash
git add src/lib/advance/admin.ts src/lib/advance/mark-paid.test.ts prisma/schema.prisma
git commit -m "feat(advance): make the transfer slip optional when marking paid"
```

---

### Task 2: แสดงบัญชีปลายทางบนหน้าจ่ายเงิน

**Files:**
- Modify: `src/app/(liff)/liff/admin/advance/[id]/_load.ts`
- Modify: `src/app/(liff)/liff/admin/advance/[id]/page.tsx`
- Modify: `src/app/(liff)/liff/admin/advance/[id]/advance-review-actions.tsx`
- Modify: `src/app/(admin)/admin/advance/advance-row-vm.ts`
- Modify: `src/app/(admin)/admin/advance/advance-review-modal.tsx`

**Interfaces:**
- Consumes: `markAdvancePaid` จาก Task 1 (`receiptKey` optional แล้ว)

**บริบท:** ลูกค้าขอ *"แสดงข้อมูลธนาคาร เลขบัญชี ชื่อบัญชี"* บนขั้นตอนจ่ายเงิน
ฟิลด์อยู่บน `Employee` (`schema.prisma:405-408`) + โมเดล `Bank` มี `nameTh`/`shortName`
**การจ่ายเงินจริงเกิดที่หน้า LIFF admin เท่านั้น** (`markAdvancePaid` ถูกเรียกจาก
`advance-review-actions.tsx:132` ที่เดียว) — ฝั่งเว็บแอดมินไม่มีปุ่มจ่าย แต่ใส่ให้ด้วย
เพราะคนอนุมัติควรเห็นว่าปลายทางมีข้อมูลครบก่อนกดอนุมัติ

- [ ] **Step 1: ขยาย select ทั้งสองฝั่ง**

ใน `_load.ts` เพิ่มใน `ADVANCE_DETAIL_SELECT`:

```ts
  employee: {
    select: {
      firstName: true, lastName: true, nickname: true,
      bankAccountNumber: true,
      bankAccountName: true,
      bank: { select: { nameTh: true, shortName: true } },
    },
  },
```

ใน `advance-row-vm.ts` เพิ่มใน `ADVANCE_SELECT`: `paidAt: true` และบล็อก
`employee.select` เดียวกัน (คงฟิลด์ `branch`/`department` เดิมไว้)

- [ ] **Step 2: แสดงบล็อก "โอนเข้าบัญชี"**

ใน `page.tsx` วางไว้**เหนือ**ส่วนแนบสลิป (ก่อน `{awaitingSlip && ...}`) เพื่อให้
คนจ่ายเห็นเลขบัญชีก่อนที่จะกดจ่าย:

```tsx
      <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {t('payoutAccount')}
        </h2>
        {row.employee.bankAccountNumber ? (
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">{t('payoutBank')}</dt>
              <dd className="font-medium">
                {row.employee.bank?.nameTh ?? row.employee.bank?.shortName ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">{t('payoutAccountNo')}</dt>
              <dd className="font-medium tabular-nums">{row.employee.bankAccountNumber}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">{t('payoutAccountName')}</dt>
              <dd className="font-medium">{row.employee.bankAccountName ?? '—'}</dd>
            </div>
          </dl>
        ) : (
          // Never render an empty block: the payer must be able to tell
          // "no data entered" apart from "the screen is broken".
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            {t('payoutAccountMissing')}
          </p>
        )}
      </section>
```

เพิ่ม key ที่ `messages/th.json` + `en.json` ใต้ `liffAdmin.advanceDetail`:
`payoutAccount` = "โอนเข้าบัญชี", `payoutBank` = "ธนาคาร",
`payoutAccountNo` = "เลขบัญชี", `payoutAccountName` = "ชื่อบัญชี",
`payoutAccountMissing` = "ยังไม่ได้กรอกข้อมูลบัญชีธนาคารของพนักงานคนนี้ — ต้องกรอกก่อนโอน"

- [ ] **Step 3: ปุ่ม "บันทึกว่าจ่ายแล้ว" ที่ไม่ต้องแนบไฟล์**

ใน `advance-review-actions.tsx` เพิ่ม component:

```tsx
export function MarkPaidButton({ cashAdvanceId, label }: { cashAdvanceId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            // No receiptKey — the slip is optional and can be attached later.
            const result = await markAdvancePaid({ cashAdvanceId });
            if (result.ok) router.refresh();
            else setError(result.message);
          })
        }
        className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? '...' : label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
```

ใน `page.tsx` แสดงปุ่มนี้เมื่อ `awaitingSlip` (อนุมัติแล้วแต่ยังไม่จ่าย) **คู่กับ**
`SlipUploadBlock` เดิม — ให้แอดมินเลือกได้ว่าจะจ่ายเฉย ๆ หรือจ่ายพร้อมแนบสลิป
key ใหม่: `markPaidButton` = "บันทึกว่าจ่ายแล้ว (ไม่แนบสลิป)"

- [ ] **Step 4: ฝั่งเว็บแอดมิน**

ใน `advance-review-modal.tsx` แสดงบล็อกบัญชีปลายทางแบบเดียวกัน (ภาษาไทยตรง ๆ
ไม่ผ่าน `t()` เพราะฝั่งแอดมินถูก pin เป็นไทยแล้ว) และใช้ `paidAt` ที่เพิ่ง select
มาเพื่อแยกป้ายสถานะ "รอจ่ายเงิน" กับ "จ่ายเงินแล้ว"

- [ ] **Step 5: ตรวจ gates + เทสต์**

Run: `npx tsc --noEmit && npx biome check --write` บนไฟล์ที่แก้ แล้ว `pnpm test`
Expected: ผ่านทั้งหมด

- [ ] **Step 6: Commit**

```bash
git add "src/app/(liff)/liff/admin/advance" "src/app/(admin)/admin/advance" messages/
git commit -m "feat(advance): show the payout bank account on the payment screens"
```

---

### Task 3: ติดธงเช็คอินที่รูปไม่ได้มาจากกล้องสด

**Files:**
- Create: `src/lib/attendance/selfie-provenance.ts`
- Create: `src/lib/attendance/selfie-provenance.test.ts`
- Modify: `src/lib/attendance/check-in.ts`
- Modify: `src/app/(liff)/liff/check-in/selfie-step.tsx`
- Modify: `src/app/(liff)/liff/check-in/check-in-client.tsx`
- Modify: `messages/th.json`, `messages/en.json`

**บริบท:** `selfie-step.tsx` ใช้กล้องสดเป็นทางหลัก แต่เมื่อ `getUserMedia` ล้มเหลว
จะ fallback ไป `<input type="file" capture="user">` (บรรทัด 282-290) ซึ่งบางเครื่อง
เลือกจากแกลเลอรีได้ ตอนนี้ไม่มีการบันทึกเลยว่าเช็คอินไหนมาทางไหน

**ข้อจำกัดที่ยอมรับแล้ว:** ธงมาจาก client จึงเป็นเครื่องมือ *ตรวจจับ* ไม่ใช่
*บังคับ* — เขียนไว้ในคอมเมนต์ให้ชัด อย่าโฆษณาเกินจริง

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `src/lib/attendance/selfie-provenance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveCheckInStatus } from './selfie-provenance';

const GPS_OK = { status: 'Confirmed' as const };
const GPS_BAD = { status: 'Disputed' as const, reason: 'อยู่นอกพื้นที่สาขา (geofence)' };

describe('resolveCheckInStatus', () => {
  it('live capture + good GPS → Confirmed, no reason', () => {
    expect(resolveCheckInStatus(GPS_OK, 'live', true)).toEqual({
      status: 'Confirmed', disputeReason: null,
    });
  });

  it('fallback capture + good GPS → Disputed with the selfie reason', () => {
    const r = resolveCheckInStatus(GPS_OK, 'fallback', true);
    expect(r.status).toBe('Disputed');
    expect(r.disputeReason).toContain('กล้องสด');
  });

  it('fallback capture + bad GPS keeps the GPS reason (never overwritten)', () => {
    expect(resolveCheckInStatus(GPS_BAD, 'fallback', true)).toEqual({
      status: 'Disputed', disputeReason: GPS_BAD.reason,
    });
  });

  it('fallback but no selfie on file → not flagged', () => {
    expect(resolveCheckInStatus(GPS_OK, 'fallback', false)).toEqual({
      status: 'Confirmed', disputeReason: null,
    });
  });

  it('missing capture info is treated as live (older clients)', () => {
    expect(resolveCheckInStatus(GPS_OK, undefined, true).status).toBe('Confirmed');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/lib/attendance/selfie-provenance.test.ts`
Expected: FAIL — `Cannot find module './selfie-provenance'`

- [ ] **Step 3: เขียน implementation**

สร้าง `src/lib/attendance/selfie-provenance.ts`:

```ts
/**
 * Decide the stored check-in status once the GPS verdict and the selfie's
 * provenance are both known.
 *
 * The selfie flag can only ever ADD scrutiny, never remove it: when GPS has
 * already disputed the check-in, its reason is kept, because "you were
 * outside the branch" is more specific and more actionable than "the photo
 * may not be live".
 *
 * The flag is reported by the client, so a determined cheat can lie about
 * it. This is a DETECTION aid, not enforcement — it raises the bar from
 * "tap Deny on the camera prompt" to "tamper with the request". Blocking
 * outright would mean removing the fallback, which is a separate decision.
 */

export type SelfieCapture = 'live' | 'fallback';

export const SELFIE_FALLBACK_REASON = 'รูปเซลฟี่ไม่ได้มาจากกล้องสด — อาจเลือกจากแกลเลอรี';

type GpsVerdict = { status: 'Confirmed' } | { status: 'Disputed'; reason: string };

export function resolveCheckInStatus(
  verdict: GpsVerdict,
  capture: SelfieCapture | undefined,
  hasSelfie: boolean,
): { status: 'Confirmed' | 'Disputed'; disputeReason: string | null } {
  if (verdict.status === 'Disputed') {
    return { status: 'Disputed', disputeReason: verdict.reason };
  }
  // Only meaningful when a selfie was actually stored — branches that don't
  // require one must not be flagged.
  if (capture === 'fallback' && hasSelfie) {
    return { status: 'Disputed', disputeReason: SELFIE_FALLBACK_REASON };
  }
  return { status: 'Confirmed', disputeReason: null };
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run src/lib/attendance/selfie-provenance.test.ts`
Expected: PASS ทุกเคส

- [ ] **Step 5: ต่อเข้ากับ `check-in.ts`**

เพิ่มใน `SubmitCheckInInput` (บรรทัด ~84):

```ts
  /** How the selfie was obtained — see selfie-provenance.ts on trust. */
  selfieCapture?: SelfieCapture;
```

แทนที่บรรทัด ~216 (`const disputeReason = ...`) ด้วย:

```ts
  const { status: checkInStatus, disputeReason } = resolveCheckInStatus(
    verdict.status === 'Disputed'
      ? { status: 'Disputed', reason: disputeReasonText(verdict.reason) }
      : { status: 'Confirmed' },
    input.selfieCapture,
    selfieKey != null,
  );
```

แล้วเปลี่ยนที่เขียนลง DB (บรรทัด ~285) จาก `checkInStatus: verdict.status`
เป็น `checkInStatus` ตัวใหม่ **ห้ามแก้ `verdict` เอง** — ตรรกะ GPS ต้องไม่เปลี่ยน

ข้อความผลลัพธ์ฝั่ง LIFF (บรรทัด ~390-400): เพิ่มกรณีที่ `disputeReason ===
SELFIE_FALLBACK_REASON` → `t('disputeReason.selfieFallback')`

- [ ] **Step 6: ฝั่ง client ส่งธงมา**

`selfie-step.tsx` — เปลี่ยน prop:

```ts
  onConfirm: (file: File, capture: SelfieCapture) => void;
```

และใน `confirm()`:

```ts
  function confirm() {
    if (!captured) return;
    onConfirm(captured, cameraFailed ? 'fallback' : 'live');
  }
```

`check-in-client.tsx` — เก็บค่าที่ได้จาก `onConfirm` แล้วส่งเข้า
`submitCheckIn({ ..., selfieCapture })` ที่บรรทัด ~143

- [ ] **Step 7: เพิ่ม i18n**

`messages/th.json` ใต้ `checkin.disputeReason` เพิ่ม:
`"selfieFallback": "รูปเซลฟี่ไม่ได้มาจากกล้องสด — แอดมินจะตรวจสอบ"`
`messages/en.json`: `"selfieFallback": "Selfie was not taken with the live camera — an admin will review it"`

- [ ] **Step 8: ตรวจ gates + เทสต์เต็ม**

Run: `npx tsc --noEmit && npx biome check --write` บนไฟล์ที่แก้ แล้ว `pnpm test`
Expected: ผ่านทั้งหมด ไม่มี regression

- [ ] **Step 9: Commit**

```bash
git add src/lib/attendance "src/app/(liff)/liff/check-in" messages/
git commit -m "feat(attendance): flag check-ins whose selfie bypassed the live camera"
```

---

## Verification (หลังครบทุก task)

- [ ] `pnpm test` + `pnpm test:integration` ผ่านทั้งหมด
- [ ] `npx tsc --noEmit` และ `npx biome check` สะอาด
- [ ] `git diff --name-only` ไม่มีไฟล์ใน `prisma/migrations/`
- [ ] Browser smoke:
  - หน้าจ่ายเงินเบิกแสดง ธนาคาร / เลขบัญชี / ชื่อบัญชี
  - พนักงานที่ไม่มีข้อมูลธนาคาร → เห็นข้อความเตือนสีเหลือง ไม่ใช่ช่องว่าง
  - กด "บันทึกว่าจ่ายแล้ว (ไม่แนบสลิป)" → สถานะเปลี่ยนเป็นจ่ายแล้ว
  - แนบสลิปทีหลัง → `paidAt` ไม่ขยับ
