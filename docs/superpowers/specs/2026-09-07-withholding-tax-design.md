# Withholding tax in payroll — Phase 1: record it

**Status:** design, awaiting review
**Branch:** `feat/accounting-exports`
**Prior art:** `docs/research/2026-09-07-thai-accounting-export-formats.md`,
`docs/superpowers/status/2026-09-07-handoff.md`

---

## 1. What this is for

ภาษีหัก ณ ที่จ่าย is computed today by an outside accountant. This phase makes the
system **record** that figure. It does not compute it.

That split is the whole point of the design, so it is worth being explicit: ภ.ง.ด.1
does not ask how a tax figure was derived. It asks, per employee per month, what was
paid and what was withheld. **Every downstream deliverable needs tax recorded, not tax
calculated** — the payslip, the payroll journal, ภ.ง.ด.1, ภ.ง.ด.1ก and 50 ทวิ. The
calculator is the expensive, high-risk half, and nothing is blocked on it.

Recording first also produces the thing a tax calculator most needs and rarely has: a
corpus of known-correct figures to validate against. Each month recorded here becomes a
Phase 2 test case.

## 2. What is true today (verified against prod, 2026-09-07)

- 331 payrolls, 50 employees, months `2026-06` … `2027-04`. Max monthly gross ฿42,500.
  18 payroll-months exceed ฿25,834 gross, the rough level at which annualised PIT bites.
- **Withholding tax is recorded nowhere.** `Payroll` has `deductSso`, `deductAdvance`,
  `deductAttendance`, `deductLeave`, `deductDebt`, `deductOther` — none is tax.
- It is not hiding in `deductOther`. That bucket lands almost entirely *below* the PIT
  threshold (50 of 51 rows, avg ฿2,210, min ฿0.33), and its single appearance above the
  threshold is ฿20,000 — 47% of gross, which no PIT rate reaches. The actual
  `PayrollAdjustment` reasons are `วีซ่า 5/6`, `เบิกล่วงหน้า`, `หัก เงินยืม`,
  `ค่าเช่าห้อง+น้ำไฟ`, `ซื้อจอ`. Not one mentions ภาษี.

### 2.1 The consequence, which is a live defect and not a missing feature

If tax is withheld from what employees actually receive, then `Payroll.netPay` is not
the amount reaching their bank account — and neither is the figure on the payslip PDF
they are shown in LINE. The payroll journal export has the same hole: it credits a
`NetPayable` that does not match the real disbursement and carries no WHT line at all.

**This is unconfirmed.** The owner is checking with the accountant whether take-home
currently matches our `netPay`. The design below works either way, which is why it was
not made a blocker.

## 3. Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Compute or record | **Record** | See §1. Phase 2 may add the calculator. |
| Where the figure enters | **A new `AdjustmentKind.Tax`** | See §4. |
| Global switch | `PayrollConfig.whtEnabled`, default `false` | Merging changes no behaviour until flipped. |
| Who bears the tax | Per **employee** flag | Both are legitimate Thai practice and it varies per person, not per company. |
| Recurrence for `Tax` | **One-time only** (`startMonth === endMonth`) | An open-ended tax adjustment repeats a stale figure into every future month and silently misreports ภ.ง.ด.1. |

### 3.1 Rejected alternatives

**An editable `deductTax` field on the payroll row.** It matches how tax behaves — a
fresh number monthly, never recurring — but fights the architecture. `calcPayroll` is a
pure `CalcInput → PayrollDraft`, and recalculation is idempotent precisely because every
admin-entered amount arrives as an *input* selected by month range, never read back from
the row it produced. A hand-typed value on the output row would force recalc to read its
own prior output to avoid destroying it, making it order-dependent.

**A dedicated `WithholdingTax` model** keyed `(employeeId, month)`. Cleanest domain
model, and Phase 2 could hold computed-vs-recorded side by side. Rejected as YAGNI: it
duplicates working machinery (entry UI, audit trail, month-range selection), and Phase 2
can add comparison without it.

## 4. Design

### 4.1 Schema — one migration

```
enum AdjustmentKind { Income  Deduction  Tax }          // + Tax

model Payroll        { deductTax  Decimal @default(0) @db.Decimal(12, 2) }
model PayrollConfig  { whtEnabled Boolean @default(false) }
model Employee       { taxBorneByEmployer Boolean @default(false) }
model Branch         { taxId String?   taxBranchNo String? }

enum JournalLineKind { …  WhtPayable  WhtExpense }      // + both
```

`Branch.taxId` is the 13-digit employer tax ID; `taxBranchNo` the 5-digit branch
(`00000` = head office). Both nullable: they are unknown until an admin enters them, and
the ภ.ง.ด.1 route must refuse to emit a file without them rather than emit a blank field
— the same pre-flight 422 pattern `filings/sso/export/route.ts` already uses.

