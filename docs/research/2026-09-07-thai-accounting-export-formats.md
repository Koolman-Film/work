# Thai accounting-software import formats & statutory payroll filing formats

**Research date:** 2026-09-07 · **For:** export targets for this HR/payroll SaaS · **Status:** research, not a design

> **Supersedes the shorter draft committed earlier today** (`3326697`). Everything that draft
> left open in its "could not verify" list is now answered except the RD Prep run and the file
> encodings — see §8. Its three unique contributions are carried forward: the PEAK→RD Prep
> corroboration (§1.1), the "branches are separate registered companies" structural note
> (§7.1, §7.6), and the markdown caveat below.
>
> *Markdown caveat, learned the hard way:* write route paths in the `(admin)` route group as
> **code spans**, never as link targets — the parentheses terminate a markdown link early and
> silently produce a broken link.

Confidence legend used throughout:

| Tag | Meaning |
| --- | --- |
| `OFFICIAL` | Primary source — government site/PDF, or the vendor's own documentation |
| `VENDOR-SUPPORT` | Vendor help-centre / support-article (first-party but not a spec) |
| `THIRD-PARTY` | Blog, reseller, integrator write-up |
| `HEARSAY` | Forum / unattributed |
| `NOT FOUND` | Could not be verified from any source |

---

## 0. Prioritised recommendation list

### (a) Statutory / legally required

| # | Format | Why | Spec status | Effort |
| --- | --- | --- | --- | --- |
| **A1** | **ภ.ง.ด.1 — FORMAT กลาง V2.0** pipe-delimited `.txt` | Monthly WHT on salaries. **Paper filing abolished**; electronic only. Every employer needs it every month. | `OFFICIAL` — **complete field layout obtained** | Blocked on a withholding-tax field (§3.1) |
| **A2** | **ภ.ง.ด.1ก — same file, `TAX_TYPE=PND1A`** | Annual summary. Same parser, three field-value differences. | `OFFICIAL` — same spec | Small delta on A1 |
| **A3** | **FUND CSV for ภ.ง.ด.1ก** (`FUND_PND1A_<TIN13>_<พ.ศ.>.csv`) | **This is the provident-fund reporting format.** 5 columns. | `OFFICIAL` | Blocked on a PF field |
| **A4** | **สปส.1-10 — "Format เงินสมทบ 135" fixed-width `.txt`** *and* the **official Excel template** | Monthly SSO. **Layout found and independently verified** (§1.5). Our current XLSX export does **not** match the official Excel template's columns. | `OFFICIAL` — **complete 135-char layout obtained** | Excel template is ~a day; text file is small |
| **A5** | **50 ทวิ (WHT certificate)** | Must be issued to every employee. RD ships a free generator; no import schema needed. | `OFFICIAL` (program, not a data spec) | Render as PDF ourselves |

### (b) High value because a named popular package accepts it

| # | Format | Why | Spec status |
| --- | --- | --- | --- |
| **B1** | **PEAK `POST /api/v1/dailyjournals`** | Repo already assumes PEAK (`AccountingGroup.peakCode`). Real, documented JSON API with `accountCode`/`debit`/`credit`. | `OFFICIAL` — full schema |
| **B2** | **FlowAccount `POST /journal-entries/approve`** | Documented JSON, verbatim example body. Cheapest real integration on this list. | `OFFICIAL` — verbatim body |
| **B3** | **SCB Business Anywhere payroll Excel template** | Bank direct-credit. SCB publishes a field-by-field manual publicly. | `OFFICIAL` — field descriptions, not widths |
| **B4** | **Generic GL journal CSV** (see B7) | One CSV shape that Xero / QBO / SMEMove / PEAK-import all accept with a column rename. | `OFFICIAL` for Xero + QBO + SMEMove |
| **B5** | **PEAK / FlowAccount employee-master import** | Onboarding a customer who already runs PEAK Payroll or FlowAccount Payroll. | `VENDOR-SUPPORT` — no published columns |
| **B6** | **KBANK Bulk Gateway text file** | Second-most-common payroll bank. | ⚠️ spec is **inside the logged-in portal** |
| **B7** | **ttb business ONE `SAPFORMAT NEW`** | ttb's own Web Converter builds the file from pasted Excel — we can target the *converter's* input. | `OFFICIAL` for the upload settings; layout `NOT FOUND` |

### (c) Generic fallbacks

| # | Format | Notes |
| --- | --- | --- |
| **C1** | **Xero Manual Journal CSV / API** | Fully public schema. Good canonical internal GL shape even if no customer uses Xero. |
| **C2** | **QuickBooks Online journal CSV** | 6 documented headers. |
| **C3** | **Plain XLSX payroll register** | The universal fallback — every package on the second tier ingests "an Excel the accountant retypes". |
| **C4** | **Express** | ⛔ **Do not build an Express journal export.** Express has no journal import at all (§2.2). Give Express customers C3. |

**Out of scope, verified:** e-Tax Invoice & e-Receipt, PEPPOL (§5).

---

## 1. Statutory filings

### 1.1 ภ.ง.ด.1 / ภ.ง.ด.1ก / ภ.ง.ด.1ก พิเศษ — "FORMAT กลาง" Version 2.0

**Confidence: `OFFICIAL`.** Index page: <https://www.rd.go.th/63724.html> ("รูปแบบข้อมูล (ฟอร์แมตกลาง)").
Spec PDF: <https://www.rd.go.th/fileadmin/user_upload/WHT/Download/FormatPND1V2_0.pdf> — *"รูปแบบข้อมูล (FORMAT) ภ.ง.ด.1 ภ.ง.ด.1ก และ ภ.ง.ด.1ก พิเศษ"*, 225 KB, **Version 2.0, ปรับปรุง ณ วันที่ 16/06/2568**.

Legal driver: paper filing of ภ.ง.ด.1 / 1ก / 1ก พิเศษ was ended by a ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีเงินได้ dated 21 ก.ย. 2566, effective for payments from 1 ม.ค. 2567. Index of ประกาศอธิบดี: <https://www.rd.go.th/62981/ประกาศอธิบดีกรมสรรพากร.html>. ⚠️ *The exact announcement number is contested — search results give both ฉบับที่ 438 and a superseding ฉบับที่ 451. Confirm the operative number before quoting it to a customer.* (`THIRD-PARTY` for the number, `OFFICIAL` for the electronic-only outcome, which the RD's own e-Filing site reflects.)

#### File-level rules (verbatim from the spec's ข้อกำหนด section)

| Rule | Value |
| --- | --- |
| Encoding | **UTF-8** — *"ชนิดไฟล์ข้อมูล UNICODE จะต้องกำหนดเป็น UTF8"*. **Not TIS-620.** |
| Delimiter | **Pipe `\|`**, between fields only — no leading/trailing pipe on a record |
| Line ending | **CR/LF** |
| Structure | Row 1 = one **HEADER** record; rows 2..n = **DETAIL** records |
| Empty numeric | `0.00` |
| Empty text | consecutive pipes (`\|\|`) — do not pad |
| Padding | **None.** Lengths are maxima, not fixed widths |
| `N(15,2)` | means 18 characters total *including the decimal point* |
| Rounding | round-half-up at the 3rd decimal |
| **Forbidden characters** | `* + / \ ! $ % # & @` and comma `,` and single `'` and double `"` quotes |
| Filename | `TAX_TYPE _ NID(13) _ BRANCH_NO(6) _ TAX_YEAR(4) _ TAX_MONTH(2) _ FORM_TYPE(2) _ ครั้งที่ส่ง(00-99).txt` |

> ⚠️ **Two of these collide with our existing CSV writer** — see §4.6.

#### ส่วนที่ 1 — HEADER record (22 fields, in order)

| # | Field | Type | Len | M/O | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `HEADER` | C | 1 | M | literal `H` (uppercase) |
| 2 | `SENDER_ID` | C | 4 | M | bank code or RD-issued code; `0000` when filing our own |
| 3 | `SENDER_NID` | C | 13 | M | submitter's 13-digit tax ID |
| 4 | `SENDER_BRANCH` | C | 6 | M/O | VAT (preferred) or SBT branch; HQ = `000000`, branch 1 = `000001`; zero-pad to 6 |
| 5 | `SENDER_ROLE` | C | 1 | M | 1=ผู้หักภาษี ณ ที่จ่าย, 2=ผู้กระทำการแทน, 3=ตัวกลาง, 4=ยื่นรวม |
| 6 | `TAX_TYPE` | C | 8 | M | `PND1` / `PND1A` / `PND1AS` |
| 7 | `NID` | C | 13 | M | **withholder's** 13-digit tax ID |
| 8 | `BRANCH_NO` | C | 6 | M/O | withholder's branch, same rules as #4 |
| 9 | `DEPT_NAME` | C | 80 | M/O | `สำนักงานใหญ่` if not split by department |
| 10 | `LTO` | C | 1 | M | large-taxpayer flag, `0`/`1` |
| 11 | `TAX_MONTH` | C | 2 | M | `01`–`12`; **`00` for ภ.ง.ด.1ก / 1กพิเศษ** |
| 12 | `TAX_YEAR` | C | 4 | M | **ปี พ.ศ.**, 4 digits (e.g. `2568`) |
| 13 | `BRANCH_TYPE` | C | 1 | M/O | `V`=VAT branch, `S`=SBT branch; both ⇒ `V`; neither ⇒ empty |
| 14 | `FORM_TYPE` | C | 2 | M | `00`=ยื่นปกติ, `01`..`99`=ยื่นเพิ่มเติมครั้งที่ n |
| 15 | `TOT_NUM` | N | 7 | M | total detail-row count |
| 16 | `TOT_AMT` | N | 15,2 | M | total income paid |
| 17 | `TOT_TAX` | N | 15,2 | M | total tax remitted |
| 18 | `SUR_AMT` | N | 15,2 | M | surcharge — **always send `0.00`**, RD computes it |
| 19 | `GTOT_TAX` | N | 15,2 | M | tax + surcharge |
| 20 | `TRANS_AMT` | N | 15,2 | M | amount paid via bank; internet filing = the paid amount, media filing = `0.00` |
| 21 | `USER_ID` | C | 20 | M | e-Filing UserID (internet) or registration reference (media) |
| 22 | `FORM_FLAG` | C | 1 | M | `1`=ยื่นด้วยสื่อฯ, `2`=ยื่นอินเทอร์เน็ต |

#### ส่วนที่ 2 — DETAIL record (26 fields, in order)

| # | Field | Type | Len | M/O | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `DETAIL` | C | 1 | M | literal `D` |
| 2 | `SEQ_NO` | N | 10 | M | line number on the ใบแนบ |
| 3 | `BRANCH_NO` | C | 6 | M | must match the withholder's branch |
| 4 | `PIN` | C | 13 | M | employee's **เลขประจำตัวประชาชน** (or tax ID) — bare digits |
| 5 | `TIN` | C | 10 | M | legacy 10-digit tax ID; **`0000000000` if none** |
| 6 | `TITLE_NAME` | C | 100 | M | `นาย` / `นางสาว` / `Mr.` …; **`-` if none** |
| 7 | `FNAME` | C | 100 | M | given name only |
| 8 | `SNAME` | C | 80 | M | surname; middle name ⇒ `middle` + one space + `surname`; คณะบุคคล ⇒ `.` |
| 9 | `PAID_DATE` | C | 8 | M | **`DDMMYYYY` in ปี พ.ศ.**; for 1ก/1กพิเศษ use the year-end date |
| 10 | `TAX_RATE` | N | 4,2 | M | e.g. `15.00`; progressive/unknown ⇒ `0.00` |
| 11 | `PAID_AMT` | N | 15,2 | M | amount paid |
| 12 | `TAX_AMT` | N | 15,2 | M | tax withheld |
| 13 | `INC_TYPE_PND` | C | 1 | M | `1`=40(1), `2`=40(2)@3%, `3`=40(1)(2) **ออกจากงาน**, `4`=40(2) resident, `5`=40(2) non-resident |
| 14 | `PAY_CON` | C | 1 | M | `1`=หัก ณ ที่จ่าย, `2`=ออกให้ตลอดไป, `3`=ออกให้ครั้งเดียว |
| 15–23 | `BUILD_NAME`, `ROOM_NO`, `FLOOR_NO`, `VILLAGE_NAME`, `ADD_NO`, `MOO_NO`, `SOI`, `STREET_NAME`, `TAMBON` | C | 40/20/20/100/40/20/100/100/50 | O | address parts; omit entirely if absent (do not send spaces) |
| 24 | `AMPHUR` | C | 50 | **M** | อำเภอ/เขต |
| 25 | `PROVINCE` | C | 50 | **M** | จังหวัด |
| 26 | `POSTAL_CODE` | C | 5 | **M** | 5 digits |

