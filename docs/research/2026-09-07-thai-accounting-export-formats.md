# Thai accounting & statutory export formats — research

**Date:** 2026-09-07
**Question:** what should `/admin/accounting` export, so the data lands cleanly in Thai
accounting software and statutory filings?

**Status: PARTIAL.** Sections 1–3 are verified against primary sources. Sections 4–6 are
explicitly unverified and say so. Nothing in this document is a guessed file layout — where
a spec could not be found, it is marked `NOT FOUND` rather than reconstructed.

---

## 0. The headline

The formats are the easy half. Two findings reorder the work:

1. **ภ.ง.ด.1 does not need a rigid layout from us.** RD Prep — the Revenue Department's own
   data-preparation program — imports a *delimited text file* and lets the user **map columns
   interactively**. We do not have to reverse-engineer a fixed field order; we emit a clean
   pipe-delimited file with a header row and the accountant maps it once. (§1)
2. **What blocks ภ.ง.ด.1 is arithmetic, not serialisation.** We store no withholding tax and
   no employee tax profile, so we cannot fill the two columns that matter. That is a payroll
   feature, not an export feature. (§5)

So the cheap, high-value work is a **GL journal export** and **bank transfer files** — both
buildable from data we already hold. ภ.ง.ด.1 is its own project.

---

## 1. ภ.ง.ด.1 (PND1) — monthly withholding tax on salaries

**Confidence: OFFICIAL** (Revenue Department manual) + **vendor doc** (PEAK) corroborating.

### How filing actually works

The RD's New e-Filing does not take our file directly. The chain is:

```
our export (.txt)  →  RD Prep (desktop program)  →  .RDX file  →  efiling.rd.go.th
```

RD Prep is the RD's own free "โปรแกรมจัดเตรียมข้อมูล". Manual:
<https://efiling.rd.go.th/content/download/RDPrep.pdf> (84 pp., Thai).

### What RD Prep accepts

From the manual, §7 "การโอนย้ายข้อมูล" (p. 55–56), the import wizard is two steps:

- **Step 1 — รูปแบบการแบ่งข้อมูล.** The user chooses one of:
  - `แบ่งแยกข้อมูลด้วยสัญลักษณ์` — delimiter-separated, and the user picks the symbol
  - `แบ่งแยกข้อมูลด้วยตำแหน่งตัวอักษร` — fixed character positions
  There is a toggle for **"เปิดให้บรรทัดแรกคือชื่อคอลัมน์"** (first row is column names).
- **Step 2 — กำหนดตำแหน่งข้อมูล.** The user drags fields to map file columns onto RD Prep
  fields.

**This is the key fact: the column order is not fixed by the RD.** Any consistent delimited
file works, because mapping happens in the tool.

### The ใบแนบ ภ.ง.ด.1 field set

Verbatim from the manual (p. 22, "ให้ผู้ใช้งานบันทึกรายละเอียดใบแนบ ภ.ง.ด.1 ดังนี้"):

| # | Field | Notes |
|---|---|---|
| 1 | ประเภทเงินได้ | 40(1) salary — general; 40(1)(2) one-off on leaving employment; 40(2) resident; 40(2) non-resident |
| 2 | เลขประจำตัวผู้เสียภาษีอากร | the employee's 13-digit ID |
| 3 | คำนำหน้าชื่อ | title |
| 4 | ชื่อ | first name |
| 5 | ชื่อกลาง | middle name |
| 6 | ชื่อสกุล | last name |
| 7 | วันเดือนปีที่จ่าย | payment date |
| 8 | จำนวนเงินได้ที่จ่าย | gross income paid |
| 9 | จำนวนเงินภาษีที่หัก | tax withheld |
| 10 | เงื่อนไขการหักภาษี | หัก ณ ที่จ่าย / ออกให้ตลอดไป / ออกให้ครั้งเดียว |

### Corroboration — what PEAK emits