Branches are separate registered companies (confirmed by the owner), so employer
identity belongs on `Branch` and no `Company` model is needed. A future shared-entity
branch would break that assumption.

### 4.2 The one piece of real logic

`deductTax` always holds **the tax remitted to the Revenue Department for that
employee-month**, regardless of who bears it. `netPay` subtracts it **only when the
employee bears it**.

```
deductTax = Σ adjustments where kind === 'Tax'          // always
netPay   -= employee.taxBorneByEmployer ? 0 : deductTax
```

When the company bears the tax it is still reported on ภ.ง.ด.1 and still reaches the
ledger — as an expense rather than a deduction — but take-home is untouched.

Grossing-up (a tax the employer pays is itself taxable income) is deliberately **out of
scope**: we are recording the accountant's figure, and they have already grossed up.
Phase 2 inherits this problem, not Phase 1.

When `whtEnabled` is `false`, `deductTax` is 0 and `Tax` adjustments are not selectable
in the UI. The column still exists, so turning the flag on is not a migration.

### 4.3 Journal lines

Employee-borne: `WhtPayable` credit (a liability to RD, alongside `SsoPayable`), and the
existing `NetPayable` credit shrinks by the same amount — so the entry still balances
with no new debit.

Employer-borne: `WhtExpense` debit **and** `WhtPayable` credit. `NetPayable` is
unchanged, and the entry balances because both new lines are equal and opposite.

Both kinds need an `AccountMapping` row per branch. `buildPayrollJournal` already throws
`UnmappedAccountsError` for any non-zero bucket without a mapping, so an unmapped WHT
account blocks the export rather than silently dropping the line — the existing
behaviour, inherited free.

### 4.4 Guard against the failure mode this design introduces

The real risk of routing tax through `PayrollAdjustment` is **misfiling**: someone
enters tax as `Deduction` out of habit, it lands in `deductOther`, ภ.ง.ด.1 under-reports,
and nothing complains. Mitigation: the adjustment form rejects a `Deduction` whose reason
matches `/ภาษี|หัก ณ ที่จ่าย|withholding|wht|ภงด|ภ\.ง\.ด/i` and tells the user to pick
`Tax`. A validation, not a silent reclassification — the admin's intent should be
explicit.

## 5. Milestones

Each is independently shippable and separately reviewable.

- **M1 — schema + engine.** The migration; `calcPayroll` sums `Tax` adjustments into
  `deductTax` and applies the bearer rule; unit tests.
  Hand-author the numbered migration (next is `0051`). `prisma migrate dev
  --create-only` emits spurious `DROP DEFAULT` statements against this schema — a known
  trap in this repo, and one that would silently strip defaults off unrelated columns.
- **M2 — entry and display.** `Tax` in the adjustment form (one-time only; hidden while
  `whtEnabled` is false), the `taxBorneByEmployer` field on the employee form, a tax line
  on the payslip and the payroll run screen, and the §4.4 guard.
- **M3 — journal.** `WhtPayable` / `WhtExpense` in `payroll-journal.ts`, the account
  mapping UI, and balance tests for both bearer modes.
- **M4 — ภ.ง.ด.1.** `Branch` tax identity fields and their settings UI, then the export
  itself, targeting RD Prep's interactive column mapper (per the research, a clean
  pipe-delimited UTF-8 file with a Thai header row is a legitimate v1; FORMAT 2.0 is a
  later optimisation). A pre-flight 422 when tax identity or any employee national ID is
  missing.

## 6. Testing

`calcPayroll` is pure, so the bearer rule is provable in unit tests without a database —
the same reason `calcSsoParts` is tested that way. Specifically:

- `deductTax` sums only `Tax`-kind adjustments, never `Deduction`.
- Employee-borne reduces `netPay`; employer-borne does not; `deductTax` is identical in
  both.
- `whtEnabled: false` yields `deductTax: 0` even when `Tax` adjustments exist.
- The journal balances in both bearer modes (integer satang, exact).
- Recalculating a month twice is idempotent — the property the adjustment route exists
  to preserve.

Each test must be seen to fail before it is trusted.

## 7. Explicitly out of scope

The ม.50(1) projection engine, employee tax profiles (ลดหย่อน, dependants, provident
fund, marital status), progressive brackets, grossing-up, ภ.ง.ด.1ก, 50 ทวิ, and
structured employee addresses. All belong to Phase 2 and several are blocked on schema
work this phase does not touch.

## 8. Open questions

1. **Does take-home currently match our `netPay`?** (§2.1) With the accountant. Changes
   urgency, not design.
2. **Which employees, if any, are `taxBorneByEmployer`?** Default `false` is safe: it
   matches the norm, and being wrong shows up as a payslip discrepancy rather than a
   filing error.
3. **Historic months.** 2026-06 onward have no tax recorded. Whether to backfill from the
   accountant's records — needed for ภ.ง.ด.1ก and 50 ทวิ, which are built from the whole
   tax year — is a data question for the owner, not a code question.