> **Rule 17 of the spec:** for **ภ.ง.ด.1ก / 1ก พิเศษ** the payee's address and postcode **must** be supplied. For monthly ภ.ง.ด.1 the address fields are marked `M` in the table but the ยื่นด้วยสื่อฯ/อินเทอร์เน็ต columns differ per field — treat AMPHUR/PROVINCE/POSTAL_CODE as required in all cases.

#### Legacy "FORMAT 1.0 (Payroll/ระบบจ่ายตรง/GFMIS)"

**Confidence: `OFFICIAL`** — <https://www.rd.go.th/fileadmin/user_upload/WHT/swc1.5.1/FormatPND1.pdf> (Version 1.0, ปรับปรุง 23/05/2566), plus an Excel template <https://www.rd.go.th/fileadmin/user_upload/WHT/format1.0/Format1.0_PND11A1AS.xlsx>.

20 pipe-delimited fields, **filename `PND1.txt`**, total nominal length 468 chars, not fixed-width. Fields: `FORMTYPE(2)`, `COMPIN(13)`, `COMTIN(10)`, `BRANO(4)`, `PIN(13)`, `TIN(10)`, `PER_N1(40)`, `NAME1(80)`, `SUR_N1(80)`, `ADDRESS1(150)`, `ADDRESS2(150)`, `POSCOD(5)`, `TAXMONTH(2)`, `TAXYEAR(4)`, `INCOMECODE(1)`, `PAYDATE(8, DDMMYYYY)`, `TAXRATE(3)`, `PAYMENT(13,2)`, `TAX(13,2)`, `TAXCONDITION(1)`.

**Why it matters:** SWC-UI 1.5.4 has a built-in converter *"แปลงรูปแบบข้อมูลจากระบบจ่ายตรง/ระบบงานเงินเดือน Payroll/GFMIS (Format 1.0) เป็น Format 2.0"* — i.e. **the RD explicitly expects payroll systems to emit Format 1.0** and converts for you. Format 1.0 is *simpler* (flat address, no header record) and is a legitimate lower-effort v1 target. Format 2.0 is the better long-term target because it can be uploaded directly.

#### Submission mechanics (which matters for what we build)

Three routes, all `OFFICIAL`:

1. **RD Prep** (`โปรแกรม RD Prep`) — a Windows `.exe` downloaded from <https://efiling.rd.go.th/rd-cms/>. Manual: <https://efiling.rd.go.th/content/download/RDPrep.pdf>. It has a **"โอนย้ายข้อมูล"** wizard that ingests **`.txt` or `.csv`** with either a **chosen delimiter** or **fixed character positions**, lets the user tick "first row is column names", and then **hand-maps our columns to RD's field slots**. Output is an encrypted **`.rdx`** uploaded to e-Filing.
   → **Implication: our column *order* is negotiable and our column *names* can be human-readable Thai.** RD Prep's mapping step absorbs the difference. This drastically lowers the bar for a v1.
2. **SWC / SWC-UI** (`WHT Software Component`) — <https://www.rd.go.th/62974.html>, downloads at <https://www.rd.go.th/63742.html> (v1.5.4, 30/6/2025, `swc_rdform_ui_full1.5.4.zip`). Java 8 + .NET 4.0 Windows app. Deposits files server-to-server over a **RESTful web service on HTTPS/443**, RSA-2048 signed with the taxpayer's own digital certificate, producing a `…whtc.rdx` that is then uploaded to e-Filing. Handles **1–2 million rows per submission**. Manual: <https://www.rd.go.th/fileadmin/user_upload/WHT/swc1.5.4/swc-ui_manual_1.5.4.pdf>.
3. **e-Withholding Tax** — <https://epay.rd.go.th/>. Bank-mediated: the bank remits the tax and reports to RD, and the payer is **relieved of filing ภ.ง.ด. and of issuing 50 ทวิ**. (`THIRD-PARTY` for the relief detail — iTAX/vendor summaries; the RD landing page is `OFFICIAL` for the system's existence.) Primarily used for supplier payments; salary use is possible but uncommon.

**There is no public REST API for us to file ภ.ง.ด.1 directly.** SWC's web service is a signed desktop-client protocol requiring a taxpayer-issued digital certificate, not an open API. `OFFICIAL`.

#### Corroboration — what PEAK actually emits into RD Prep

`VENDOR-SUPPORT`, and it independently confirms the RD Prep mapping story: <https://www.peakaccount.com/peak-manual/peak-payroll/pnd1-pnd1a-payroll-summary/transferring-text-file-pnd1-to-rd-prep-program>. PEAK's payroll module tells the user to

- pick the delimiter **`|` (pipe)**,
- map **11 positions, 0 through 10**, position 10 being เงื่อนไขการหักภาษี, and
- set the payment-date field's format to **`dd/mm/yyyy`**.

Eleven slots for the ten ใบแนบ fields implies a leading sequence/row number; PEAK does not name the columns, so **the 11th is unconfirmed**. Note this is *not* FORMAT 2.0 — it is a free-form file consumed through RD Prep's interactive mapper, which is exactly why PEAK can get away with an arbitrary column order.

> **This resolves a question the earlier draft of this document left open:** PEAK's `dd/mm/yyyy` must carry **ปี พ.ศ.**, because RD's own FORMAT spec makes `TAX_YEAR` and `PAID_DATE` พ.ศ. in both version 1.0 and 2.0 (§6.2). Still worth confirming against one real RD Prep run.

> **Practical consequence, and it is the single most useful strategic fact in this document:** because RD Prep maps columns interactively and can be told the first row is a header, **our ภ.ง.ด.1 column order is not fixed by the RD.** A clean pipe-delimited UTF-8 file with a Thai header row is a legitimate v1. Matching FORMAT 2.0 exactly is what buys direct e-Filing upload without RD Prep — a later optimisation, not a prerequisite.

### 1.2 ภ.ง.ด.1ก (annual) + the provident-fund CSV

Same file format as §1.1, with `TAX_TYPE=PND1A`, `TAX_MONTH=00`, `PAID_DATE` = the year-end date, and mandatory payee address.

**The provident-fund answer** — `OFFICIAL`, from the SWC-UI 1.5.4 manual §"รูปแบบการนำเข้าข้อมูลกองทุน" and the RD template <https://www.rd.go.th/fileadmin/user_upload/WHT/format1.0/FUND_PNDtype_TAXid_Taxyear.zip>:

A separate **CSV** carrying fund contributions, uploaded *after* the main ภ.ง.ด.1ก deposit succeeds, and used to print the 50 ทวิ correctly.

| Col | Content | Type |
| --- | --- | --- |
| A | เลขประจำตัวผู้เสียภาษี 13 หลัก (must match the ภ.ง.ด.1ก payee) | C,13 |
| B | ปีภาษี — **ปี พ.ศ.** | C,4 |
| C | จำนวนเงิน กบข. / กสจ. / กองทุนสงเคราะห์ครูโรงเรียนเอกชน | N,13.2 |
| D | **จำนวนเงินประกันสังคม** | N,13.2 |
| E | **จำนวนเงินกองทุนสำรองเลี้ยงชีพ** (provident fund) | N,13.2 |

Rules: comma **or** pipe delimiter; empty ⇒ `0.00`; **amounts ≥ 1000.00 carry no thousands comma**; encoding **UTF-8 or UTF-8 with BOM**; filename `FUND_<ประเภทภาษี>_<TIN13>_<ปีภาษี พ.ศ.>.csv`, e.g. `FUND_PND1A_1234567890123_2564.csv`.

> Column D is **already derivable** from `Payroll.deductSso`. Column E is **not** — there is no provident-fund field (§4.2). Column C is public-sector only and will always be `0.00` for this customer.

### 1.3 ภ.ง.ด.3 and ภ.ง.ด.53 — relevant?

**No, not for payroll.** `OFFICIAL`.

- **ภ.ง.ด.3** — WHT on payments to *individuals* other than employment income (§40(3)–(8): rent, professional fees, contractor work, service fees).
- **ภ.ง.ด.53** — the same, paid to *juristic persons*.

Neither covers salary. They matter to a payroll product only if it ever pays non-employee contractors. They ride the **identical RD Prep / SWC machinery** with their own FORMAT PDFs (`FormatPND3V2_0.pdf`, `FormatPND53V2_0.pdf` at the same index page), so a future ภ.ง.ด.3 export would reuse ~90% of the ภ.ง.ด.1 writer.

### 1.4 หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)

**Confidence: `OFFICIAL`** for the tooling; **`NOT FOUND`** for an interchange schema.

- RD publishes a free **"โปรแกรมออกหนังสือรับรองหัก ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร"** ("50 Tawi Generator") — <https://www.rd.go.th/65920.html>. Version 1, 28/12/2023: `50_Tawi_Generator.zip` (10.3 MB), `50_Tawi_Generator.exe.config`, and `Manual50TawiGen_20231228.pdf`.
- **SWC-UI also prints 50 ทวิ** from a successfully deposited ภ.ง.ด. file, splitting large runs into **PDF batches of 500 certificates**, and can fold in the fund amounts from the §1.2 CSV. `OFFICIAL` (SWC-UI 1.5.4 manual).
- **Electronic issuance:** only via **e-Withholding Tax** (bank-mediated), which removes the obligation to issue the certificate at all. There is **no published XML/JSON schema for a standalone electronic 50 ทวิ**. `NOT FOUND`.
- The legal basis is มาตรา 50 ทวิ แห่งประมวลรัษฎากร; the RD download page cites the section but not a ประกาศอธิบดี number. I did not locate the ประกาศอธิบดี that prescribes the certificate's exact content. `NOT FOUND`.

**Recommendation:** render 50 ทวิ as a PDF ourselves (we already have a PDF pipeline). Do not attempt an interchange format — there isn't one.

### 1.5 สปส.1-10 (SSO monthly contribution) — **layout found**

**Confidence: `OFFICIAL`, and independently re-verified.** The layout is *not* in the e-Services manual — it is a downloadable spreadsheet on the SSO's **Downloads → โปรแกรมต่างๆ** page:

**<https://www.sso.go.th/wpr/main/downloads/โปรแกรมต่างๆ_category_table-list_1_154_0>**