PEAK's payroll module exports exactly this file. Its manual
(<https://www.peakaccount.com/peak-manual/peak-payroll/pnd1-pnd1a-payroll-summary/transferring-text-file-pnd1-to-rd-prep-program>)
instructs the user to:

- select the delimiter **`|` (pipe)**
- map **11 positions, 0 through 10** — position 10 being เงื่อนไขการหักภาษี
- set the payment-date field to format **`dd/mm/yyyy`**

11 slots for 10 fields suggests a leading sequence/row number, but the PEAK page does not
name the columns, so **the exact 11th column is unconfirmed**.

> **Unresolved:** whether `dd/mm/yyyy` carries a Buddhist (พ.ศ. 2569) or Gregorian (2026)
> year. RD forms are conventionally พ.ศ., but neither source states it explicitly. Must be
> confirmed against a real RD Prep run before shipping.

### Recommendation

Emit **pipe-delimited UTF-8 `.txt` with a header row**, columns in the order above. Ship it
only once withholding tax exists (§5).

---

## 2. สปส.1-10 — SSO monthly contributions

**Confidence: OFFICIAL for the workflow, `NOT FOUND` for the file layout.**

SSO e-Services (<https://www.sso.go.th/eservices/esv/login.do>) offers three submission
methods under "ส่งข้อมูลเงินสมทบ", per the official manual
(<https://www.sso.go.th/eservices/web/UserManual.pdf> §3, p. 17–24):

1. `การชำระเงินสมทบแบบกรอกข้อมูล` — type each insured person in the browser
2. **`การชำระเงินสมทบแบบแนบไฟล์`** — upload a file; the user first picks
   **"ประเภทไฟล์ข้อมูล"** (data file type) from a selector, then Choose File
3. reuse a previously submitted month's return

Two forms exist: **สปส.1-10** (single establishment) and **สปส.1-10/1** (multiple branches
filed together).

> **`NOT FOUND`.** The official manual documents the *UI flow only*. It never publishes the
> field layout, nor enumerates which file types the "ประเภทไฟล์ข้อมูล" selector offers. The
> layout is presumably shown in-app at upload time. **Do not guess it.**

### What this means for us

We already export สปส.1-10 as **XLSX** — see
`src/app/(admin)/admin/filings/sso/export/route.ts`. (Written as a code span, not a link:
the route group `(admin)` contains parentheses, which terminate a markdown link target early
and silently produce a broken link.)
That is useful to an accountant as a working document, but it is **not established** that it
is an accepted e-Services upload type. Worth confirming with whoever files: are they typing
our numbers in by hand, or uploading?

Also note **สปส.1-10/1 (multi-branch)** — our export is per-branch, which matches the
separate-companies structure, but if two branches ever share a legal entity this form is the
one they need.

---

## 3. What our data model is missing

Checked directly against `prisma/schema.prisma`.

| Missing | Blocks | Severity |
|---|---|---|
| **Withholding tax** — no field on `Payroll`, no tax config, no employee tax profile (ลดหย่อน, dependants, provident fund, marital status) | ภ.ง.ด.1, ภ.ง.ด.1ก, 50 ทวิ — **all of them, completely** | Critical |
| **Company tax ID** (เลขประจำตัวผู้เสียภาษี, 13-digit). `Branch` has `ssoAccountNo`, `payslipNameNative/En`, `address` — but no tax ID | every RD filing | Critical |
| **Chart-of-accounts mapping.** `AccountingGroup.peakCode` is one string per group | a GL journal needs a **debit and a credit** account per line kind — salary expense, SSO payable, WHT payable, net-pay-to-bank | High |
| **Employer SSO contribution.** `deductSso` is the employee's 5% only | สปส.1-10 shows both sides; the GL entry needs the employer expense. Derivable, but not recorded | Medium |
| **Payment record.** `Payroll` has `status` + `publishedAt`, but no paid-on date, bank reference, or batch | a journal entry needs the payment date; a bank file needs a batch identity | Medium |

Present and usable today: `Bank.code` (national clearing code), `bankAccountNumber`,
`bankAccountName`, `nationalId`, `hasSso`, and the full income/deduction breakdown.

**Structural note.** The branches are *separate registered companies*, so per-branch export
is correct and each branch needs **its own tax ID field**. A `Company` model is not required;
adding `taxId` to `Branch` is enough. This should be recorded, because a future shared-entity
branch would break the assumption.

---

## 4. Accounting packages — NOT YET VERIFIED

Deliberately left unverified rather than filled with plausible-looking detail.

| Package | Status |
|---|---|
| **Express** (โปรแกรมบัญชี Express) | Vendor is **express.co.th** (not express-soft.com). Dealers advertise a *service* to import master data from Excel, which implies no self-serve documented import. **`NOT FOUND`** — no public field spec located. Express's TIS-620 reputation is widely repeated but I did not confirm it from a primary source. |
| **FlowAccount** | Publishes RD Prep guides for ภ.ง.ด.1 and ภ.ง.ด.3/53 (<https://flowaccount.com/blog/rd-prep-pnd1/>), so it emits the same text file. Whether it *imports* a payroll GL journal: **not verified**. |
| **PEAK** | Has its own payroll module; documented ภ.ง.ด.1 export (§1). Whether it imports an external payroll journal: **not verified**. Our `AccountingGroup.peakCode` implies someone already intended a PEAK path — worth asking what that was for. |
| SMEMove | Publishes an RD Prep guide (<https://help.smemove.com/knowledge-base/1-rd-prep/>). Otherwise not investigated. |
| AccRevo, Business Plus/BPLUS, Prosoft WINSpeed, Formula, MAC-5, CD Organizer | Not investigated. |
| Xero, QuickBooks | Not investigated; their Thai market share is the open question, not their import format. |

---

## 5. Bank direct-credit payroll files — NOT RESEARCHED

SCB, KBANK (K-Cash Connect), BBL, KTB, TTB, Krungsri. **I did not verify any of these.**

Expect most layouts to be available only to enrolled corporate customers. The honest next
step is to ask whoever operates the company bank accounts to send the spec their bank gave
them, rather than searching for it.

This is nonetheless the **cheapest high-value export we could build**, because the data
(`Bank.code`, `bankAccountNumber`, `bankAccountName`, `netPay`) already exists.

---

## 6. What I could not verify

- Whether RD Prep's `dd/mm/yyyy` expects พ.ศ. or ค.ศ. (§1)
- The 11th column in PEAK's pipe-delimited ภ.ง.ด.1 file (§1)
- Any SSO upload file layout, or which file types the selector accepts (§2)
- Any accounting package's import field spec (§4)
- Any bank's direct-credit layout (§5)
- Encoding requirements anywhere — TIS-620 vs UTF-8 — from a primary source
- ภ.ง.ด.1ก (annual) and 50 ทวิ content requirements
- Whether e-Tax Invoice / e-Receipt / PEPPOL touch payroll at all

## Sources

- <https://efiling.rd.go.th/content/download/RDPrep.pdf> — RD Prep manual v1.0 (OFFICIAL)
- <https://www.sso.go.th/eservices/web/UserManual.pdf> — SSO e-Services manual (OFFICIAL)
- <https://www.peakaccount.com/peak-manual/peak-payroll/pnd1-pnd1a-payroll-summary/transferring-text-file-pnd1-to-rd-prep-program> — PEAK (vendor doc)
- <https://flowaccount.com/blog/rd-prep-pnd1/> — FlowAccount (vendor blog)
- <https://help.smemove.com/knowledge-base/1-rd-prep/> — SMEMove (vendor doc)
- <https://express.co.th/> — Express vendor site
</content>
