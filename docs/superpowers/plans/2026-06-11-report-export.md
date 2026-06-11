# Report Export (PDF / Excel / CSV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PDF / Excel / CSV export to the three admin reports (attendance, leave, advance), styled to the Sapphire Editorial design language, via a single GET route.

**Architecture:** Each report maps its existing query rows to a shared `ExportTable` model; three format writers (csv / exceljs / puppeteer HTML→PDF) consume it; one dynamic route handler `GET /admin/reports/[report]/export` gates with `report.read` and streams the file. Report pages gain three `<a>` export buttons that carry the current search params.

**Tech Stack:** Next.js 16 route handler (Node runtime), exceljs, puppeteer-core + @sparticuz/chromium, IBM Plex Thai TTFs embedded for PDF. Vitest co-located tests (`foo.ts` ↔ `foo.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-11-report-export-design.md`

**Worktree note:** run `export PATH=/opt/homebrew/bin:$PATH` in every shell (node 24 / pnpm). Tests: `pnpm test`, typecheck: `pnpm typecheck`, lint: `pnpm lint:fix`.

---

### Task 1: Dependencies, config, fonts

**Files:**
- Modify: `package.json` (via pnpm add)
- Modify: `next.config.ts:36` (serverExternalPackages)
- Create: `src/lib/export/fonts/IBMPlexSansThai-Regular.ttf`, `src/lib/export/fonts/IBMPlexSansThai-Bold.ttf`

- [ ] **Step 1: Install dependencies**

```bash
export PATH=/opt/homebrew/bin:$PATH
pnpm add exceljs puppeteer-core @sparticuz/chromium
```

- [ ] **Step 2: Add to serverExternalPackages**

In `next.config.ts`, change line 36:

```ts
serverExternalPackages: ['@prisma/client', 'prisma', 'pino', 'pino-pretty', 'puppeteer-core', '@sparticuz/chromium', 'exceljs'],
```

- [ ] **Step 3: Vendor IBM Plex Thai TTFs**

```bash
mkdir -p src/lib/export/fonts
curl -fsSL -o src/lib/export/fonts/IBMPlexSansThai-Regular.ttf \
  'https://github.com/google/fonts/raw/main/ofl/ibmplexsansthai/IBMPlexSansThai-Regular.ttf'
curl -fsSL -o src/lib/export/fonts/IBMPlexSansThai-Bold.ttf \
  'https://github.com/google/fonts/raw/main/ofl/ibmplexsansthai/IBMPlexSansThai-Bold.ttf'
# Verify both are real TTFs (not error pages): expect "TrueType Font data"
file src/lib/export/fonts/*.ttf
```

If the google/fonts paths 404, fall back to `https://github.com/IBM/plex/raw/master/packages/plex-sans-thai/fonts/complete/ttf/IBMPlexSansThai-Regular.ttf` (and `-Bold.ttf`).

- [ ] **Step 4: Verify build config loads**

Run: `pnpm typecheck` — Expected: PASS (no source changes yet beyond config).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml next.config.ts src/lib/export/fonts
git commit -m "chore(export): add exceljs + puppeteer deps, vendor IBM Plex Thai fonts"
```

---

### Task 2: ExportTable model + shared helpers

**Files:**
- Create: `src/lib/export/export-table.ts`
- Test: `src/lib/export/export-table.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/export/export-table.test.ts
import { describe, expect, it } from 'vitest';
import { exportFilename, formatCellDisplay, thaiPeriodLabel } from './export-table';

describe('thaiPeriodLabel', () => {
  it('renders month mode with Buddhist year', () => {
    expect(thaiPeriodLabel({ from: '2026-06-01', to: '2026-06-30', month: '2026-06' })).toBe(
      'มิ.ย. 2569',
    );
  });
  it('renders custom range with Buddhist-era dates', () => {
    expect(thaiPeriodLabel({ from: '2026-06-01', to: '2026-06-15', month: null })).toBe(
      '1 มิ.ย. 2569 – 15 มิ.ย. 2569',
    );
  });
});

describe('exportFilename', () => {
  it('uses month in month mode', () => {
    expect(
      exportFilename('รายงานการมาทำงาน', { from: '2026-06-01', to: '2026-06-30', month: '2026-06' }, 'xlsx'),
    ).toBe('รายงานการมาทำงาน-2026-06.xlsx');
  });
  it('uses from_to in range mode', () => {
    expect(
      exportFilename('รายงานวันลา', { from: '2026-06-01', to: '2026-06-15', month: null }, 'csv'),
    ).toBe('รายงานวันลา-2026-06-01_2026-06-15.csv');
  });
});

describe('formatCellDisplay', () => {
  it('formats thb with 2 decimals', () => {
    expect(formatCellDisplay(5000, 'thb')).toBe('฿5,000.00');
  });
  it('formats ints with thousands separators', () => {
    expect(formatCellDisplay(1234, 'int')).toBe('1,234');
  });
  it('passes text through', () => {
    expect(formatCellDisplay('สมชาย', 'text')).toBe('สมชาย');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm test -- src/lib/export/export-table.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/export/export-table.ts
/**
 * Shared export model — every report maps its query rows to ExportTable
 * once; the csv/xlsx/pdf writers all consume this shape. Pure (no DB).
 */
import type { ReportPeriod } from '@/lib/reports/period';

export type CellFormat = 'text' | 'int' | 'thb';

export type ExportColumn = {
  key: string;
  label: string; // Thai header, mirrors on-screen table
  align?: 'left' | 'right';
  format?: CellFormat; // default 'text'
};

export type ExportCell = string | number;

export type ExportTable = {
  title: string; // Thai report title
  periodLabel: string; // Buddhist-era label, see thaiPeriodLabel
  generatedAt: string; // pre-formatted Bangkok timestamp
  columns: ExportColumn[];
  rows: Record<string, ExportCell>[];
  /** Footer totals keyed by column key; first column shows "รวม N คน". */
  totals?: Record<string, ExportCell>;
};

const thaiShort = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'UTC', // labels format UTC-midnight YMD dates, not instants
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function thaiYmd(ymd: string): string {
  return thaiShort.format(new Date(`${ymd}T00:00:00.000Z`));
}

/** "มิ.ย. 2569" (month mode) or "1 มิ.ย. 2569 – 15 มิ.ย. 2569" (range). */
export function thaiPeriodLabel(period: ReportPeriod): string {
  if (period.month) {
    const y = Number(period.month.slice(0, 4)) + 543;
    const m = new Date(`${period.month}-01T00:00:00Z`).toLocaleDateString('th-TH', {
      month: 'short',
      timeZone: 'UTC',
    });
    return `${m} ${y}`;
  }
  return `${thaiYmd(period.from)} – ${thaiYmd(period.to)}`;
}

/** Bangkok-tz "11 มิ.ย. 2569 14:30" stamp for the generated-at line. */
export function generatedAtLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

export function exportFilename(
  title: string,
  period: ReportPeriod,
  ext: 'pdf' | 'xlsx' | 'csv',
): string {
  const suffix = period.month ?? `${period.from}_${period.to}`;
  return `${title}-${suffix}.${ext}`;
}

/** Human display string for a cell (used by csv-for-humans? no — pdf only).
 *  CSV keeps raw numbers; xlsx uses numFmt; PDF renders these strings. */
export function formatCellDisplay(value: ExportCell, format: CellFormat = 'text'): string {
  if (typeof value === 'string') return value;
  if (format === 'thb') {
    return `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return value.toLocaleString('th-TH');
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm test -- src/lib/export/export-table.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/export-table.ts src/lib/export/export-table.test.ts
git commit -m "feat(export): ExportTable model + period/filename/cell helpers"
```

---

### Task 3: Report → ExportTable mappers

**Files:**
- Create: `src/lib/export/mappers.ts`
- Test: `src/lib/export/mappers.test.ts`

Mappers are pure: they take already-fetched rows (the same types the pages use) so tests need no DB. Column labels mirror the on-screen tables exactly.

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/export/mappers.test.ts
import { describe, expect, it } from 'vitest';
import type { AdvanceReportRow, AttendanceReportRow, LeaveReportRow } from '@/lib/reports/queries';
import { advanceTable, attendanceTable, leaveTable } from './mappers';

const period = { from: '2026-06-01', to: '2026-06-30', month: '2026-06' };

const attRows: AttendanceReportRow[] = [
  { employeeId: 'e1', name: 'สมชาย', lateCount: 2, lateMinutes: 30, earlyCount: 1, earlyMinutes: 15, absentDays: 1, otMinutes: 120 },
  { employeeId: 'e2', name: 'สมหญิง', lateCount: 0, lateMinutes: 0, earlyCount: 0, earlyMinutes: 0, absentDays: 0, otMinutes: 60 },
];

describe('attendanceTable', () => {
  const t = attendanceTable(attRows, period);
  it('has the 7 on-screen columns in order', () => {
    expect(t.columns.map((c) => c.label)).toEqual([
      'พนักงาน', 'มาสาย (ครั้ง)', 'สาย (นาที)', 'ออกก่อน (ครั้ง)', 'ออกก่อน (นาที)', 'ขาดงาน (วัน)', 'OT (นาที)',
    ]);
  });
  it('totals match page footer semantics (sums + headcount label)', () => {
    expect(t.totals).toMatchObject({ name: 'รวม 2 คน', lateMinutes: 30, earlyMinutes: 15, absentDays: 1, otMinutes: 180 });
  });
  it('carries Buddhist-era period label', () => {
    expect(t.periodLabel).toBe('มิ.ย. 2569');
  });
});

describe('advanceTable', () => {
  const rows: AdvanceReportRow[] = [
    { employeeId: 'e1', name: 'สมชาย', approvedInPeriod: 1000, outstandingNow: 500, availableNow: 1500 },
    { employeeId: 'e2', name: 'สมหญิง', approvedInPeriod: 0, outstandingNow: 0, availableNow: null },
  ];
  const t = advanceTable(rows, period);
  it('formats null availableNow as em-dash', () => {
    expect(t.rows[1]!.availableNow).toBe('—');
  });
  it('totals approved + outstanding only', () => {
    expect(t.totals).toMatchObject({ name: 'รวม 2 คน', approvedInPeriod: 1000, outstandingNow: 500 });
    expect(t.totals!.availableNow).toBeUndefined();
  });
});

describe('leaveTable', () => {
  const types = [{ id: 't1', name: 'ลาป่วย' }];
  const rows: LeaveReportRow[] = [
    {
      employeeId: 'e1',
      name: 'สมชาย',
      byType: { t1: { usedMinutes: 420, overQuotaMinutes: 60, deductAmount: 100 } },
      remainingByType: { t1: 840 },
    },
  ];
  const cfg = { morningStart: '09:00', morningEnd: '12:00', afternoonStart: '13:00', afternoonEnd: '17:00' }; // 420 min/day
  const t = leaveTable(rows, types, cfg, period, 2026);
  it('generates used/remaining/over columns per type', () => {
    expect(t.columns.map((c) => c.label)).toEqual([
      'พนักงาน', 'ลาป่วย — ใช้ไป', 'ลาป่วย — คงเหลือ', 'ลาป่วย — เกิน (หักเงิน)',
    ]);
  });
  it('formats durations via formatDaysHours and deductions as THB', () => {
    const r = t.rows[0]!;
    expect(r['t1:used']).toBe('1 วัน');
    expect(r['t1:remaining']).toBe('2 วัน');
    expect(r['t1:over']).toBe('1 ชม. (฿100.00)');
  });
  it('renders unlimited remaining as ไม่จำกัด and empty over as —', () => {
    const t2 = leaveTable(
      [{ employeeId: 'e2', name: 'สมหญิง', byType: { t1: { usedMinutes: 0, overQuotaMinutes: 0, deductAmount: 0 } }, remainingByType: {} }],
      types, cfg, period, 2026,
    );
    const r = t2.rows[0]!;
    expect(r['t1:remaining']).toBe('ไม่จำกัด');
    expect(r['t1:over']).toBe('—');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm test -- src/lib/export/mappers.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/export/mappers.ts
/**
 * Pure mappers: report query rows → ExportTable. Column labels mirror the
 * on-screen tables (src/app/(admin)/admin/reports/*). Pages and exports
 * share the query layer, so numbers can never disagree.
 */
import { formatTHB2 } from '@/lib/format';
import { formatDaysHours, type LeaveUnitConfig } from '@/lib/leave/units';
import type { ReportPeriod } from '@/lib/reports/period';
import type { AdvanceReportRow, AttendanceReportRow, LeaveReportRow } from '@/lib/reports/queries';
import { type ExportTable, generatedAtLabel, thaiPeriodLabel } from './export-table';

export function attendanceTable(rows: AttendanceReportRow[], period: ReportPeriod): ExportTable {
  const totals = rows.reduce(
    (a, r) => ({
      lateMinutes: a.lateMinutes + r.lateMinutes,
      earlyMinutes: a.earlyMinutes + r.earlyMinutes,
      absentDays: a.absentDays + r.absentDays,
      otMinutes: a.otMinutes + r.otMinutes,
    }),
    { lateMinutes: 0, earlyMinutes: 0, absentDays: 0, otMinutes: 0 },
  );
  return {
    title: 'รายงานการมาทำงาน',
    periodLabel: thaiPeriodLabel(period),
    generatedAt: generatedAtLabel(),
    columns: [
      { key: 'name', label: 'พนักงาน' },
      { key: 'lateCount', label: 'มาสาย (ครั้ง)', align: 'right', format: 'int' },
      { key: 'lateMinutes', label: 'สาย (นาที)', align: 'right', format: 'int' },
      { key: 'earlyCount', label: 'ออกก่อน (ครั้ง)', align: 'right', format: 'int' },
      { key: 'earlyMinutes', label: 'ออกก่อน (นาที)', align: 'right', format: 'int' },
      { key: 'absentDays', label: 'ขาดงาน (วัน)', align: 'right', format: 'int' },
      { key: 'otMinutes', label: 'OT (นาที)', align: 'right', format: 'int' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      lateCount: r.lateCount,
      lateMinutes: r.lateMinutes,
      earlyCount: r.earlyCount,
      earlyMinutes: r.earlyMinutes,
      absentDays: r.absentDays,
      otMinutes: r.otMinutes,
    })),
    totals: { name: `รวม ${rows.length} คน`, ...totals },
  };
}

export function advanceTable(rows: AdvanceReportRow[], period: ReportPeriod): ExportTable {
  const totals = rows.reduce(
    (a, r) => ({
      approvedInPeriod: a.approvedInPeriod + r.approvedInPeriod,
      outstandingNow: a.outstandingNow + r.outstandingNow,
    }),
    { approvedInPeriod: 0, outstandingNow: 0 },
  );
  return {
    title: 'รายงานการเบิกเงิน',
    periodLabel: thaiPeriodLabel(period),
    generatedAt: generatedAtLabel(),
    columns: [
      { key: 'name', label: 'พนักงาน' },
      { key: 'approvedInPeriod', label: 'เบิกอนุมัติในช่วง', align: 'right', format: 'thb' },
      { key: 'outstandingNow', label: 'ค้างหัก', align: 'right', format: 'thb' },
      { key: 'availableNow', label: 'วงเงินคงเหลือ', align: 'right', format: 'thb' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      approvedInPeriod: r.approvedInPeriod,
      outstandingNow: r.outstandingNow,
      availableNow: r.availableNow == null ? '—' : r.availableNow,
    })),
    totals: { name: `รวม ${rows.length} คน`, ...totals },
  };
}

export function leaveTable(
  rows: LeaveReportRow[],
  types: Array<{ id: string; name: string }>,
  cfg: LeaveUnitConfig,
  period: ReportPeriod,
  year: number,
): ExportTable {
  const columns = [
    { key: 'name', label: 'พนักงาน' },
    ...types.flatMap((t) => [
      { key: `${t.id}:used`, label: `${t.name} — ใช้ไป`, align: 'right' as const },
      { key: `${t.id}:remaining`, label: `${t.name} — คงเหลือ (ปี ${year + 543})`, align: 'right' as const },
      { key: `${t.id}:over`, label: `${t.name} — เกิน (หักเงิน)`, align: 'right' as const },
    ]),
  ];
  return {
    title: 'รายงานวันลา',
    periodLabel: thaiPeriodLabel(period),
    generatedAt: generatedAtLabel(),
    columns,
    rows: rows.map((r) => {
      const out: Record<string, string> = { name: r.name };
      for (const t of types) {
        const cell = r.byType[t.id];
        const remaining = r.remainingByType[t.id];
        out[`${t.id}:used`] = cell ? formatDaysHours(cell.usedMinutes, cfg) : '—';
        out[`${t.id}:remaining`] =
          remaining === undefined || remaining === null ? 'ไม่จำกัด' : formatDaysHours(remaining, cfg);
        out[`${t.id}:over`] =
          cell && cell.overQuotaMinutes > 0
            ? `${formatDaysHours(cell.overQuotaMinutes, cfg)} (${formatTHB2(cell.deductAmount)})`
            : '—';
      }
      return out;
    }),
    totals: undefined, // page shows no totals footer for leave — mirror it
  };
}
```

NOTE on the leave test expecting `'1 วัน'` / `'1 ชม.'`: confirm against `formatDaysHours` (src/lib/leave/units.ts:99) actual output format before finalizing assertions — adjust expected strings to whatever it really returns (the page uses it verbatim, so matching it IS the requirement).

- [ ] **Step 4: Run, verify PASS** — `pnpm test -- src/lib/export/mappers.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/mappers.ts src/lib/export/mappers.test.ts
git commit -m "feat(export): pure mappers from report rows to ExportTable"
```

---

### Task 4: CSV writer

**Files:**
- Create: `src/lib/export/csv.ts`
- Test: `src/lib/export/csv.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/export/csv.test.ts
import { describe, expect, it } from 'vitest';
import type { ExportTable } from './export-table';
import { toCsv } from './csv';

const table: ExportTable = {
  title: 'รายงานทดสอบ',
  periodLabel: 'มิ.ย. 2569',
  generatedAt: '11 มิ.ย. 2569 14:30',
  columns: [
    { key: 'name', label: 'พนักงาน' },
    { key: 'amount', label: 'จำนวน', format: 'thb' },
  ],
  rows: [
    { name: 'สมชาย "บิ๊ก", จูเนียร์', amount: 1234.5 },
    { name: 'สมหญิง\nสองบรรทัด', amount: 0 },
  ],
  totals: { name: 'รวม 2 คน', amount: 1234.5 },
};

describe('toCsv', () => {
  const csv = toCsv(table);
  it('starts with UTF-8 BOM so Excel decodes Thai', () => {
    expect(csv.startsWith('﻿')).toBe(true);
  });
  it('quotes fields containing commas, quotes, newlines (RFC 4180)', () => {
    expect(csv).toContain('"สมชาย ""บิ๊ก"", จูเนียร์"');
    expect(csv).toContain('"สมหญิง\nสองบรรทัด"');
  });
  it('emits raw numbers without ฿ or separators', () => {
    expect(csv).toContain('1234.5');
    expect(csv).not.toContain('฿');
  });
  it('includes header row and totals row', () => {
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('พนักงาน,จำนวน');
    expect(lines.at(-1)).toBe('รวม 2 คน,1234.5');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm test -- src/lib/export/csv.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/export/csv.ts
/** CSV writer — UTF-8 BOM (Excel/Windows assumes ANSI without it → Thai
 *  mojibake), RFC 4180 escaping, CRLF rows, raw numbers (machine-friendly). */
import type { ExportCell, ExportTable } from './export-table';

function field(v: ExportCell): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: ExportTable): string {
  const lines: string[] = [];
  lines.push(table.columns.map((c) => field(c.label)).join(','));
  for (const row of table.rows) {
    lines.push(table.columns.map((c) => field(row[c.key] ?? '')).join(','));
  }
  if (table.totals) {
    lines.push(table.columns.map((c) => field(table.totals?.[c.key] ?? '')).join(','));
  }
  return `﻿${lines.join('\r\n')}`;
}
```

- [ ] **Step 4: Run, verify PASS**, then **Step 5: Commit**

```bash
git add src/lib/export/csv.ts src/lib/export/csv.test.ts
git commit -m "feat(export): CSV writer with BOM + RFC 4180 escaping"
```

---

### Task 5: Excel writer (exceljs)

**Files:**
- Create: `src/lib/export/xlsx.ts`
- Test: `src/lib/export/xlsx.test.ts`

- [ ] **Step 1: Write failing tests** (write → re-parse round-trip)

```ts
// src/lib/export/xlsx.test.ts
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ExportTable } from './export-table';
import { toXlsx } from './xlsx';

const table: ExportTable = {
  title: 'รายงานการเบิกเงิน',
  periodLabel: 'มิ.ย. 2569',
  generatedAt: '11 มิ.ย. 2569 14:30',
  columns: [
    { key: 'name', label: 'พนักงาน' },
    { key: 'amount', label: 'เบิกอนุมัติในช่วง', align: 'right', format: 'thb' },
    { key: 'count', label: 'ครั้ง', align: 'right', format: 'int' },
  ],
  rows: [{ name: 'สมชาย', amount: 1500.5, count: 3 }],
  totals: { name: 'รวม 1 คน', amount: 1500.5 },
};

async function roundTrip(t: ExportTable) {
  const buf = await toXlsx(t);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb.worksheets[0]!;
}

describe('toXlsx', () => {
  it('lays out title block, header, data, totals', async () => {
    const ws = await roundTrip(table);
    expect(ws.getCell('A1').value).toBe('รายงานการเบิกเงิน');
    expect(ws.getCell('A2').value).toContain('มิ.ย. 2569');
    expect(ws.getCell('A4').value).toBe('พนักงาน'); // header row 4
    expect(ws.getCell('A5').value).toBe('สมชาย');
    expect(ws.getCell('B5').value).toBe(1500.5); // real number, not string
    expect(ws.getCell('A6').value).toBe('รวม 1 คน');
  });
  it('applies THB and int number formats', async () => {
    const ws = await roundTrip(table);
    expect(ws.getCell('B5').numFmt).toBe('"฿"#,##0.00');
    expect(ws.getCell('C5').numFmt).toBe('#,##0');
  });
  it('styles header row with sapphire fill and freezes panes below it', async () => {
    const ws = await roundTrip(table);
    const fill = ws.getCell('A4').fill as ExcelJS.FillPattern;
    expect(fill.fgColor?.argb).toBe('FF3955E8'); // sapphire-600
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm test -- src/lib/export/xlsx.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/export/xlsx.ts
/**
 * Excel writer — Sapphire Editorial styling: title block, sapphire-600
 * header band, frozen panes, per-column numFmt, gray totals row.
 * Returns a Buffer for the route to stream.
 */
import ExcelJS from 'exceljs';
import type { CellFormat, ExportTable } from './export-table';

const SAPPHIRE_600 = 'FF3955E8';
const GRAY_50 = 'FFF9FAFB';
const INK_1 = 'FF0F172A';
const FONT = 'IBM Plex Sans Thai';

const numFmtFor: Record<CellFormat, string | undefined> = {
  text: undefined,
  int: '#,##0',
  thb: '"฿"#,##0.00',
};

export async function toXlsx(table: ExportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(table.title, {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const colCount = table.columns.length;

  // Title block (rows 1–3)
  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = table.title;
  titleCell.font = { name: FONT, size: 16, bold: true, color: { argb: INK_1 } };
  ws.mergeCells(2, 1, 2, colCount);
  const periodCell = ws.getCell(2, 1);
  periodCell.value = `ช่วงเวลา: ${table.periodLabel} • สร้างเมื่อ ${table.generatedAt}`;
  periodCell.font = { name: FONT, size: 10, color: { argb: 'FF64748B' } };
  ws.getRow(3).height = 6; // spacer

  // Header (row 4)
  const header = ws.getRow(4);
  table.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SAPPHIRE_600 } };
    cell.alignment = { horizontal: c.align ?? 'left', vertical: 'middle' };
  });
  header.height = 22;

  // Data rows
  for (const row of table.rows) {
    const r = ws.addRow(table.columns.map((c) => row[c.key] ?? ''));
    table.columns.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.font = { name: FONT, size: 10 };
      cell.alignment = { horizontal: c.align ?? 'left' };
      const fmt = numFmtFor[c.format ?? 'text'];
      if (fmt && typeof row[c.key] === 'number') cell.numFmt = fmt;
    });
  }

  // Totals row
  if (table.totals) {
    const r = ws.addRow(table.columns.map((c) => table.totals?.[c.key] ?? ''));
    table.columns.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.font = { name: FONT, size: 10, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY_50 } };
      cell.alignment = { horizontal: c.align ?? 'left' };
      const fmt = numFmtFor[c.format ?? 'text'];
      if (fmt && typeof table.totals?.[c.key] === 'number') cell.numFmt = fmt;
    });
  }

  // Auto widths from content length (capped 12–40 chars)
  table.columns.forEach((c, i) => {
    const lengths = [c.label.length, ...table.rows.map((r) => String(r[c.key] ?? '').length)];
    ws.getColumn(i + 1).width = Math.min(40, Math.max(12, Math.max(...lengths) + 4));
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
```

- [ ] **Step 4: Run, verify PASS**, then **Step 5: Commit**

```bash
git add src/lib/export/xlsx.ts src/lib/export/xlsx.test.ts
git commit -m "feat(export): styled exceljs writer (sapphire header, numFmt, frozen panes)"
```

---

### Task 6: PDF — HTML template + Chromium renderer

**Files:**
- Create: `src/lib/export/pdf-html.ts` (pure HTML template — testable)
- Create: `src/lib/export/pdf.ts` (puppeteer renderer — server-only)
- Test: `src/lib/export/pdf-html.test.ts`

- [ ] **Step 1: Write failing template tests**

```ts
// src/lib/export/pdf-html.test.ts
import { describe, expect, it } from 'vitest';
import type { ExportTable } from './export-table';
import { renderPdfHtml } from './pdf-html';

const table: ExportTable = {
  title: 'รายงานการมาทำงาน',
  periodLabel: 'มิ.ย. 2569',
  generatedAt: '11 มิ.ย. 2569 14:30',
  columns: [
    { key: 'name', label: 'พนักงาน' },
    { key: 'amount', label: 'จำนวน', align: 'right', format: 'thb' },
  ],
  rows: [{ name: '<script>alert(1)</script>', amount: 1500.5 }],
  totals: { name: 'รวม 1 คน', amount: 1500.5 },
};

describe('renderPdfHtml', () => {
  const html = renderPdfHtml(table, { regularB64: 'AAAA', boldB64: 'BBBB' });
  it('escapes HTML in cell values', () => {
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
  it('renders title, period, and THB-formatted cells', () => {
    expect(html).toContain('รายงานการมาทำงาน');
    expect(html).toContain('มิ.ย. 2569');
    expect(html).toContain('฿1,500.50');
  });
  it('embeds fonts and sapphire header styling', () => {
    expect(html).toContain('base64,AAAA');
    expect(html).toContain('#3955e8');
    expect(html).toContain('<thead>'); // repeats on page breaks
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm test -- src/lib/export/pdf-html.test.ts`

- [ ] **Step 3: Implement the template**

```ts
// src/lib/export/pdf-html.ts
/**
 * Standalone HTML for the PDF — inline Sapphire tokens (not app CSS, so
 * no Tailwind runtime in the lambda). IBM Plex Thai embedded as base64
 * @font-face: lambda images ship no Thai system fonts.
 */
import { type ExportTable, formatCellDisplay } from './export-table';

export type PdfFonts = { regularB64: string; boldB64: string };

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPdfHtml(table: ExportTable, fonts: PdfFonts): string {
  const ths = table.columns
    .map((c) => `<th class="${c.align === 'right' ? 'r' : ''}">${esc(c.label)}</th>`)
    .join('');
  const trs = table.rows
    .map(
      (row) =>
        `<tr>${table.columns
          .map((c) => `<td class="${c.align === 'right' ? 'r' : ''}">${esc(formatCellDisplay(row[c.key] ?? '', c.format))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const tfoot = table.totals
    ? `<tfoot><tr>${table.columns
        .map((c) => `<td class="${c.align === 'right' ? 'r' : ''}">${esc(formatCellDisplay(table.totals?.[c.key] ?? '', c.format))}</td>`)
        .join('')}</tr></tfoot>`
    : '';

  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8">
<style>
@font-face { font-family: 'IBM Plex Sans Thai'; font-weight: 400;
  src: url(data:font/ttf;base64,${fonts.regularB64}) format('truetype'); }
@font-face { font-family: 'IBM Plex Sans Thai'; font-weight: 700;
  src: url(data:font/ttf;base64,${fonts.boldB64}) format('truetype'); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'IBM Plex Sans Thai', sans-serif; color: #0f172a; font-size: 9pt; line-height: 1.65; }
.band { background: #3955e8; color: #fff; padding: 14px 18px; border-radius: 8px; margin-bottom: 12px; }
.band h1 { font-size: 15pt; font-weight: 700; letter-spacing: -0.015em; }
.band .meta { font-size: 8pt; opacity: .85; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; }
thead th { background: #f1f5f9; color: #475569; font-size: 7.5pt; font-weight: 700;
  text-align: left; padding: 6px 8px; border-bottom: 1.5px solid #cbd5e1; }
tbody td { padding: 5px 8px; border-bottom: 0.5px solid #e2e8f0; }
tbody tr:nth-child(even) td { background: #f8fafc; }
tfoot td { background: #f1f5f9; font-weight: 700; padding: 6px 8px; border-top: 1.5px solid #cbd5e1; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
</style></head>
<body>
<div class="band">
  <h1>${esc(table.title)}</h1>
  <div class="meta">ช่วงเวลา: ${esc(table.periodLabel)} • สร้างเมื่อ ${esc(table.generatedAt)}</div>
</div>
<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody>${tfoot}</table>
</body></html>`;
}
```

- [ ] **Step 4: Run, verify PASS** — `pnpm test -- src/lib/export/pdf-html.test.ts`

- [ ] **Step 5: Implement the renderer** (no unit test — exercised by Task 7's smoke test)

```ts
// src/lib/export/pdf.ts
import 'server-only';
/**
 * HTML→PDF via headless Chromium. On Vercel: @sparticuz/chromium binary.
 * Locally: falls back to an installed Chrome (CHROME_EXECUTABLE_PATH env
 * override → common macOS path).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import type { ExportTable } from './export-table';
import { type PdfFonts, renderPdfHtml } from './pdf-html';

const FONT_DIR = join(process.cwd(), 'src/lib/export/fonts');
let fontsCache: PdfFonts | null = null;

async function loadFonts(): Promise<PdfFonts> {
  if (!fontsCache) {
    const [regular, bold] = await Promise.all([
      readFile(join(FONT_DIR, 'IBMPlexSansThai-Regular.ttf')),
      readFile(join(FONT_DIR, 'IBMPlexSansThai-Bold.ttf')),
    ]);
    fontsCache = { regularB64: regular.toString('base64'), boldB64: bold.toString('base64') };
  }
  return fontsCache;
}

const LOCAL_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function launch() {
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  return puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH ?? LOCAL_CHROME,
    headless: true,
  });
}

export async function toPdf(table: ExportTable): Promise<Buffer> {
  const html = renderPdfHtml(table, await loadFonts());
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'a4',
      landscape: true,
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:7pt;color:#94a3b8;padding:0 10mm;display:flex;justify-content:space-between;">
        <span>Koolman HR</span><span>หน้า <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
```

NOTE: footerTemplate fonts can't use the embedded @font-face (header/footer render in a separate context) — the Thai "หน้า" in the footer may fall back to a system font locally and could render as tofu on Vercel. If it does (check during verification), switch the footer label to `"Page N/M"` English.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add src/lib/export/pdf-html.ts src/lib/export/pdf-html.test.ts src/lib/export/pdf.ts
git commit -m "feat(export): sapphire PDF template + puppeteer renderer"
```

---

### Task 7: Export route handler

**Files:**
- Create: `src/app/(admin)/admin/reports/[report]/export/route.ts`

The dynamic `[report]` segment coexists with the static `attendance|leave|advance` page dirs — static wins for pages, `[report]/export` only matches the export path.

- [ ] **Step 1: Implement the route**

```ts
// src/app/(admin)/admin/reports/[report]/export/route.ts
/**
 * GET /admin/reports/(attendance|leave|advance)/export?format=pdf|xlsx|csv&m=&from=&to=&q=
 * Permission-gated download endpoint. Reuses the page query layer so the
 * file always matches what's on screen for the same params.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/check-permission';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { logger } from '@/lib/logger';
import { toCsv } from '@/lib/export/csv';
import { exportFilename, type ExportTable } from '@/lib/export/export-table';
import { advanceTable, attendanceTable, leaveTable } from '@/lib/export/mappers';
import { toPdf } from '@/lib/export/pdf';
import { toXlsx } from '@/lib/export/xlsx';
import { resolveReportPeriod } from '@/lib/reports/period';
import { advanceReport, attendanceReport, leaveReport } from '@/lib/reports/queries';

export const runtime = 'nodejs';
export const maxDuration = 60;

const FORMATS = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8' } as const;
type Format = keyof typeof FORMATS;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ report: string }> },
) {
  await requirePermission('report.read');

  const { report } = await params;
  const sp = req.nextUrl.searchParams;
  const format = sp.get('format') as Format | null;
  if (!format || !(format in FORMATS)) {
    return NextResponse.json({ error: 'รูปแบบไฟล์ไม่ถูกต้อง (format=pdf|xlsx|csv)' }, { status: 400 });
  }

  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const period = resolveReportPeriod(
    { m: sp.get('m') ?? undefined, from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined },
    todayYmd,
  );
  const filter = { q: sp.get('q') ?? undefined };

  let table: ExportTable;
  if (report === 'attendance') {
    table = attendanceTable(await attendanceReport(period, filter), period);
  } else if (report === 'advance') {
    table = advanceTable(await advanceReport(period, filter), period);
  } else if (report === 'leave') {
    const year = Number((period.month ?? period.from).slice(0, 4));
    const [{ types, rows }, cfg] = await Promise.all([leaveReport(period, filter, year), getLeaveConfig()]);
    table = leaveTable(rows, types, cfg, period, year);
  } else {
    notFound();
  }

  const filename = exportFilename(table.title, period, format);
  const headers = {
    'Content-Type': FORMATS[format],
    // RFC 5987 filename* for the Thai name; plain ASCII fallback first.
    'Content-Disposition': `attachment; filename="report.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
  };

  try {
    if (format === 'csv') return new NextResponse(toCsv(table), { headers });
    if (format === 'xlsx') return new NextResponse(new Uint8Array(await toXlsx(table)), { headers });
    return new NextResponse(new Uint8Array(await toPdf(table)), { headers });
  } catch (err) {
    logger.error({ err, report, format }, 'report export failed');
    return NextResponse.json({ error: 'สร้างไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
```

NOTE: confirm the logger import path — check `src/lib/logger.ts` exists (`grep -rn "from '@/lib/logger'" src | head -3`) and match whatever the codebase convention is; if there is no shared logger, use `console.error` consistent with neighboring route handlers.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck` — Expected: PASS. (Empty-rows case needs no special handling: writers emit header + totals only; the spec's "ไม่มีข้อมูล row" is satisfied by the PDF/xlsx showing just the header band + "รวม 0 คน" totals row — acceptable; if totals are undefined (leave), the file is header-only, still valid.)

- [ ] **Step 3: Manual smoke test (dev server)**

```bash
# needs .env.local copied into the worktree (see .remember / memory: worktree-setup)
pnpm dev
# then in another shell, logged-in session cookie required — easiest is the browser:
# visit http://localhost:3000/admin/reports/attendance/export?format=csv
# visit ...?format=xlsx and ...?format=pdf — verify downloads open correctly,
# Thai text renders in all three (CSV in Excel, xlsx styling, PDF fonts).
```

Expected: three files download; Thai renders correctly; PDF shows sapphire band, page footer.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/(admin)/admin/reports/[report]/export/route.ts'
git commit -m "feat(export): permission-gated export route for all three reports"
```

---

### Task 8: Export buttons on report pages

**Files:**
- Create: `src/app/(admin)/admin/reports/export-buttons.tsx`
- Modify: `src/app/(admin)/admin/reports/attendance/page.tsx` (filter row, ~line 30)
- Modify: `src/app/(admin)/admin/reports/leave/page.tsx` (filter row, ~line 27)
- Modify: `src/app/(admin)/admin/reports/advance/page.tsx` (filter row, ~line 28)

- [ ] **Step 1: Create the shared buttons component**

```tsx
// src/app/(admin)/admin/reports/export-buttons.tsx
import { Download } from 'lucide-react';

/** PDF / Excel / CSV download links for a report page. Server component —
 *  plain <a> hrefs carrying the page's current period + search params. */
export function ExportButtons({
  report,
  params,
}: {
  report: 'attendance' | 'leave' | 'advance';
  params: { m?: string; from?: string; to?: string; q?: string };
}) {
  const base = new URLSearchParams();
  for (const k of ['m', 'from', 'to', 'q'] as const) {
    if (params[k]) base.set(k, params[k]);
  }
  const href = (format: string) => {
    const p = new URLSearchParams(base);
    p.set('format', format);
    return `/admin/reports/${report}/export?${p.toString()}`;
  };
  const linkClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50';
  return (
    <div className="flex items-center gap-2">
      <a href={href('pdf')} className={linkClass} download>
        <Download size={13} /> PDF
      </a>
      <a href={href('xlsx')} className={linkClass} download>
        <Download size={13} /> Excel
      </a>
      <a href={href('csv')} className={linkClass} download>
        <Download size={13} /> CSV
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Wire into all three pages**

In each page, the filter row currently reads:

```tsx
<div className="flex flex-wrap items-center justify-between gap-3">
  <PeriodPicker month={period.month} from={period.from} to={period.to} />
  <NameSearch q={params.q} params={params} />
</div>
```

Change to (adjust `report=` per page — `"attendance"`, `"leave"`, `"advance"`):

```tsx
<div className="flex flex-wrap items-center justify-between gap-3">
  <PeriodPicker month={period.month} from={period.from} to={period.to} />
  <div className="flex flex-wrap items-center gap-3">
    <ExportButtons report="attendance" params={params} />
    <NameSearch q={params.q} params={params} />
  </div>
</div>
```

And add the import in each page:

```tsx
import { ExportButtons } from '../export-buttons';
```

- [ ] **Step 3: Verify in browser**

With `pnpm dev` running: each report page shows the three buttons next to the search box; clicking each downloads the right file with current filters applied (change month, re-download, verify period changes).

- [ ] **Step 4: Lint + commit**

```bash
pnpm lint:fix && pnpm typecheck
git add src/app/\(admin\)/admin/reports
git commit -m "feat(reports): PDF/Excel/CSV export buttons on all report pages"
```

---

### Task 9: Full verification

- [ ] **Step 1: Full test suite** — `pnpm test` — Expected: all pass (4 deferred E2E skips are expected per repo convention).
- [ ] **Step 2: Typecheck + lint** — `pnpm typecheck && pnpm lint` — Expected: clean.
- [ ] **Step 3: Production build** — `pnpm build` will attempt DB migrate; if `DIRECT_URL` unset locally it skips with a warning — that's fine. Expected: build succeeds.
- [ ] **Step 4: Manual end-to-end pass** — for each of the 3 reports × 3 formats (9 downloads): Thai text correct, totals match the on-screen footer, period label matches the picker, empty-state (pick a far-past month) still yields a valid file.
- [ ] **Step 5: Commit any fixes** and report results.

---

## Self-review notes

- **Spec coverage:** formats (T4–6), all 3 reports (T3, T7), design language (T5 styling, T6 template), filters (T7 reuses resolveReportPeriod + q), permission gate (T7 requirePermission), UI buttons (T8), Vercel runtime (T1 config, T6 launch branch, T7 runtime/maxDuration), fonts (T1, T6), filename Thai encoding (T2 + T7 RFC 5987), error handling (T7 try/catch + 400/404), empty results (noted in T7 Step 2 — slight simplification vs spec's "ไม่มีข้อมูล row", acceptable).
- **Known check-before-trust points (flagged inline):** `formatDaysHours` exact output strings (T3), google/fonts URL (T1), logger import (T7), footer Thai font on Vercel (T6).
- **Type consistency:** `ExportTable`/`CellFormat`/`PdfFonts` defined once in T2/T6 and imported elsewhere; mapper signatures match route usage in T7.