| Item on that page | URL | Contents |
| --- | --- | --- |
| **Format เงินสมทบ 135 (Text File)** | `https://www.sso.go.th/wpr/assets/upload/files_storage/sso_th/949575a913c647db4f68facd08402585.zip` | → `Formatเงินสมทบ135ใหม่.xls` — **the 135-char layout** |
| **Format ทะเบียน** | `.../d215cc433235b1b4d5b22899a3400aeb.zip` | → `Format ทะเบียน (30092015).xls` — 240-char layouts for สปส.1-03, 1-03/1, **1-04**, 6-09, 6-10 |
| **Format ตัวอย่างไฟล์ Excel …ส่งข้อมูลเงินสมทบ** | `.../5dff0034a8f007a36ba05305e523b5a1.xlsx` | the **Excel upload template** |
| **โปรแกรมระบบข้อมูลประกันสังคม SSO Media 2.0** | `.../e279c1075305b395d1dfbf8efd77075d.zip` | SSO's own file-builder — a golden reference generator |
| คู่มือโปรแกรม SSO Media 2.0 | `.../5006315e73fcde66af99934114b9acea.zip` | Manual.doc (20 MB) |
| FontPack1000_Xtd_Lang | `.../797a55377711b7d4eef8dad1ee2237b0.zip` | Thai legacy font/codepage pack |

**Two accepted file formats, not three.** SSO's Bureau of Contributions guidance *"แนวปฏิบัติการจัดทำข้อมูลเงินสมทบผ่านระบบอินเตอร์เน็ต (สำหรับนายจ้าง)"* (<https://www.sso.go.th/wpr/assets/upload/files_storage/sso_th/62fe9590276f37e039e3c629859432be.pdf>, `OFFICIAL`) says: *"กรณีนายจ้างแนบไฟล์ **มี 2 รูปแบบ** — 2.1 การบันทึกข้อมูลรูปแบบ **Excel** … 2.2 กรณีนายจ้างส่งข้อมูลในรูปแบบ **Payroll**"*, where "Payroll" is the fixed-width text file. **A `.dbf` option is `NOT FOUND`** — treat the commonly-repeated "txt/dbf/xls" claim as unverified.

#### สปส.1-10 text file — "Format เงินสมทบ 135"

Record length **135 characters**, fixed width, all fields type **C**. Positions are 1-based inclusive. *Verified twice: once by the research agent, once by re-parsing `Formatเงินสมทบ135ใหม่.xls` directly.*

**Header Record (ส่วนที่ 1)** — one per file, `RECORD TYPE = 1`:

| # | Field (Thai) | Field name | Len | Pos | Example |
| --- | --- | --- | --- | --- | --- |
| 1 | ประเภทข้อมูล | `RECORD TYPE` | 1 | 1 | `1` — *"กำหนดให้เป็น '1' เสมอ"* |
| 2 | เลขที่บัญชีนายจ้าง | `ACC NO` | 10 | 2–11 | `1090002301` — SSO-assigned employer account |
| 3 | ลำดับที่สาขา | `BRANCH NO` | 6 | 12–17 | `000000` — as assigned by SSO |
| 4 | วันที่ชำระเงิน | `PAID DATE` | 6 | 18–23 | `150447` — **`DDMMYY`, YY = last 2 of ปี พ.ศ.** |
| 5 | งวดค่าจ้าง | `PAID PERIOD` | 4 | 24–27 | `0347` — **`MMYY`**, month zero-padded to 2 |
| 6 | ชื่อสถานประกอบการ | `COMPANY NAME` | 45 | 28–72 | `บ.สปส.จำกัด` |
| 7 | อัตราเงินสมทบ | `RATE` | 4 | 73–76 | `0300` — no decimal point, left zero-filled |
| 8 | จำนวนผู้ประกันตน | `TOTAL EMPLOYEE` | 6 | 77–82 | `000100` |
| 9 | ค่าจ้างรวม | `TOTAL WAGES` | 15 (2 dp) | 83–97 | `000000150000000` |
| 10 | เงินสมทบรวม | `TOTAL PAID` | 14 (2 dp) | 98–111 | `00000009000000` — employee + employer |
| 11 | เงินสมทบรวมส่วนผปต. | `TOTAL PAID BY EMPLOYEE` | 12 (2 dp) | 112–123 | `000004500000` |
| 12 | เงินสมทบส่วนนายจ้าง | `TOTAL PAID BY EMPLOYER` | 12 (2 dp) | 124–135 | `000004500000` |

**Detail Record (ส่วนที่ 2)** — one per insured person, `RECORD TYPE = 2`:

| # | Field (Thai) | Field name | Len | Pos | Example |
| --- | --- | --- | --- | --- | --- |
| 1 | ประเภทข้อมูล | `RECORD TYPE` | 1 | 1 | `2` — *"กำหนดให้เป็น '2' เสมอ"* |
| 2 | เลขที่บัตรประชาชน | `SSO ID (NID)` | 13 | 2–14 | `1234567890123` |
| 3 | คำนำหน้าชื่อ | `PREFIX` | 3 | 15–17 | `003` — **`003`=นาย, `004`=นางสาว, `005`=นาง** |
| 4 | ชื่อผู้ประกันตน | `FNAME` | 30 | 18–47 | `ประกัน` |
| 5 | นามสกุลผู้ประกันตน | `LNAME` | 35 | 48–82 | `สังคม` |
| 6 | ค่าจ้าง | `WAGES` | 14 (2 dp) | 83–96 | `00000001500000` = ฿15,000.00 |
| 7 | จำนวนเงินสมทบ | `PAID AMOUNT` | 12 (2 dp) | 97–108 | `000000075000` = ฿750.00 |
| 8 | คอลัมน์ว่าง | `BLANK` | 27 | 109–135 | filler |

**Numeric rule, verbatim:** *"เป็นข้อมูลที่มีทศนิยม ให้บันทึกตัวเลขรวมทั้งทศนิยมด้วย โดยบันทึกตัวเลขแบบชิดขวา ไม่ต้องบันทึกจุดทศนิยม(.) ในตำแหน่งที่ว่างด้านซ้ายให้เต็มจำนวน เช่น ค่าจ้าง 15,000.00 บาท ให้บันทึก 00000001500000"* — **right-aligned, zero-filled, ×100, no decimal point.** The header sheet gives a second worked example: `1,500,000.67` → `000000150000067`.

> **So the satang-integer convention I could not confirm for any bank (§6.4) *is* the rule here.** SSO amounts are integers of satang, zero-padded.

**Prefix codes:** *"กรณีที่มีคำนำหน้าอื่นนอกเหนือจากตัวอย่างให้ติดต่อประกันสังคม เพื่อขอรหัสคำนำหน้าไปใช้"* — only นาย/นางสาว/นาง are published; anything else requires SSO to issue a code.

⚠️ **Two inferences, not stated in the file.** (a) `RATE` `0300` for 3% implies **2 implied decimals**, so 5.00% → `0500` — consistent with the field's *"ไม่ต้องมีจุดทศนิยม…เติม 0 ด้านซ้าย"*, but the file never shows a 5% example. (b) Text fields are presumably **left-aligned, space-padded**; the file states only the total width and the numeric rule.

#### สปส.1-10 Excel template (the easier target)

`OFFICIAL` — `5dff0034a8f007a36ba05305e523b5a1.xlsx`, re-parsed directly. **A single worksheet whose *name is the branch number*** (the sample sheet is literally named `000000`), carrying the note *"โปรดระบุชื่อ Sheet ให้ตรงกับลำดับที่สาขาที่สำนักงานประกันสังคมกำหนด"*.

Header row, in order:

| A | B | C | D | E | F |
| --- | --- | --- | --- | --- | --- |
| `เลขประจำตัวประชาชน` | `คำนำหน้าชื่อ` | `ชื่อผู้ประกันตน` | `นามสกุลผู้ประกันตน` | `ค่าจ้าง` | `จำนวนเงินสมทบ` |

Differences from the text file that matter: **`คำนำหน้าชื่อ` is the Thai word** (`นาย`), *not* the 3-digit code; and **amounts are plain decimal numbers** (`17000`, `750`), not ×100 integers. Sample rows show the **employer** applies the floor and ceiling, not the portal (17,000→750; 100,000→750; 200→83; 1,650→83).

> ⚠️ **Our current export does not match this.** `src/lib/filings/sso-1-10-xlsx.ts` emits `ลำดับที่ | เลขประจำตัวประชาชน | ชื่อ-สกุล | ค่าจ้าง | เงินสมทบ` under a merged title block, with a combined name column, no prefix column, and a summary block below. The official template has **no ลำดับที่, no title block, no summary**, splits first/last name, and adds `คำนำหน้าชื่อ`. The file's existing `⚠️ VERIFY BEFORE SHIP` comment was right to be there — **this is the answer, and the columns need changing.**

#### สปส.1-10/1 (ยื่นรวมสาขา)

`OFFICIAL` for the flow (e-Services manual: *"ส่งเงินสมทบแบบยื่นรวมสาขา (ตามแบบ สปส.1-10/1)"*, including a **"แนบไฟล์ ตามสาขาที่ระบุในไฟล์"** variant). **No separate record layout is published** — the same 135 format is used, with branch identity carried in header positions 12–17, or in the Excel sheet *name*. `NOT FOUND` for a distinct layout.

#### สปส.1-04 and the registration forms

`OFFICIAL` — `Format ทะเบียน (30092015).xls`, sheets: `สปส.1-03`, `สปส.1-03 (2)`, `สปส.1-04`, `สปส.6-09`, `สปส.6-10`. **Record length 240 characters.** Each form has its own 3-char `RECORD TYPE` at positions 1–3 (`103`, `608`, `104`, `609`, `610`) and a shared prefix: `PROVINCE` (4–5), `PROVINCE BRANCH` (6–7), `ACCOUNT` (8–17), `ACCOUNT BRANCH` (18–23).

`สปส.1-03` (new-hire registration) detail fields include NID (24–36), ID TYPE (37), NATIONALITY (38–40, `099`=Thai), SEX (41), TITLE CODE (42–44), FIRST (45–74), LAST (75–109), **BIRTH `DDMMYYYY` ปี พ.ศ.** (110–117), MARRY (118), **START DATE** (119–126), EMP TYPE (127), ALIEN (128), CHILD flag + count + two DOBs (129–147), and **three hospital choices** (148–154, 155–161, 162–168).

Not needed for payroll export today, but this is where employee onboarding/offboarding automation would go.

#### Contribution parameters — ⚠️ **the ceiling changed for 2569 (2026)**

- The paper สปส.1-10 form's instructions confirm the **floor**: wages below **฿1,650** are calculated as if ฿1,650 (<https://www.sso.go.th/wpr/assets/upload/files_storage/sso_th/918a5ffc639945c7890f199112922f09.pdf>, `OFFICIAL`).
- SSO's general contribution page still states **5% / ฿1,650 floor / ฿15,000 ceiling / ฿750 max** — <https://www.sso.go.th/wpr/main/general/เงินสมทบและการชำระเงิน_singleview_detail_1_193_0/438_438> (`OFFICIAL`, **but apparently stale**).
- A **กฎกระทรวง** raising the ceiling was gazetted in December 2568 and took effect **1 January 2569**, phasing it:

  | Period | Floor | Ceiling | Max employee contribution |
  | --- | --- | --- | --- |
  | **1 Jan 2569 – 31 Dec 2571** | ฿1,650 | **฿17,500** | **฿875** |
  | 1 Jan 2572 – 31 Dec 2574 | ฿1,650 | ฿20,000 | ฿1,000 |
  | from 1 Jan 2575 | ฿1,650 | ฿23,000 | ฿1,150 |

  Rating: **`OFFICIAL`-adjacent, gazette not directly retrieved.** Corroborated by an sso.go.th consultation-results PDF on the draft regulation (<https://www.sso.go.th/wpr/assets/upload/files_storage/sso_th/1644636ae406c041472ee4c2fc9862cb.pdf>) and an sso.go.th infographic *"ปี 2569 ปรับเพดานค่าจ้าง = สิทธิประโยชน์เพิ่ม"* (<https://www.sso.go.th/wpr/main/privilege/sso-infographic_detail_detail_1_127_709/1081_1081>), plus press (<https://www.thaipost.net/general-news/914119/>, <https://policywatch.thaipbs.or.th/article/life-226>). **Get the เล่ม/ตอน/หน้า from ratchakitcha.soc.go.th before citing it in code.**

> ✅ **Our seed is already correct** — `prisma/seed.ts` uses `ssoSalaryCap: '17500'`, `ssoAmountCap: '875'`.
> ⚠️ **But the schema doc-comments are stale**: `prisma/schema.prisma` still says *"Cap on the base-salary value used for SSO calculation (฿15,000 per Thai law)"* and *"₿750 per Thai law"*. Those comments now assert the wrong law. Some `calc.test.ts` fixtures also still use 15000/750 — harmless as fixtures, but worth a look so nobody reads them as the current rule.

#### The cheapest verification of all

The e-Services manual documents a **"ดาวน์โหลดไฟล์อัพโหลดสปส.1-10 หรือ 1-10/1"** action on the transaction-status screen (rows filed by method **`U` — วิธีแนบไฟล์** carry a download icon). An enrolled employer can therefore **re-download a genuine, portal-accepted file**. Do that before shipping the text writer — it settles encoding and padding, the two things the spreadsheet does not state.

### 1.6 กท.20ก — Workmen's compensation fund

`OFFICIAL` only that it exists and is filed through the same SSO e-Services (the manual has a "ข้อมูลเงินสมทบกองทุนเงินทดแทน" enquiry screen). It is an **annual wage report** (เงินกองทุนเงินทดแทน), not monthly. **`NOT FOUND`** for any upload file layout. Low priority — it is one number per year per establishment.

---

## 2. Accounting packages — priority tier

### 2.1 PEAK (peakaccount.com)

**Journal-entry API — `OFFICIAL`, full schema.** Docs: <https://developers.peakaccount.com/> · reference index <https://developers.peakaccount.com/llms.txt>.

`POST /api/v1/dailyjournals` — <https://developers.peakaccount.com/reference/post_api-v1-dailyjournals>

Required headers:

| Header | Value |
| --- | --- |
| `Time-Stamp` | `yyyyMMddHHmmss` |
| `Time-Signature` | HMAC-SHA1 of `Time-Stamp`, secret = `connectId` |
| `User-Token` | issued by PEAK |
| `Client-Token` | from `POST /api/v1/clienttoken` |

Body:

```
peakDailyJournals: {
  dailyJournals: [{
    issuedDate      : string   (required)
    journalTypeId   : string   (required)   // numeric code for journal book
    contactId       : string   (required)
    journalEntries  : [{
      accountCode   : string   (required)
      accountSubId  : string   (optional)
      debit         : string   (optional)
      credit        : string   (optional)
      description   : string   (optional)
    }]
    code, description, status, reference : string (optional)
  }]
}
```

Also relevant: `POST /api/v1/dailyjournals-queue` (async bulk), `POST /api/v1/dailyjournals-void`, `GET /api/v1/dailyjournals-accountcode`, `GET /api/v1/financialreports-trialbalance`, and `POST /api/v1/expenses*`. Webhooks and rate limits are documented. PEAK's own note: *"✅ Billable — POST Create (Documents & Daily Journals)"* — **each journal costs an API transaction.**

**Access:** `OFFICIAL` — <https://www.peakaccount.com/developers>. **Not public**: requires application and approval, and the customer must be on **PEAK PRO Plus (from ฿12,000/year)**. Free 3-month UAT sandbox.

**⚠️ The `peakCode` finding.** PEAK's chart of accounts is a **6-digit code that PEAK generates automatically and the user cannot set**: *"รหัสผังบัญชีระบบจะทำการรันให้อัตโนมัติ ไม่สามารถกำหนดรหัสผังบัญชีได้"* (<https://www.peakaccount.com/peak-manual/financial-accounting-data/create-chart-of-accounts/adding-chart-of-accounts>, `OFFICIAL`), and *"ไม่สามารถกำหนด หรือ รันเลขผังบัญชีเองได้"* with the last two digits running 01–99 per sub-category (<https://www.peakaccount.com/peak-manual/financial-accounting-data/create-chart-of-accounts/guide-to-standard-chart-of-accounts-in-peak>, `OFFICIAL`). Example values returned by `GET /api/v1/dailyjournals-accountcode`: `111101` เงินสด / Cash, `111201` Current Account, `211101` Bank Overdraft.

→ **A PEAK account code must be *fetched from PEAK*, never typed by our admin.** See §4.4.

**Excel journal import — `OFFICIAL` that it exists, columns `NOT FOUND`.** <https://www.peakaccount.com/peak-manual/peak-others/import-documents/import-general-journal-book> — *"นำเข้าสมุดบัญชีรายวัน ใช้สำหรับการสร้างบัญชีรายวันทีละหลายใบพร้อมกัน สามารถสร้างได้ทั้งสมุดรายวันทั่วไป ซื้อ ขาย รับ จ่าย"*. The user downloads *"ไฟล์ตัวอย่าง บัญชีรายวัน (.xlsx)"* from inside the app. **The page shows the template only as a screenshot and never lists the headers.** Restricted to **Pro Plus and above** (<https://www.peakaccount.com/peak-manual/peak-others/import-documents/data-that-can-be-imported-peak-pro-plus>).

**PEAK Payroll exists** as a separate module (<https://www.peakaccount.com/peak-manual/peak-payroll>) with its own ภ.ง.ด.1ก Excel export and employee Excel import (max 100 employees/upload, `VENDOR-SUPPORT`) — i.e. **PEAK is partly a competitor**, not only a target.

**Bonus:** PEAK Premium can print an **SCB bank text file** — *"การพิมพ์ Text File ธนาคาร SCB เพื่อนำเข้าไปอัปโหลดในธนาคาร (NF040)"* (`VENDOR-SUPPORT`, intercom.help/peak article 10923025). Confirms a Thai cloud package considers SCB text output a shippable feature.

### 2.2 Express (โปรแกรมบัญชี Express)

**⛔ Headline: Express cannot import journal entries. Do not build an Express journal export.**

**First, a correction that matters:** the brief named `express-soft.com`. **That domain is no longer the vendor** — it now serves an unrelated Japanese adult-content aggregator (`OFFICIAL`, direct fetch, 2026-09-07). The real vendor is **Express Software Group Co., Ltd.**: <https://express.co.th/> (current) and <https://esg.co.th/> (legacy, redirects to express.co.th). Do not link customers to express-soft.com.

| Question | Answer | Confidence |
| --- | --- | --- |
| Journal-entry (GL voucher) import? | **No.** Official forum staff reply: *"โปรแกรม Express ไม่สามารถโอนหรือนำเข้ารายการเดินบัญชี"* — the program cannot transfer or import journal entries. | `OFFICIAL` (vendor-run forum, staff account) — <https://esg.co.th/phpBB3/> |
| Any built-in import? | **No.** Import requires the paid add-on **"Express Platform"**, obtained by phoning customer service (02-217-3533). | `OFFICIAL` (vendor forum, admin `savek`, Feb 2026 — <https://esg.co.th/phpBB3/viewtopic.php?f=1&t=19742>) |
| What can Express Platform import? | **Excel** for: purchase orders, sales orders, purchase invoices, sales invoices, and master/database records. Supports multi-line items and a column-mapping step. **Journal vouchers are not in the list.** | `OFFICIAL` (same forum thread) |
| Published column layout? | **`NOT FOUND`** — Express Platform is distributed 1-to-1 by phone; no public template. |
| Payroll module? | **None.** The 12 modules are ระบบจัดซื้อ/รับสินค้า, เจ้าหนี้และค่าใช้จ่าย, จองสินค้า/จัดจำหน่าย, ลูกหนี้และรายได้, สินค้าคงคลัง, เช็คและเงินฝากธนาคาร, ภาษีมูลค่าเพิ่ม, บัญชีแยกประเภท, สินทรัพย์ถาวร, วิเคราะห์การขาย, วิเคราะห์การซื้อ, รักษาความปลอดภัย. No ระบบเงินเดือน. | `VENDOR-SUPPORT` (authorised dealer I.T. Advantage, <https://www.itac.co.th/index.php/express-accounting-software.html>) + `OFFICIAL` product page <https://express.co.th/productandservice/> |
| API? | **None found.** | `NOT FOUND` |
| Storage engine | Free **`.dbf` tables** (FoxPro/dBase lineage). Staff-named files: `ARMAS.DBF`, `ARTRN.DBF`, `BKTRN.DBF`, `STCRD.DBF`, `GLREP.DBF`, `GLREPIT.DBF`, `GLJNL.DBF`, `ISLOG.DBF`, `DBINF.DBF`. | `OFFICIAL` (vendor forum) |
| Encoding | Not stated anywhere I could find. The DOS/FoxPro lineage implies TIS-620/CP874, but **`NOT FOUND` as an explicit statement.** |

Third-party integrators (K2M IT, report-express.blogspot.com) sell "import Excel into Express" as a **manual service**; none publishes a technical method. Writing `GLJNL.DBF` directly is the only technical route and it is unsupported, undocumented, and would corrupt Express's cross-file linkages — an experienced forum respondent warns Express has *"โครงสร้างโปรแกรม…เชื่อมต่อกันหลายไฟล์ หลายฟิลด์"*.

**Recommendation: Express customers get a formatted XLSX payroll register (C3) that their bookkeeper keys in.** That is what they do today. Anything more ambitious is a support liability.

### 2.3 FlowAccount (flowaccount.com)

**Journal-entry API — `OFFICIAL`, verbatim body.** <https://developers.flowaccount.com/tutorial/journal-entry-api/>

- Base URLs: sandbox `https://openapi.flowaccount.com/sandbox`, production `https://openapi.flowaccount.com/v3-alpha`
- Auth: Bearer token via **Client Credentials** (one company) or **OpenID Connect** (partner, many companies). Signup <https://form.flowaccount.com/request-openapi>; sandbox creds in 1–2 business days, production within 3.
- OpenAPI spec is public on GitHub: <https://raw.githubusercontent.com/flowaccount/open-api/master/libs/api-spec/src/api-spec.openapi.json> (≈457 KB)

`POST /journal-entries/approve` (and `/journal-entries/draft`), header `Authorization: Bearer accessToken`:

```json
{
  "documentType": 51,
  "documentDate": "2024-05-01",
  "contactId": null,
  "contactName": "",
  "description": "OpenAPI Manual Create Approve",
  "note": null, "remarks": null, "reference": null,
  "bookOfAccounts": [
    { "debitCredit": 1, "chartOfAccountId": 2696850, "value": 107, "description": null },
    { "debitCredit": 3, "chartOfAccountId": 2697053, "value": 100, "description": null }
  ]
}
```

- `debitCredit`: **`1` = debit, `3` = credit**
- `chartOfAccountId`: **a numeric internal ID, not an account code** — must be looked up via the Chart of Accounts API
- `documentDate`: `YYYY-MM-DD`, **Gregorian**
- `documentType`: `51`=Journal Voucher (JV, general), `53`=Purchase Voucher (UV), `55`=Sales Voucher (SV), `57`=Payment Voucher (PV), `59`=Received Voucher (RV)

**Payroll module + employee import — `VENDOR-SUPPORT`.** <https://flowaccount.com/faq/knowledge-base/import-employee/>. Accepts **`.csv` / `.xls` / `.xlsx`**, max **5 MB**, max **500 employees** per import. The article names dropdown-constrained fields — คำนำหน้าชื่อ, ที่อยู่บัตรประชาชน, ประเภทพนักงาน, สิทธิ์ประกันสังคม, ช่องทางการรับชำระ, ธนาคาร, ประเภทบัญชี — but **does not list the header row**; you must download the template from inside the app. Contacts import (same limits) does list its three mandatory columns: **ชื่อธุรกิจ, ประเภทผู้ติดต่อ, ประเภทกิจการ**, with tax ID validated as **10 or 13 digits**.

**No CSV/Excel import for journal entries** — journals are UI-entered or API-created only (`VENDOR-SUPPORT`, <https://flowaccount.com/faq/knowledge-base/edit-manual-jv/>). FlowAccount's five journals mirror the API's document types: JV, UV, SV, PV, RV.

**FlowAccount is also a competitor** — FlowPayroll generates a K-Cash Connect Plus payroll file (`VENDOR-SUPPORT`, <https://flowaccount.com/faq/knowledge-base/จ่ายเงินเดือนด้วย-k-cash-connect-plus/>) and publishes RD Prep how-tos.

---

## 3. Accounting packages — second tier

| Package | Journal import? | Master data? | File formats | API | Spec public? |
| --- | --- | --- | --- | --- | --- |
| **SMEMove** | **Yes** — บัญชี > บันทึกบัญชี > สร้างรายการใหม่ > อัพโหลดรายการใหม่ | Products, contacts, assets | Excel | Shopee/Lazada connectors; no published general API | **Columns published** ✅ |
| **AccRevo** | Via API only | Documents | API + document upload | Yes, "AccRevo The Book" API; integrations listed incl. **payroll** as a category | **No developer docs** `NOT FOUND` |
| **Business Plus / BPLUS** | n/a — it *is* a payroll system | — | Emits bank files, ภ.ง.ด.1/1ก/91, ประกันสังคม, PF reports | None found | `NOT FOUND` |
| **Prosoft WINSpeed** | *"Export & Import ข้อมูลรายวัน หรือ ยอดยกมา"*, "File Excel, Text file", user-defined templates with per-column drop-down mapping | Yes | Excel, Text, DB-to-DB | — | **No layout published** `NOT FOUND` |
| **Prosoft myAccount / HRMI** | HRMI **posts GL directly into** myAccount/WINSpeed | — | Import/Export payroll records in Excel and Text | — | `NOT FOUND` |
| **Formula / SmartBiz** (Crystal Software) | GJ journal entry exists in-product; import documented for **products/customers/suppliers only** | Yes, Excel template | Excel | — | Partial, master-data only |
| **MAC-5 Legacy** | Claims data exchange *"via API, Text File, and Excel"* and an "open standard API" | Yes | API/Text/Excel | Claimed | `NOT FOUND` — marketing claim, no spec |
| **CD Organizer** | No evidence of import; **export** to Word/Excel | — | Export only | — | `NOT FOUND` |
| **Xero** | **Yes** — Manual Journal CSV + API | Yes | CSV, REST | **Yes, fully public** | ✅ |
| **QuickBooks Online** | **Yes** — journal-entry CSV import | Yes | CSV, REST | Yes | ✅ |

**Sources.** SMEMove <https://help.smemove.com/knowledge-base/upload-excel-ในการบันทึกบัญชี/> · AccRevo <https://www.accrevo.com/events/item/235> · Business Plus <https://www.businessplus.co.th/> · Prosoft <https://www.prosoftwinspeed.com/Article/Detail/130133/Import-Export>, <https://www.prosofthrmi.com/Article/Detail/105746/> · Prosoft→WINSpeed GL export is a **direct database connection** (server/db/user/password), not a file: <https://www.prosofterp.com/Article/Detail/165572> · Formula <https://www.crystalsoftwaregroup.com/formula-financial-and-accounting/> · MAC-5 <https://mac5enterprise.com/> · CD Organizer <https://www.cd-organizer.com/>.

### 3.1 SMEMove journal upload — columns (the only fully published Thai journal template found)

`VENDOR-SUPPORT` — <https://help.smemove.com/knowledge-base/upload-excel-ในการบันทึกบัญชี/>

| # | Column (Thai) | Required | Values |
| --- | --- | --- | --- |
| 1 | เลขที่รายการและเลขที่สมุดรายวัน | ✔ | |
| 2 | วันที่ | ✔ | format not stated |
| 3 | สมุดรายวัน | ✔ | **ทั่วไป=1, ซื้อ=2, ขาย=3, จ่าย=4, รับ=5** |
| 4 | ผังบัญชี | ✔ | |
| 5 | เดบิต | ✔ | *"ผลรวมของเดบิต และเครดิตจำเป็นต้องเท่ากัน"* |
| 6 | เครดิต | ✔ | must balance |
| 7 | รายละเอียด | | |
| 8 | หมายเหตุในบริษัท | | |
| 9 | ล๊อคสมุดรายวัน | | ไม่ล๊อค=0, ล๊อค=1 |

Note the journal-book code scheme (1–5) matches FlowAccount's JV/UV/SV/PV/RV ordering conceptually. **A common Thai GL shape is emerging** — see §5.1.

### 3.2 Xero and QuickBooks in Thailand — honest answer

**Both are available; neither is mainstream for a Thai SME's statutory books.** `THIRD-PARTY` + `OFFICIAL` mix.

- **QuickBooks Online**: Intuit launched QBO Accountant in 170+ countries **including Thailand** in May 2023 (<https://www.businesswire.com/news/home/20230508005040/en/>, `OFFICIAL` press release), and Intuit runs a Thai-language site (<https://quickbooks.intuit.com/global/th/>). QuickBooks *Desktop* was discontinued 31 May 2024. There is a Thai distributor. But there is **no Thai VAT/WHT localisation**.
- **Xero**: usable in Thailand and used by international firms (Forvis Mazars Thailand is an ecosystem partner). Thai statutory gaps are filled by the third-party **ThaiTax** app (<https://apps.xero.com/id/app/thaitax>, <https://thaitax.co/>) which generates WHT certificates and VAT returns. Xero natively lacks ภ.พ.36, e-Tax Invoice, and ภ.ง.ด. generation; the common pattern is a Thai accountant exporting monthly for ภ.พ.30 / ภ.ง.ด. filings.

**Verdict:** treat Xero/QBO as **expat- and multinational-subsidiary formats, not Thai-SME formats.** Their real value to us is that **their specs are public and stable**, so they make an excellent canonical GL shape and a zero-cost regression target.

#### Xero Manual Journal — API schema (`OFFICIAL`, from Xero's own OpenAPI YAML)

`ManualJournal` — required: **`Narration`**. Optional: `JournalLines[]`, `Date` (*"Date journal was posted – YYYY-MM-DD"*), `LineAmountTypes`, `Status` (`DRAFT|POSTED|DELETED|VOIDED|ARCHIVED`), `Url`, `ShowOnCashBasisReports`, `ManualJournalID`.

`ManualJournalLine` — `LineAmount` (*"total for line. **Debits are positive, credits are negative value**"*, e.g. `-2569.00`), `AccountCode` (e.g. `720`), `AccountID` (uuid), `Description`, `TaxType`, `TaxAmount`, `Tracking` (**max 2 tracking categories per line** — this is Xero's cost-centre mechanism), `IsBlank`.

CSV import exists in-product ("Add, import and post manual journals"); Xero Central would not render its column list to a fetch, and **column names are case- and space-sensitive** (`THIRD-PARTY`, EntryRocket). Prefer the API.

#### QuickBooks Online journal CSV (`OFFICIAL`)

<https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US>

Headers: **`Journal No.`**, **`Journal Date`**, **`Account Name`**, **`Journal/Description`**, **`Debits`**, **`Credits`**.

Rules: line items must reference a **parent account**; sub-accounts are `"Parent account: Sub Account"`; accounts must pre-exist; turn off account numbers before importing. No documented row/size limit.

---

## 4. Bank direct-credit payroll files

**The single most useful finding in this section: for every Thai bank I could verify, the corporate portal ships a *converter* — a downloadable Excel template or a web tool — that produces the upload file for you. The raw record layout is customer-only, but the converter's *input* is documented and public.** Target the converter input.

### 4.1 SCB — Business Anywhere ✅ best-documented

`OFFICIAL` — manual index <https://www.scb.co.th/th/corporate-banking/digital-banking-services/business-anywhere/manual/payroll>, with three public PDFs:

- `manual-scb-payroll-upload-excel-template.pdf` — *"การสร้างไฟล์เงินเดือน SCB Payroll จาก Excel Template"* → <https://www.scb.co.th/getmedia/a0ced7ec-cf4e-4ec6-bcb1-15bce0c63d22/manual-scb-payroll-upload-excel-template.pdf>
- `manual-other-payroll-upload-excel-template.pdf` — *"…ต่างธนาคาร-มีผลวันถัดไป (Payroll Smart Credit - Next Day)"* → <https://www.scb.co.th/getmedia/d0a83557-66fe-4773-964a-ed4ce2030ebe/manual-other-payroll-upload-excel-template.pdf>
- `manual-upload-file-payroll.pdf` → <https://www.scb.co.th/getmedia/a0b6ae82-706d-4529-8d00-35fe1612d633/manual-upload-file-payroll.pdf>

Flow: **การชำระและโอนเงิน → Import files → ดาวน์โหลดเทมเพลต**, fill the **`Payment` sheet**, upload, approve.

**Template header block (fields 1–7):**

| # | Field | Notes |
| --- | --- | --- |
| 1 | เลขที่บัญชีตัดเงิน (debit account) | **digits only** |
| 2 | เลขที่บัญชีหักค่าธรรมเนียม (fee account) | digits only |
| 3 | วันที่รายการมีผล (effective date) | example given as **`01/05/2024`** — `DD/MM/YYYY`, **Gregorian (ค.ศ.), not พ.ศ.** |
| 4 | อ้างอิงกลุ่มรายการ (batch ref) | auto-generated if blank |
| 5 | product = `Payroll` | |
| 6 | service | `SCB Payroll` or **`SCB Payroll1 – SMART Credit (Next Day)`** for cross-bank |
| 7 | **System Reference ID** | from ข้อมูลของฉัน. Customers migrated from SCB Business Net enter their old **Corporate ID** instead |

**Template detail rows (fields 8–14; the cross-bank variant adds two more, 15–16, which the PDF text layer truncated):**

| # | Field | Notes |
| --- | --- | --- |
| 8 | ลำดับที่ | auto |
| 9 | เลือกธนาคาร | receiving bank — **a dropdown selection, not a 3-digit code** |
| 10 | เลขที่บัญชี / หมายเลขพร้อมเพย์ | **digits only**; PromptPay accepted in the same field |
| 11 | ชื่อผู้รับเงิน | Thai **or** English |
| 12 | จำนวนเงิน | *"ระบุจำนวนเงินสุทธิ โดยสามารถระบุทศนิยมสูงสุดได้ 2 ตำแหน่ง"* — **decimal baht, max 2 dp. NOT satang-integer.** |
| 13 | อ้างอิงรายการ | optional |
| 14 | หักค่าธรรมเนียมจาก | `Payer (OUR)` = company pays, `Recipient (BEN)` = deducted from the transfer |

⚠️ Field 9 wants the bank's **name as SCB labels it**, and field 3 wants **Gregorian** — both differ from every statutory format in this document.

### 4.2 KBANK — K-Cash Connect Plus / Bulk Gateway

`OFFICIAL` — Bulk Gateway user manual <https://www.kasikornbank.com/th/download/level4_doc/bg_user_manual_v2_th.pdf> (note: the host blocks plain `curl`).

Mechanism: download **`BG_Excel_Template.xls`** from inside Bulk Gateway, enable its **macros** (the manual devotes pp. 57–61 to macro setup for Excel 2007 and 2010–2016), fill in — per the manual, at minimum **เลขที่บัญชีผู้รับ, ชื่อ-นามสกุลผู้รับเงิน, จำนวนเงิน**, plus the company's **Cust ID** and debit account — then the macro **emits a text file into `D:\KbankText`**, which you upload choosing a **"รูปแบบไฟล์อัพโหลด"** (upload file format). Services covered: Payroll, PromptPay, Direct Debit.

**The layout is behind the login, and the manual says so:** the portal's own **ดาวน์โหลด** menu offers *"คู่มือการใช้งาน, เครื่องมือการจัดเตรียมข้อมูล, **รูปแบบไฟล์ต่างๆ**"*.
→ **`NOT FOUND` — spec available only to enrolled corporate customers, downloadable from inside Bulk Gateway.** An enrolled customer can hand it to us in one click.

**KBank does have a public API portal** with a **Corporate Fund Transfer** product: <https://apiportal.kasikornbank.com/product/public/All/Corporate%20%20Fund%20Transfer/Documentation>. Whether it supports batch payroll (as opposed to single transfers) was **not confirmed**.

### 4.3 ttb — business ONE

`OFFICIAL` — <https://www.ttbbank.com/th/howto/businessone/index.html>, with:

- <https://media.ttbbank.com/1/businessone/howto/transfering-file-upload.pdf> (upload flow)
- <https://media.ttbbank.com/1/businessone/howto/WebConverter_v4.pdf> (**the converter**)
- <https://media.ttbbank.com/1/businessone/howto/businessone_UserManual_TH_v3.pdf> (59 pp.)

**Web Converter flow:** สร้างไฟล์ใหม่ → specify **เลขที่บัญชีต้นทาง (Company Account), ประเภทการชำระเงิน, วันที่รายการมีผล (Effective Date), ผู้รับภาระค่าธรรมเนียม (ผู้สั่งจ่าย = company / ผู้รับเงิน = deducted from transfer), จำนวนรายการ** → then fill every `*` recipient field, and the manual explicitly says **you may paste the block straight from an external Excel** (*"สามารถ Copy ข้อมูลจาก Excel ภายนอกมาวางที่หน้าจอนี้ได้"*). The file lands in `Downloads`.

**Upload settings — the two facts worth having:**

| Setting | Required value |
| --- | --- |
| **การเข้ารหัส (encoding)** | **`TIS-620`** — *"ให้คงไว้ที่ 'TIS-620'"* |
| **รูปแบบไฟล์ (file format)** | **`SAPFORMAT NEW`** — set automatically |
| รูปแบบการประมวลผล | `Lumpsum` |
| เวลาส่งรายการ | `immediate` |
| ชื่อ Package | defaults to the filename; **must not duplicate a previously imported name** |
| PA code | select the employee plan, for payroll service |

`SAPFORMAT NEW`'s record layout is **`NOT FOUND`** — no ttb or third-party publication. **But we don't need it**: the documented, supported path is to produce an Excel block the user pastes into the ttb Web Converter.

### 4.4 KTB — Krungthai Corporate Online

`OFFICIAL`-adjacent (bank tooling documented in numerous Thai **government agency** manuals, which are official publications of those agencies but not of KTB).

Mechanism: a desktop tool, **KTB Universal Data Entry**, takes an Excel/keyed dataset and **"Extract"**s it to a **`.txt`** which is then uploaded (Browse → select Text File) in Krungthai Corporate Online. Representative manuals:

- <https://finance.wu.ac.th/wp-content/uploads/2020/07/คู่มือการใช้งาน-Krungthai-Corporate-Online2LV.pdf> (Walailak University, v.2020.09.07)
- <https://www.doa.go.th/hort/wp-content/uploads/2018/12/-KTB-Corporate-Online.pdf> (Dept. of Agriculture)
- <https://www3.ago.go.th/center/wp-content/uploads/2021/11/32-Krungthai-Corporate-Online.pdf> (Office of the Attorney General)

**Record layout: `NOT FOUND`.** Every manual documents the GUI and the "save as Text File" step, never the bytes.

### 4.5 BBL and Krungsri

- **BBL (Bangkok Bank)** — the **Direct Credit** product page (<https://www.bangkokbank.com/en/Business-Banking/Manage-My-Business/Payments/Direct-Credit>) states it can be sent via **Corporate iCash, BIZ iBanking, file upload, or branch counter**, and supports bulk payment from a single file. **No file specification is published.** `NOT FOUND — available only to enrolled corporate customers.`
- **Krungsri (Bank of Ayudhya)** — Krungsri Cash Management / Krungsri Biz Online. **`NOT FOUND`** — no public spec located; not reached in depth in this pass. *(One tangential `OFFICIAL` data point: Express ships an "Express & Krungsri Bill Payment" integration, so Krungsri does publish file interfaces to at least one Thai ISV under agreement.)*

### 4.6 The national rails: SMART / ITMX / bank codes

- **National ITMX** operates SMART (bulk credit) and PromptPay, established by the Thai Bankers' Association under the BOT's Payment System Committee. Its **Bulk Payment for Business** product page is <https://www.itmx.co.th/product-and-service/MTY2NjU0MzAyMQ==>. The platform is described as **ISO 20022-compliant** (`THIRD-PARTY` — techtalkthai / Data One Asia press coverage). **The SMART message/file specification is not published by ITMX or BOT.** `NOT FOUND` — it is distributed to member banks, which is why each bank ships a converter instead.
- **3-digit bank clearing codes** (our `Bank.code`): I could **not find an authoritative public list from BOT or National ITMX.** `NOT FOUND`. The values in circulation — 001 BOT, 002 BBL, 004 KBANK, 006 KTB, 011 TMB/TTB, 014 SCB, 017 Citibank, 020 SCBT, 025 BAY/Krungsri, 026 Mega ICBC, 031 HSBC, up to 073 — come from mirrored copies of a "SMART Member Banks" PDF on Scribd/dokumen.tips and from payment-processor docs such as <https://developer.2c2p.com/docs/payout-bank-code>. **`THIRD-PARTY`.** BOT's institution list (<https://www.bot.or.th/en/fi-list.html>) does not expose these codes; BOT's API returns an `FICode` field whose reference table I could not retrieve. **Treat our seeded `Bank.code` values as unverified against a primary source.**
- **Bank APIs vs files.** SCB's developer portal is at <https://developer.scb/> and is oriented to **payment acceptance** (SCB Payment Gateway, QR, SCB Easy deeplink) — **no bulk-payroll/direct-credit API found**. KBank's portal has **Corporate Fund Transfer**. Neither replaces the file route for payroll today. `OFFICIAL` for the portals' contents; `NOT FOUND` for a payroll-grade bulk API.

---

## 5. General interchange

### 5.1 The canonical journal-entry (GL) shape

Every target that accepts a journal converges on the same fields. Building **one internal `JournalEntry` model** and N thin serialisers is clearly right:

| Canonical field | PEAK | FlowAccount | Xero | QBO | SMEMove |
| --- | --- | --- | --- | --- | --- |
| Document date | `issuedDate` | `documentDate` (`YYYY-MM-DD`) | `Date` (`YYYY-MM-DD`) | `Journal Date` | `วันที่` |
| Document number | `code` | — | — | `Journal No.` | `เลขที่รายการ` |
| Journal book / type | `journalTypeId` | `documentType` (51=JV) | — | — | `สมุดรายวัน` (1=ทั่วไป) |
| Narration / memo | `description` | `description` | **`Narration`** (required) | `Journal/Description` | `รายละเอียด` |
| Reference | `reference` | `reference` | `Url` | — | — |
| **Line: account** | `accountCode` (6-digit, PEAK-assigned) | **`chartOfAccountId`** (numeric ID) | `AccountCode` **or** `AccountID` | `Account Name` (string!) | `ผังบัญชี` |
| **Line: debit** | `debit` | `debitCredit:1` + `value` | `LineAmount` **positive** | `Debits` | `เดบิต` |
| **Line: credit** | `credit` | `debitCredit:3` + `value` | `LineAmount` **negative** | `Credits` | `เครดิต` |
| Line: memo | `description` | `description` | `Description` | — | — |
| **Cost centre** | `accountSubId` | — | `Tracking` (max 2) | sub-account via `Parent: Child` | — |

**Three incompatible ways to name an account** — a PEAK-assigned code, a FlowAccount internal numeric ID, and a QBO account *name string*. Any mapping table must therefore store an **opaque per-target identifier**, not "the account code". See §6.4.

**Debit/credit is represented three ways** — two columns, a sign, or a discriminator. Model it internally as **signed decimal, debit-positive** (Xero's convention) and derive the rest.

### 5.2 CSV / XLSX conventions

- **XLSX sidesteps every encoding problem** and is what Thai accountants actually pass around. Default to XLSX for human-facing exports; reserve raw text for machine targets that demand it.
- **CSV for Excel in a Thai locale needs a UTF-8 BOM** or Windows Excel assumes ANSI/CP874 and mojibakes Thai. Our `toCsv` already emits `\uFEFF` — correct for that audience, **wrong for RD and bank files** (§6.6).
- **Delimiters seen in the wild:** `,` (Excel/QBO/Xero/RD-FUND), `|` (RD FORMAT 1.0 and 2.0, and accepted by RD-FUND), fixed position (RD Prep can consume it, banks emit it).

### 5.3 e-Tax Invoice / e-Receipt and PEPPOL — **out of scope**

**Verdict: not in scope for a payroll system.** Reasoning, `OFFICIAL` unless noted:

- **e-Tax Invoice & e-Receipt** (ใบกำกับภาษีอิเล็กทรอนิกส์และใบรับอิเล็กทรอนิกส์, <https://etax.rd.go.th/>) covers **VAT invoices, debit notes, credit notes and receipts** — sales-side documents. *"ใบกำกับภาษีในที่นี้ รวมถึง ใบกำกับภาษี ใบเพิ่มหนี้ และใบลดหนี้."* **Salary is not a VAT supply and a payslip is not a ใบกำกับภาษี.** No payroll touchpoint.
- **PEPPOL** — Thailand's e-invoicing standardisation sits with **ETDA** (ข้อเสนอแนะมาตรฐาน ขมธอ. series). Even where adopted, PEPPOL carries **commercial invoices between trading parties**, never payroll. I did **not** verify Thailand's current PEPPOL-authority status — **`NOT FOUND`**, and it does not change the conclusion.
- **e-Withholding Tax** (<https://epay.rd.go.th/>) is the **one adjacent system that genuinely touches payroll**: it covers ภ.ง.ด.1, 1ก, 1กพิเศษ, 2, 2ก, 3, 3ก, 53, 54, and users of it are relieved from filing those returns and from issuing 50 ทวิ (`THIRD-PARTY` — iTAX and multiple vendor summaries; I could not retrieve RD's own `e-WithholdingTax.pdf`, which 500s). It is bank-mediated and mostly used for supplier payments. **Worth a line in a future roadmap, not in scope now.**

---

## 6. Thai-specific gotchas

### 6.1 Encoding — the received wisdom is *wrong* for the Revenue Department

| Target | Required encoding | Confidence |
| --- | --- | --- |
| **RD FORMAT 2.0 (ภ.ง.ด.1 `.txt`)** | **UTF-8** — *"ชนิดไฟล์ข้อมูล UNICODE จะต้องกำหนดเป็น UTF8"* | `OFFICIAL` |
| **RD FUND CSV (ภ.ง.ด.1ก)** | **UTF-8 or UTF-8 with BOM** | `OFFICIAL` |
| **RD-Payroll CSV (ภ.ง.ด.91 นายจ้างยื่นแทน)** | **UTF-8 only** — *"ทำการ save อีกครั้ง โดยระบุ encoding เป็น utf-8 เท่านั้น เนื่องจากโปรแกรม rd-payroll ไม่รองรับการ encoding รูปแบบอื่น"* | `OFFICIAL` — <https://www.rd.go.th/region/01/fileadmin/user_upload/2568/25682760/manual-excel-to-rd-payroll.pdf> |
| **ttb business ONE upload** | **TIS-620** | `OFFICIAL` |
| **Express** | `.dbf`, DOS/FoxPro lineage ⇒ presumably TIS-620/CP874 | **`NOT FOUND` — never stated** |
| **SSO สปส.1-10 text file** | **`NOT FOUND`** — never stated in the format spreadsheet. Circumstantial: sso.go.th serves `charset=TIS-620`; the same downloads page ships a `FontPack1000_Xtd_Lang` legacy codepage pack; the format workbooks are BIFF `.xls` from 2010/2015; and **the zip entry names themselves are TIS-620 bytes** (`Formatเงินสมทบ135ใหม่.xls` only decodes under TIS-620/CP874). **Emit CP874 and verify against a portal-downloaded sample.** | inference |

> **So: "Express is notorious for TIS-620" is fair, but "the RD needs TIS-620" is false — the RD is explicitly UTF-8, twice over.** Encoding must be a **per-target parameter**, not a global.

**Node/TypeScript implementation** — `iconv-lite`, verified against the library's own generated tables (`OFFICIAL`, <https://github.com/ashtuchkin/iconv-lite/wiki/Supported-Encodings> + `encodings/sbcs-data.js` / `sbcs-data-generated.js`):

- Keys that exist: **`windows874`** (canonical), aliases **`win874`**, **`cp874`**, **`874`**; plus separate **`tis620`** (aliases `isoir166`, `tis6200`, `tis62025291`, `tis62025330`) and **`iso885911`** (aliases `thai`, `thai8`).
- Label matching is normalised: lower-cased, and non-alphanumerics stripped — so `"TIS-620"`, `"tis620"` and `"TIS 620"` all resolve.
- **`tis620` and `windows874` are byte-identical for `0xA1`–`0xFF`** (the entire Thai block, `0xA1` = U+0E01 ก onward). They differ **only in `0x80`–`0xA0`**: `windows874` defines € (0x80), … (0x85), the curly quotes and en/em dashes (0x91–0x97) and NBSP (0xA0); `tis620` leaves all of those **undefined**. `iso885911` instead maps `0x80`–`0xA0` to raw C1 controls + NBSP.
- **Practical rule for the ttb "TIS-620" file: encode with `cp874`, but first sanitise the text of curly quotes, en/em dashes, ellipses and NBSP** — those are exactly the code points strict TIS-620 cannot represent, and they are exactly what a copy-paste from Word or a smart-quote-happy admin field produces.
- Confirmed with Unicode's own table: <https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WINDOWS/CP874.TXT> — `0x80`→U+20AC, `0x85`→U+2026, `0x91`–`0x97`→U+2018/2019/201C/201D/2022/2013/2014, `0xA0`→U+00A0; `0xDB`–`0xDF` and `0xFC`–`0xFF` **undefined in both**.

### 6.2 Buddhist vs Gregorian era — it is genuinely mixed

| Target | Era | Format |
| --- | --- | --- |
| **RD `TAX_YEAR`** | **พ.ศ.** | `YYYY` (`2568`) |
| **RD `PAID_DATE`** | **พ.ศ.** | `DDMMYYYY` (`01012567`) |
| **RD FUND CSV col B** | **พ.ศ.** | `YYYY` |
| **RD FORMAT 1.0 `TAXYEAR` / `PAYDATE`** | **พ.ศ.** | `YYYY` / `DDMMYYYY` |
| **SSO `PAID DATE`** | **พ.ศ.** | **`DDMMYY`** — only *two* year digits |
| **SSO `PAID PERIOD`** | **พ.ศ.** | **`MMYY`** |
| **SSO สปส.1-03 `BIRTH` / `START DATE`** | **พ.ศ.** | `DDMMYYYY` |
| **SCB payroll template** | **ค.ศ. (Gregorian)** | `DD/MM/YYYY` — example `01/05/2024` |
| **FlowAccount / Xero** | **ค.ศ.** | `YYYY-MM-DD` |
| **PEAK / QBO / SMEMove** | not stated | **`NOT FOUND`** |

> **Never apply era conversion globally.** Same payroll month, same export run: the RD file says `2568` and the SCB file says `2025`. Era belongs on the *serialiser*, alongside encoding.

### 6.3 Thai national ID (เลขประจำตัวประชาชน)

- **13 digits, bare, no dashes** in every machine format checked: RD `PIN` is `C(13)`; RD `SENDER_NID`/`NID` are `C(13)`; the FUND CSV column A is `C,13`. The `X-XXXX-XXXXX-XX-X` dashed form is a **display** convention only.
- **Checksum** — weighted mod-11: multiply digits 1–12 by weights 13,12,…,2; sum; the check digit is `(11 − (sum mod 11)) mod 10`. **`THIRD-PARTY`** — I could not find this published by the Department of Provincial Administration (bora.dopa.go.th) itself; the descriptions in circulation are consistent with each other and with Microsoft Purview's Thai population identification code SIT definition, but **no primary source was located.** Safe to implement (it is trivially self-verifying against real IDs) but do not cite a government source for it.
- **Individual tax ID = national ID.** RD's `TIN` field is the **legacy 10-digit** number, and the spec says to send **`0000000000`** when absent — which is the normal case for a modern employee. Do not confuse the two.
- **Foreign employees:** RD Prep's ภ.ง.ด.91 FAQ notes a foreign national's ID *can* be filed but must not begin with certain digits, and that a foreigner with **no surname** must have the field set to a dash `-` — *"ต้องใส่ข้อมูลเป็นขีด (-) ห้ามใส่ค่าเป็นศูนย์ (0) หรือค่าว่าง"* (`OFFICIAL`). For SSO, the paper form instructs that a foreign insured person's **social-security card number** goes in the ID field (`OFFICIAL`, สปส.1-10 form).

### 6.4 Numbers

- **RD:** two decimals with a literal `.`; **no thousands separator** (comma is a *forbidden character*); missing ⇒ `0.00`; negatives as a leading `-` (`-500.00`); `N(15,2)` counts the decimal point in its 18 characters; round half-up at the third decimal.
- **RD FUND CSV:** explicit — *"จำนวนเงินตั้งแต่ 1000.00 บาท จะไม่มี comma"*.
- **SCB:** decimal baht, **max 2 dp**.
- **SSO สปส.1-10 text file:** **satang-integer** — right-aligned, zero-filled, ×100, no decimal point (§1.5). Its Excel template, by contrast, takes plain decimal numbers.
- **Satang-as-integer for *banks*:** a common convention worldwide, and confirmed for SSO — but **I found no Thai *bank* document confirming it**, and the one bank whose field description I *could* read (SCB) explicitly uses decimals. **Do not assume satang-integer for any bank until you have that bank's actual spec.** `NOT FOUND`.

### 6.5 File naming

| Target | Convention | Confidence |
| --- | --- | --- |
| **RD FORMAT 2.0** | `TAX_TYPE _ NID(13) _ BRANCH_NO(6) _ TAX_YEAR(4) _ TAX_MONTH(2) _ FORM_TYPE(2) _ ครั้งที่ส่ง(00-99).txt` | `OFFICIAL` |
| **RD FUND CSV** | `FUND_<ประเภทภาษี>_<TIN13>_<ปีภาษี พ.ศ.>.csv`, e.g. `FUND_PND1A_1234567890123_2564.csv` | `OFFICIAL` |
| **RD FORMAT 1.0** | literally **`PND1.txt`** | `OFFICIAL` |
| **RD Format 1.0 Excel variant** | `ประเภทแบบ_ชื่อหน่วยงาน_ปีภาษี.xls[x]` | `OFFICIAL` |
| **ttb** | filename free, but the derived **Package name must not duplicate a prior import** | `OFFICIAL` |
| **KBANK** | macro writes into `D:\KbankText` | `OFFICIAL` |
| **SSO Excel template** | filename free, but the **worksheet name must equal the 6-digit ลำดับที่สาขา** | `OFFICIAL` |
| **SSO text file / SCB / KTB / BBL** | none documented | `NOT FOUND` |

> Our SSO route currently names the download `สปส1-10_<branch>_<month>.xlsx` with an ASCII `filename=` fallback. Fine for a human file; **RD files must use the exact ASCII pattern above** and must not be renamed.

### 6.6 ⚠️ Three findings against our existing export code

**(0) The สปส.1-10 XLSX columns do not match SSO's official template — and this one *is* shipped.**
`src/lib/filings/sso-1-10-xlsx.ts` emits `ลำดับที่ | เลขประจำตัวประชาชน | ชื่อ-สกุล | ค่าจ้าง | เงินสมทบ` beneath a merged title block, with a totals block below. SSO's official template (§1.5) is a bare 6-column sheet — `เลขประจำตัวประชาชน | คำนำหน้าชื่อ | ชื่อผู้ประกันตน | นามสกุลผู้ประกันตน | ค่าจ้าง | จำนวนเงินสมทบ` — with **no sequence column, no title block, no totals**, names **split**, a **prefix column we don't have**, and a **worksheet name that must be the 6-digit branch number**. The file's own `⚠️ VERIFY BEFORE SHIP` comment anticipated exactly this. *(As a human working paper the current sheet is fine; as a portal upload it is not.)*

The remaining two are in `src/lib/export/csv.ts`. Both are **correct for the human/Excel audience it was built for**, and neither is a bug today because nothing statutory flows through `toCsv` yet — but both become bugs the moment a statutory writer reuses it:

1. **The formula-injection guard injects a forbidden character.** `toCsv` prefixes a `'` to any string starting with `= + - @`:

   ```ts
   if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
   ```

   The RD FORMAT 2.0 spec **forbids the single quote `'` outright**, along with `* + / \ ! $ % # & @` and the comma. An employee record with a leading `-` (or a name field an admin typed oddly) would emit a character the RD parser rejects.

2. **The unconditional UTF-8 BOM.** `toCsv` always returns `` `\uFEFF${…}` ``. The RD FUND CSV explicitly permits a BOM; the **FORMAT 2.0 `.txt` spec does not mention one**, and a BOM would land inside field 1 of the HEADER record where the parser expects exactly `H`. TIS-620 targets (ttb) must have **no BOM at all**.

The fix for (1) and (2) is a **separate writer** for machine targets: per-target encoding, per-target delimiter, no BOM, no injection guard, and a **character-allowlist validator that rejects the row rather than silently mangling it**. `toCsv` should keep its BOM and its guard and stay pointed at human-facing reports.

---

## 7. What our data model is missing

Assessed against `prisma/schema.prisma` as of this commit. This section matters as much as the formats.

### 7.1 Blocking — ภ.ง.ด.1 cannot be produced at all

| Missing | Needed for | Notes |
| --- | --- | --- |
| **Withholding tax withheld per payslip** | `TAX_AMT` (detail #12), `TOT_TAX`/`GTOT_TAX` (header #17/#19) | Confirmed absent. `Payroll` has `deductSso … deductOther`, no tax column. **This is the single biggest gap.** |
| **A PIT calculation engine** | the number that goes in that column | Requires progressive brackets, ค่าใช้จ่าย 50% capped ฿100k, personal/spouse/child allowances, SSO and PF deductions, insurance/RMF/SSF. The RD's own ภ.ง.ด.91 transfer format enumerates **63 fields**, of which #22–#63 are allowances — a real scope. |
| **Employer tax identity** | header #3,#7 `NID`, #4,#8 `BRANCH_NO`, #9 `DEPT_NAME`, #10 `LTO`, #13 `BRANCH_TYPE`, #21 `USER_ID` | `Branch` carries `payslipNameEn`, `payslipNameNative`, `ssoAccountNo`, `address` — but **no 13-digit tax ID**, no 6-digit VAT/SBT branch number, no branch type, no LTO flag, no e-Filing UserID. **These belong on `Branch`, not in a new `Company` model** — the branches are separate registered companies (§7.6). |
| **Title prefix (คำนำหน้าชื่อ)** | detail #6 `TITLE_NAME`, mandatory | `Employee` has `firstName`, `lastName`, `nickname` only. |
| **Structured address** | detail #24 `AMPHUR`, #25 `PROVINCE`, #26 `POSTAL_CODE` — all mandatory | `Employee.address` is a single free-text `String?`. Cannot be split reliably. Mandatory for ภ.ง.ด.1ก. |
| **Income-type classifier** | detail #13 `INC_TYPE_PND` | Needs to distinguish 40(1) salary from 40(2) fees and from **40(1)(2) ออกจากงาน** (severance) — which in turn needs a termination date and a severance flag. |
| **Tax-condition flag** | detail #14 `PAY_CON` | 1 = withheld / 2 = employer bears it permanently / 3 = one-off. A per-employee or per-payroll policy field. |
| **Termination date** | `INC_TYPE_PND=3`, ภ.ง.ด.1ก leavers, SSO สปส.6-09 | `Employee.archivedAt` is a **soft-delete timestamp, not an employment end date**, and the repo's own memory warns never to archive an Employee with a linked User. These are different concepts and need different columns. |

### 7.2 Blocking — ภ.ง.ด.1ก fund CSV

| Missing | Needed for |
| --- | --- |
| **Provident fund (กองทุนสำรองเลี้ยงชีพ) employee contribution** | FUND CSV **column E** |
| *(employer PF contribution)* | not in the CSV, but needed for the GL and for PIT |

`Payroll.deductSso` covers column D. Column C (กบข./กสจ.) is public-sector and will always be `0.00`.

### 7.3 Blocking — bank direct-credit files

| Missing | Needed for |
| --- | --- |
| **Company bank configuration** — debit account no., fee account no., **SCB System Reference ID / Corporate ID**, **KBank Cust ID**, ttb Company Account + PA code | SCB fields 1,2,7; KBank template; ttb converter header |
| **Payment effective date** on a payroll run | SCB field 3, ttb Effective Date. `Payroll.publishedAt` is a *publish* timestamp, not a value date, and cannot be a future-dated instruction. |
| **Fee-bearer policy** (`Payer (OUR)` / `Recipient (BEN)`) | SCB field 14, ttb ผู้รับภาระค่าธรรมเนียม |
| **Bank display label per target** | SCB field 9 is a **dropdown of bank names**, not our 3-digit `Bank.code`. `Bank.nameTh`/`nameEn`/`shortName` exist but are not guaranteed to match SCB's own strings. |
| **PromptPay ID** (optional) | SCB field 10 accepts PromptPay in place of an account number |

What we *do* have and is correct: `Employee.bankId → Bank.code`, `bankAccountNumber`, `bankAccountName`, and `Payroll.netPay`.

### 7.4 Blocking — สปส.1-10 (now that the layout is known)

| Missing | Needed for |
| --- | --- |
| **Title prefix (คำนำหน้าชื่อ)** | Detail pos 15–17, as the **3-digit code** `003`/`004`/`005` in the text file and as the **Thai word** in the Excel template. Same gap as ภ.ง.ด.1 (§7.1) but with a second encoding of it. |
| **First/last name as separate columns in the export** | We *have* `firstName`/`lastName` on `Employee`, but `sso-1-10-xlsx.ts` **concatenates them** into one `ชื่อ-สกุล` column. The official template wants them split. Easy fix. |
| **Branch's 6-digit ลำดับที่สาขา** | Header pos 12–17, and the **Excel worksheet name**. `Branch.ssoAccountNo` holds the 10-digit employer account (header pos 2–11) but there is **no branch sequence number**. |
| **Payment date (วันที่ชำระเงิน)** | Header pos 18–23. Not the payroll month and not `publishedAt` — it is when the employer remits. Same missing concept as the bank effective date (§7.3). |
| **Employer contribution as a stored number** | Header pos 124–135. Currently computed on the fly in `loadSsoFiling` and never persisted (see §7.5). |
| **Contribution rate as filed** | Header pos 73–76. `PayrollConfig.ssoRate` is a live singleton; the filing needs the rate **frozen for that period**, or a re-filing of an old month will use today's rate. |

### 7.5 Blocking — any GL / journal export

| Missing | Why it blocks |
| --- | --- |
| **A chart-of-accounts mapping table** | `AccountingGroup.peakCode` is **one code per employee group**. A payroll journal needs a code per **line type**: salary expense, OT expense, allowance expense, employer-SSO expense, SSO payable, WHT payable, advance receivable, net-pay payable/bank. One code per group cannot express that. Needs a real `(targetSystem, componentKey, accountingGroupId?) → externalAccountRef` table. |
| **`peakCode` has the wrong shape and the wrong provenance** | It is `String? @unique` on `AccountingGroup`, implying an admin types it. **PEAK auto-assigns its 6-digit codes and forbids the user from setting them** (§2.1) — so the value must be *fetched from PEAK*, and `@unique` across groups is an arbitrary constraint PEAK never imposes. |
| **One identifier space is not enough** | PEAK wants a 6-digit **code**; FlowAccount wants a numeric **`chartOfAccountId`**; QBO wants an account **name string**; Xero accepts either a code or a UUID. The mapping must store an **opaque per-target string**, not "the account code". |
| **Employer-side costs are never stored** | Employer SSO is computed on the fly inside `loadSsoFiling` (`employerContribution = employeeContribution`) and **never persisted to `Payroll`**. A GL entry needs it as a stored, frozen number. Workmen's-compensation accrual doesn't exist at all. |
| **OT is not separable from other income** | `Payroll` has `incomeBase`, `incomeOther`, `incomeAllowance` — **no `incomeOt`**. OT lands inside `incomeOther`, so a journal cannot split OT expense from other income without re-reading and re-summing `OvertimeEntry`, which risks disagreeing with the frozen payslip. |
| **No cost-centre dimension on the journal** | Derivable from `Employee.departmentId`/`branchId`, but nothing decides *which* dimension a given target should receive (Xero allows max 2 tracking categories per line). |

### 7.6 Non-blocking but will bite

| Missing | Impact |
| --- | --- |
| **Human-readable employee code** | `Employee.id` is a UUID. Bank references, GL memos, and every second-tier accounting import expect a short stable staff number. Prosoft's own guidance for cross-system GL export is that **รหัสบริษัท, รหัสสาขา, รหัสพนักงาน, รหัสประเภทเอกสารบัญชี, รหัสบัญชีแยกประเภท must match on both sides.** |
| **Company tax ID has nowhere to live** | ⚠️ **Read this before designing a `Company` model.** Per the earlier draft of this document, **this deployment's branches are separate registered companies**, so per-branch filing is already correct and *"a `Company` model is not required; adding `taxId` to `Branch` is enough."* That is domain knowledge, not a web finding, and it overrides the generic advice I'd otherwise give. **The cheap correct move is `Branch.taxId` (13-digit) plus `Branch.rdBranchNo` (6-digit) — not a new entity.** But record the assumption: RD `BRANCH_NO` is a *legal entity's VAT branch*, the SSO account is per *establishment*, and the bank debit account is per *company* — three axes that a future shared-legal-entity branch would prise apart. |
| **Nationality / work-permit / passport** | Foreign employees have distinct RD and SSO ID handling (§6.3). |
| **SSO enrolment start/end dates** | สปส.1-03 / 6-09; also needed to know which months an employee belongs in สปส.1-10. `Employee.hasSso` is a boolean with no history. The สปส.1-03 layout (§1.5) additionally wants nationality code, sex, marital status, alien flag, children + their DOBs, and **three hospital choices** — none of which we store. |
| **SSO wage ≠ `incomeBase` once proration lands** | Already flagged in `src/lib/filings/sso.ts` (`TODO(proration)`). Still true. |
| **Allowance treatment for SSO** | Already recorded as an open compliance question in project memory; unchanged by this research. |
| **Payroll-run / batch entity** | Every bank file and every RD filing is a *batch* with its own effective date, sequence number (`FORM_TYPE` / ครั้งที่ส่ง), and submission status. `Payroll` is per-employee-per-month with no batch parent, so re-submissions (`ยื่นเพิ่มเติมครั้งที่ n`) have nowhere to live. |
| **Export/filing audit trail** | `AuditLog` exists, but nothing records "this exact file was generated for this period and submitted". Needed for `FORM_TYPE` sequencing and for support. |

---

## 8. What I could not verify

1. **สปส.1-10 text-file encoding and text-field padding.** The layout is resolved (§1.5) but the format spreadsheet states neither the character encoding nor whether text fields are space-padded left or right. TIS-620/CP874 and left-alignment are strong inferences, not facts. **Resolve with one portal-downloaded sample** via *"ดาวน์โหลดไฟล์อัพโหลดสปส.1-10"*, or by running SSO's own **SSO Media 2.0** generator and inspecting its output.
2. **The SSO `RATE` field's scaling.** `0300` for 3% implies two implied decimals (5% → `0500`), but no 5% example appears in the file.
3. **The 2569 SSO ceiling gazette reference.** The ฿17,500 / ฿875 figures are well corroborated on sso.go.th and in press, and the repo's seed already uses them — but **I did not retrieve the กฎกระทรวง itself.** Get the เล่ม/ตอน/หน้า from ratchakitcha.soc.go.th before citing it in code comments or a compliance doc. Note SSO's own general contribution page still shows the *old* ฿15,000/฿750 and appears stale.
4. **The ประกาศอธิบดี number that abolished paper ภ.ง.ด.1.** Search results give both ฉบับที่ 438 (21 ก.ย. 2566) and a superseding ฉบับที่ 451. The *outcome* (electronic-only from 1 ม.ค. 2567) is well corroborated; the citation number is not.
5. **50 ทวิ required content in law.** The RD download page cites มาตรา 50 ทวิ but I did not find the ประกาศอธิบดี prescribing the certificate's fields.
6. **KBANK, BBL, KTB, Krungsri and ttb record layouts.** All customer-only. KBank's is explicitly downloadable from inside Bulk Gateway ("รูปแบบไฟล์ต่างๆ"); the others were not located at all. Krungsri was not researched in depth.
7. **National ITMX / SMART message specification** and an **authoritative BOT/ITMX 3-digit bank code list.** Neither is public. Our seeded `Bank.code` values rest on third-party mirrors.
8. **PEAK's and FlowAccount's Excel import column headers.** Both vendors show the template only as a screenshot and require an in-app download. Obtainable in minutes with a trial account — worth doing before designing against them.
9. **Express's character encoding**, stated explicitly. Inferred from the FoxPro/`.dbf` lineage, never documented.
10. **Whether KBank's Corporate Fund Transfer API supports batch payroll** as opposed to single transfers.
11. **Thailand's current PEPPOL authority status.** Does not affect the out-of-scope conclusion.
12. **Thai national ID checksum from a primary government source.** The algorithm is consistent across every secondary source and is self-verifying, but bora.dopa.go.th does not appear to publish it.
13. Several **large RD and bank PDFs would not yield a text layer** to a plain fetch and had to be downloaded and run through `pdftotext`; a few (ttb's 59-page manual, KTB's agency guides) were only partially mined. There may be more layout detail in them than this document captures.
