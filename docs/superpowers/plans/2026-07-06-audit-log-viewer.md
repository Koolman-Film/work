# Audit Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a filterable, forensic `/admin/audit` page that reads the existing `AuditLog` table, with expandable field diffs and sensitive-action badges.

**Architecture:** Pure, unit-tested helper modules (`labels`, `diff`, `query`, an auth predicate) hold all logic; thin server/client components compose them. No new data model and no new audit writes — this is a read surface over data already captured at ~80 callsites. The page is gated to holders of *globally-scoped* `audit.read`.

**Tech Stack:** Next.js App Router (server + client components), Prisma (Postgres), Vitest (unit + integration), Tailwind, existing `@/components/ui/*` primitives.

## Global Constraints

- Data model: **do not** modify `prisma/schema.prisma`. The `AuditLog` model already exists (`prisma/schema.prisma:831`). This feature is read-only.
- Prisma client import: `import { prisma } from '@/lib/db/prisma';`
- Path alias: `@` → `./src`.
- Labels/diff modules must be **client-safe** (no `prisma`, no `server-only` import) — they run inside client components. `query.ts` is server-only.
- Audit `actorId` is nullable and **not** a FK: `null` actor renders as `'ระบบ'`; a non-null actor that no longer resolves renders as `id.slice(0, 8)`.
- Money/date display via `@/lib/format` (`formatTHB`, `formatThaiDate`). Thai UI strings inline, matching existing admin pages.
- Unit tests: co-located `src/**/*.test.ts`, run with `npm test`. Integration tests: `tests/integration/**/*.integration.test.ts`, run with `npm run test:integration`.
- Page size constant: `AUDIT_PAGE_SIZE = 50`.

---

### Task 1: Label & classification module

**Files:**
- Create: `src/lib/audit/labels.ts`
- Test: `src/lib/audit/labels.test.ts`
- Modify: `src/app/(owner)/owner/page.tsx` (remove its local `ACTION_LABELS`, import the shared one)

**Interfaces:**
- Consumes: `AuditAction`, `AuditEntityType` from `@/lib/audit/log`.
- Produces:
  - `actionLabel(action: string): string`
  - `entityLabel(entityType: string): string`
  - `isSensitive(action: string): boolean`
  - `fieldLabel(field: string): string`
  - `ACTION_LABELS`, `ENTITY_TYPE_LABELS`, `SENSITIVE_ACTIONS`, `FIELD_LABELS` (consts)

- [ ] **Step 1: Write the failing test**

Create `src/lib/audit/labels.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { actionLabel, entityLabel, fieldLabel, isSensitive } from './labels';

describe('actionLabel', () => {
  it('maps a known action to its Thai label', () => {
    expect(actionLabel('payroll.publish')).toBe('เผยแพร่เงินเดือน');
    expect(actionLabel('employee.create')).toBe('เพิ่มพนักงาน');
  });
  it('falls back to the raw action string when unknown', () => {
    expect(actionLabel('something.unmapped')).toBe('something.unmapped');
  });
});

describe('entityLabel', () => {
  it('maps a known entity type to Thai', () => {
    expect(entityLabel('Employee')).toBe('พนักงาน');
    expect(entityLabel('Payroll')).toBe('เงินเดือน');
  });
  it('falls back to the raw entity type when unknown', () => {
    expect(entityLabel('Widget')).toBe('Widget');
  });
});

describe('isSensitive', () => {
  it('flags role, merge, delete, and payroll-publish actions', () => {
    expect(isSensitive('user.account-merge')).toBe(true);
    expect(isSensitive('roleAssignment.create')).toBe(true);
    expect(isSensitive('employee.delete')).toBe(true);
    expect(isSensitive('payroll.publish')).toBe(true);
  });
  it('does not flag routine reads/checkins', () => {
    expect(isSensitive('attendance.checkin')).toBe(false);
    expect(isSensitive('leave.submit')).toBe(false);
  });
});

describe('fieldLabel', () => {
  it('maps known fields and falls back to the raw key', () => {
    expect(fieldLabel('baseSalary')).toBe('เงินเดือนฐาน');
    expect(fieldLabel('someRawKey')).toBe('someRawKey');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/audit/labels.test.ts`
Expected: FAIL — `Cannot find module './labels'`.

- [ ] **Step 3: Write the module**

Create `src/lib/audit/labels.ts`:

```typescript
import type { AuditAction, AuditEntityType } from '@/lib/audit/log';

/** Action string → Thai description. Covers every AuditAction; unknown
 *  actions fall back to the raw key via actionLabel(). */
export const ACTION_LABELS: Record<AuditAction, string> = {
  'user.create': 'สร้างผู้ใช้',
  'user.archive': 'ระงับผู้ใช้',
  'user.delete': 'ลบผู้ใช้',
  'user.role-change': 'เปลี่ยนบทบาทผู้ใช้',
  'user.locale-change': 'เปลี่ยนภาษาผู้ใช้',
  'user.password-reset': 'รีเซ็ตรหัสผ่าน',
  'user.password-change': 'เปลี่ยนรหัสผ่าน',
  'user.admin-line-invite': 'เชิญผูก LINE แอดมิน',
  'user.admin-line-link': 'ผูก LINE แอดมิน',
  'user.admin-line-unlink': 'ยกเลิกผูก LINE แอดมิน',
  'user.account-merge': 'รวมบัญชี',
  'role.create': 'สร้างบทบาท',
  'role.update': 'แก้ไขบทบาท',
  'role.archive': 'ลบบทบาท',
  'roleAssignment.create': 'มอบหมายบทบาท',
  'roleAssignment.delete': 'ถอนบทบาท',
  'employee.create': 'เพิ่มพนักงาน',
  'employee.update': 'แก้ไขพนักงาน',
  'employee.archive': 'พ้นสภาพพนักงาน',
  'employee.delete': 'ลบพนักงานถาวร',
  'employee.rehire': 'จ้างกลับ',
  'employee.line-link': 'เชื่อม LINE พนักงาน',
  'employee.line-unlink': 'ยกเลิกเชื่อม LINE พนักงาน',
  'employee.profile.self-update': 'พนักงานแก้ไขโปรไฟล์',
  'branch.create': 'เพิ่มสาขา',
  'branch.update': 'แก้ไขสาขา',
  'branch.archive': 'ลบสาขา',
  'department.create': 'เพิ่มแผนก',
  'department.update': 'แก้ไขแผนก',
  'department.archive': 'ลบแผนก',
  'accountingGroup.create': 'เพิ่มกลุ่มบัญชี',
  'accountingGroup.update': 'แก้ไขกลุ่มบัญชี',
  'accountingGroup.archive': 'ลบกลุ่มบัญชี',
  'workSchedule.create': 'เพิ่มตารางงาน',
  'workSchedule.update': 'แก้ไขตารางงาน',
  'workSchedule.archive': 'ลบตารางงาน',
  'leaveType.create': 'เพิ่มประเภทการลา',
  'leaveType.update': 'แก้ไขประเภทการลา',
  'leaveType.archive': 'ลบประเภทการลา',
  'leaveConfig.update': 'แก้ไขการตั้งค่าการลา',
  'payrollConfig.update': 'แก้ไขการตั้งค่าเงินเดือน',
  'leaveEntitlement.update': 'ปรับสิทธิวันลา',
  'overtime.approve': 'อนุมัติ OT',
  'overtime.dismiss': 'ปฏิเสธ OT',
  'overtime.void': 'ยกเลิก OT',
  'holiday.create': 'เพิ่มวันหยุด',
  'holiday.update': 'แก้ไขวันหยุด',
  'holiday.archive': 'ลบวันหยุด',
  'attendance.checkin': 'เช็คอิน',
  'attendance.checkout': 'เช็คเอาท์',
  'attendance.late-auto': 'บันทึกมาสายอัตโนมัติ',
  'attendance.manual-create': 'สร้างการลงเวลาด้วยมือ',
  'attendance.edit': 'แก้ไขการลงเวลา',
  'attendance.dispute-approve': 'อนุมัติรายการตรวจสอบ',
  'attendance.dispute-reject': 'ปฏิเสธรายการตรวจสอบ',
  'attendance.force-checkout': 'บังคับเช็คเอาท์',
  'attendance.void': 'ยกเลิกการลงเวลา',
  'attendance.restore': 'กู้คืนการลงเวลา',
  'leave.submit': 'ส่งคำขอลา',
  'leave.admin-create': 'แอดมินสร้างคำขอลา',
  'leave.approve': 'อนุมัติคำขอลา',
  'leave.reject': 'ปฏิเสธคำขอลา',
  'leave.cancel': 'ยกเลิกคำขอลา',
  'leave.void': 'ลบคำขอลา',
  'leave.restore': 'กู้คืนคำขอลา',
  'leave.recompute': 'คำนวณวันลาใหม่',
  'advance.submit': 'ส่งคำขอเบิก',
  'advance.admin-create': 'แอดมินสร้างคำขอเบิก',
  'advance.approve': 'อนุมัติคำขอเบิก',
  'advance.reject': 'ปฏิเสธคำขอเบิก',
  'advance.mark-paid': 'ทำเครื่องหมายจ่ายแล้ว',
  'advance.cancel': 'ยกเลิกคำขอเบิก',
  'advance.void': 'ลบคำขอเบิก',
  'advance.restore': 'กู้คืนคำขอเบิก',
  'payroll.run': 'รันคำนวณเงินเดือน',
  'payroll.override': 'ปรับแก้เงินเดือน',
  'payroll.publish': 'เผยแพร่เงินเดือน',
  'payroll.unlock': 'ปลดล็อกเงินเดือน',
  'payroll.revise': 'แก้ไขเงินเดือนที่เผยแพร่',
  'payslip.download': 'ดาวน์โหลดสลิป',
  'payslip.preview': 'ดูตัวอย่างสลิป',
  'recurringDeduction.create': 'เพิ่มรายการหักประจำ',
  'recurringDeduction.edit': 'แก้ไขรายการหักประจำ',
  'recurringDeduction.end': 'สิ้นสุดรายการหักประจำ',
  'payrollAdjustment.create': 'เพิ่มรายการปรับเงินเดือน',
  'payrollAdjustment.edit': 'แก้ไขรายการปรับเงินเดือน',
  'payrollAdjustment.delete': 'ลบรายการปรับเงินเดือน',
};

/** Entity type → Thai noun. */
export const ENTITY_TYPE_LABELS: Record<AuditEntityType, string> = {
  User: 'ผู้ใช้',
  Employee: 'พนักงาน',
  Branch: 'สาขา',
  RoleDefinition: 'บทบาท',
  UserRoleAssignment: 'การมอบบทบาท',
  Department: 'แผนก',
  AccountingGroup: 'กลุ่มบัญชี',
  WorkSchedule: 'ตารางงาน',
  LeaveType: 'ประเภทการลา',
  LeaveConfig: 'ตั้งค่าการลา',
  PayrollConfig: 'ตั้งค่าเงินเดือน',
  LeaveEntitlement: 'สิทธิวันลา',
  OvertimeEntry: 'OT',
  Holiday: 'วันหยุด',
  Attendance: 'การลงเวลา',
  LeaveRequest: 'คำขอลา',
  CashAdvance: 'คำขอเบิก',
  Payroll: 'เงินเดือน',
  PayrollAdjustment: 'ปรับเงินเดือน',
  RecurringDeduction: 'หักประจำ',
};

/** Actions that move money, change access, or destroy data — badged in the UI. */
export const SENSITIVE_ACTIONS: ReadonlySet<string> = new Set<AuditAction>([
  'user.role-change',
  'user.delete',
  'user.archive',
  'user.account-merge',
  'user.password-reset',
  'role.create',
  'role.update',
  'role.archive',
  'roleAssignment.create',
  'roleAssignment.delete',
  'employee.delete',
  'employee.archive',
  'payroll.publish',
  'payroll.revise',
  'payroll.unlock',
  'payrollConfig.update',
]);

/** Friendly Thai labels for common before/after diff fields. */
export const FIELD_LABELS: Record<string, string> = {
  baseSalary: 'เงินเดือนฐาน',
  salaryType: 'ประเภทเงินเดือน',
  status: 'สถานะ',
  branchId: 'สาขา',
  departmentId: 'แผนก',
  firstName: 'ชื่อ',
  lastName: 'นามสกุล',
  nickname: 'ชื่อเล่น',
  permissions: 'สิทธิ์',
  roleId: 'บทบาท',
  archivedAt: 'วันที่พ้นสภาพ',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? action;
}

export function entityLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType as AuditEntityType] ?? entityType;
}

export function isSensitive(action: string): boolean {
  return SENSITIVE_ACTIONS.has(action);
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/audit/labels.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Dedupe the owner page**

In `src/app/(owner)/owner/page.tsx`: delete the local `ACTION_LABELS` object (was lines ~77–107) and add an import near the other imports:

```typescript
import { actionLabel } from '@/lib/audit/labels';
```

Then replace any use of `ACTION_LABELS[a.action] ?? a.action` with `actionLabel(a.action)`.

- [ ] **Step 6: Verify owner page still typechecks & lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors referencing `owner/page.tsx` or `labels.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/audit/labels.ts src/lib/audit/labels.test.ts "src/app/(owner)/owner/page.tsx"
git commit -m "feat(audit): shared action/entity labels + sensitivity classification"
```

---

### Task 2: Field-diff module

**Files:**
- Create: `src/lib/audit/diff.ts`
- Test: `src/lib/audit/diff.test.ts`

**Interfaces:**
- Consumes: `fieldLabel` from `./labels`; `formatThaiDate` from `@/lib/format`.
- Produces:
  - `type DiffRow = { field: string; label: string; before: string; after: string; changed: boolean }`
  - `formatValue(v: unknown): string`
  - `diffValues(before: unknown, after: unknown): DiffRow[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/audit/diff.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { diffValues, formatValue } from './diff';

describe('formatValue', () => {
  it('renders null/undefined as an em dash', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue(undefined)).toBe('—');
  });
  it('renders booleans in Thai', () => {
    expect(formatValue(true)).toBe('ใช่');
    expect(formatValue(false)).toBe('ไม่ใช่');
  });
  it('renders numbers with thousands separators', () => {
    expect(formatValue(25000)).toBe('25,000');
  });
  it('passes strings through', () => {
    expect(formatValue('Active')).toBe('Active');
  });
  it('stringifies objects/arrays', () => {
    expect(formatValue(['a', 'b'])).toBe('["a","b"]');
  });
});

describe('diffValues', () => {
  it('returns one row per changed field with formatted before/after', () => {
    const rows = diffValues({ baseSalary: 25000 }, { baseSalary: 28000 });
    expect(rows).toEqual([
      { field: 'baseSalary', label: 'เงินเดือนฐาน', before: '25,000', after: '28,000', changed: true },
    ]);
  });
  it('marks added and removed fields', () => {
    const rows = diffValues({ a: 1 }, { a: 1, b: 2 });
    const b = rows.find((r) => r.field === 'b');
    expect(b).toEqual({ field: 'b', label: 'b', before: '—', after: '2', changed: true });
  });
  it('includes unchanged fields flagged changed:false', () => {
    const rows = diffValues({ status: 'Active' }, { status: 'Active' });
    expect(rows).toEqual([
      { field: 'status', label: 'สถานะ', before: 'Active', after: 'Active', changed: false },
    ]);
  });
  it('returns [] when both sides are null/absent', () => {
    expect(diffValues(null, null)).toEqual([]);
    expect(diffValues(undefined, undefined)).toEqual([]);
  });
  it('sorts fields alphabetically for stable rendering', () => {
    const rows = diffValues({ b: 1, a: 1 }, { b: 2, a: 2 });
    expect(rows.map((r) => r.field)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/audit/diff.test.ts`
Expected: FAIL — `Cannot find module './diff'`.

- [ ] **Step 3: Write the module**

Create `src/lib/audit/diff.ts`:

```typescript
import { fieldLabel } from './labels';

export type DiffRow = {
  field: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
};

const num = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });

/** Render a JSON scalar/array/object as a human-readable display string. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'ใช่' : 'ไม่ใช่';
  if (typeof v === 'number') return num.format(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function toRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Field-by-field diff over the union of keys in before/after, sorted by key. */
export function diffValues(before: unknown, after: unknown): DiffRow[] {
  const b = toRecord(before);
  const a = toRecord(after);
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  return keys.map((field) => {
    const beforeStr = formatValue(b[field]);
    const afterStr = formatValue(a[field]);
    return {
      field,
      label: fieldLabel(field),
      before: beforeStr,
      after: afterStr,
      changed: beforeStr !== afterStr,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/audit/diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/diff.ts src/lib/audit/diff.test.ts
git commit -m "feat(audit): field-diff formatter for before/after JSON"
```

---

### Task 3: Global-scope auth gate

**Files:**
- Modify: `src/lib/auth/check-permission.ts` (add two exports at the end)
- Test: `src/lib/auth/global-permission.test.ts`

**Interfaces:**
- Consumes: `AuthedAssignment` from `@/lib/auth/require-role`; `resolveAuthedUser` (already imported in `check-permission.ts`); `notFound` from `next/navigation` (already imported); `Permission` (already imported).
- Produces:
  - `hasGlobalPermission(assignments: AuthedAssignment[], permission: Permission): boolean` — pure.
  - `requireGlobalPermission(permission: Permission): Promise<{ user: User; authUserId: string }>` — throws `notFound()` when the caller lacks a globally-scoped grant.

- [ ] **Step 1: Write the failing test** (pure predicate only — the DB wrapper is covered by manual verification)

Create `src/lib/auth/global-permission.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { AuthedAssignment } from './require-role';
import { hasGlobalPermission } from './check-permission';

function assignment(over: Partial<AuthedAssignment['role']> & { branchId?: string | null }): AuthedAssignment {
  const { branchId = null, ...role } = over;
  return {
    branchId,
    role: {
      key: role.key ?? 'admin',
      name: role.name ?? 'Admin',
      isSuperadmin: role.isSuperadmin ?? false,
      archivedAt: role.archivedAt ?? null,
      permissions: role.permissions ?? [],
    },
  };
}

describe('hasGlobalPermission', () => {
  it('grants when a global (branchId=null) assignment includes the permission', () => {
    const a = [assignment({ branchId: null, permissions: ['audit.read'] })];
    expect(hasGlobalPermission(a, 'audit.read')).toBe(true);
  });
  it('grants a superadmin regardless of permission list', () => {
    const a = [assignment({ branchId: null, isSuperadmin: true, permissions: [] })];
    expect(hasGlobalPermission(a, 'audit.read')).toBe(true);
  });
  it('denies when the permission is only branch-scoped', () => {
    const a = [assignment({ branchId: 'branch-uuid', permissions: ['audit.read'] })];
    expect(hasGlobalPermission(a, 'audit.read')).toBe(false);
  });
  it('denies when no assignment includes the permission', () => {
    const a = [assignment({ branchId: null, permissions: ['payroll.read'] })];
    expect(hasGlobalPermission(a, 'audit.read')).toBe(false);
  });
  it('denies with no assignments', () => {
    expect(hasGlobalPermission([], 'audit.read')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/auth/global-permission.test.ts`
Expected: FAIL — `hasGlobalPermission` is not exported.

- [ ] **Step 3: Add the implementation**

Append to `src/lib/auth/check-permission.ts` (it already imports `resolveAuthedUser`, `notFound`, `Permission`, `User`, and the `AuthedAssignment` type comes from `./require-role`):

```typescript
import type { AuthedAssignment } from './require-role';

/**
 * Pure predicate: does this assignment set confer `permission` at GLOBAL scope
 * (an assignment with branchId === null, or any superadmin assignment)?
 */
export function hasGlobalPermission(
  assignments: AuthedAssignment[],
  permission: Permission,
): boolean {
  return assignments.some(
    (a) =>
      a.role.isSuperadmin ||
      (a.branchId === null && a.role.permissions.includes(permission)),
  );
}

/**
 * Admin-area gate for surfaces that must not be branch-scoped (e.g. the audit
 * log). Throws notFound() unless the caller holds `permission` globally.
 */
export async function requireGlobalPermission(
  permission: Permission,
): Promise<{ user: User; authUserId: string }> {
  const { user, authUserId, assignments } = await resolveAuthedUser();
  if (!hasGlobalPermission(assignments, permission)) notFound();
  return { user, authUserId };
}
```

> If `AuthedAssignment` is already imported in this file, reuse the existing import instead of adding a duplicate. If `resolveAuthedUser` is not exported from `./require-role`, export it there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/auth/global-permission.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/check-permission.ts src/lib/auth/global-permission.test.ts
git commit -m "feat(auth): global-scope permission gate (hasGlobalPermission/requireGlobalPermission)"
```

---

### Task 4: Query layer (where-builder + keyset page + actor resolution)

**Files:**
- Create: `src/lib/audit/query.ts`
- Test (unit): `src/lib/audit/query.test.ts` (pure `buildAuditWhere` only)
- Test (integration): `tests/integration/audit-query.integration.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/prisma`; `Prisma` from `@prisma/client`.
- Produces:
  - `const AUDIT_PAGE_SIZE = 50`
  - `type AuditFilterParams = { actor?: string; action?: string; entityType?: string; entityId?: string; dateFrom?: string; dateTo?: string }`
  - `buildAuditWhere(p: AuditFilterParams): Prisma.AuditLogWhereInput` — pure.
  - `fetchAuditPage(where, cursorId?): Promise<{ rows: AuditRow[]; nextCursor: string | null }>` where `AuditRow` is the Prisma `AuditLog` row.
  - `resolveActors(actorIds: (string | null)[]): Promise<Map<string, string>>`

- [ ] **Step 1: Write the failing unit test**

Create `src/lib/audit/query.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildAuditWhere } from './query';

describe('buildAuditWhere', () => {
  it('returns an empty where for no filters', () => {
    expect(buildAuditWhere({})).toEqual({});
  });
  it('filters by actor, action, entityType, entityId', () => {
    expect(
      buildAuditWhere({ actor: 'a1', action: 'payroll.publish', entityType: 'Payroll', entityId: 'e1' }),
    ).toEqual({ actorId: 'a1', action: 'payroll.publish', entityType: 'Payroll', entityId: 'e1' });
  });
  it('builds an inclusive Bangkok-day createdAt range', () => {
    const where = buildAuditWhere({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });
    expect(where.createdAt).toEqual({
      gte: new Date('2026-06-01T00:00:00+07:00'),
      lte: new Date('2026-06-30T23:59:59.999+07:00'),
    });
  });
  it('supports an open-ended (from-only) range', () => {
    const where = buildAuditWhere({ dateFrom: '2026-06-01' });
    expect(where.createdAt).toEqual({ gte: new Date('2026-06-01T00:00:00+07:00') });
  });
  it('ignores blank strings', () => {
    expect(buildAuditWhere({ actor: '', action: '   ' })).toEqual({});
  });
});
```

- [ ] **Step 2: Run unit test to verify it fails**

Run: `npm test -- src/lib/audit/query.test.ts`
Expected: FAIL — `Cannot find module './query'`.

- [ ] **Step 3: Write the module**

Create `src/lib/audit/query.ts`:

```typescript
import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilterParams = {
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string; // 'YYYY-MM-DD', interpreted in Asia/Bangkok
  dateTo?: string; // 'YYYY-MM-DD', inclusive
};

export type AuditRow = Prisma.AuditLogGetPayload<Record<string, never>>;

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** Pure: build a Prisma where-clause from parsed filter params. */
export function buildAuditWhere(p: AuditFilterParams): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  const actor = clean(p.actor);
  const action = clean(p.action);
  const entityType = clean(p.entityType);
  const entityId = clean(p.entityId);
  const from = clean(p.dateFrom);
  const to = clean(p.dateTo);

  if (actor) where.actorId = actor;
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (from || to) {
    const range: Prisma.DateTimeFilter = {};
    if (from) range.gte = new Date(`${from}T00:00:00+07:00`);
    if (to) range.lte = new Date(`${to}T23:59:59.999+07:00`);
    where.createdAt = range;
  }
  return where;
}

/**
 * Keyset page over AuditLog, newest first. Fetches PAGE_SIZE+1 to detect a next
 * page; returns the id of the last row as the next cursor (or null at the end).
 */
export async function fetchAuditPage(
  where: Prisma.AuditLogWhereInput,
  cursorId?: string,
): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: AUDIT_PAGE_SIZE + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });
  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;
  return { rows: page, nextCursor: hasMore ? page[page.length - 1].id : null };
}

/** Bulk-resolve actor ids to display names. Nulls are skipped (caller shows 'ระบบ'). */
export async function resolveActors(actorIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(actorIds.filter((v): v is string => v !== null)));
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
  });
  return new Map(
    users.map((u) => [
      u.id,
      u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : (u.email ?? u.id.slice(0, 8)),
    ]),
  );
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npm test -- src/lib/audit/query.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing integration test**

Create `tests/integration/audit-query.integration.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { AUDIT_PAGE_SIZE, buildAuditWhere, fetchAuditPage, resolveActors } from '@/lib/audit/query';

async function reset() {
  await prisma.auditLog.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
}

async function makeAudit(over: {
  actorId?: string | null;
  action?: string;
  entityType?: string;
  entityId?: string;
  createdAt?: Date;
}) {
  return prisma.auditLog.create({
    data: {
      actorId: over.actorId ?? null,
      action: over.action ?? 'employee.update',
      entityType: over.entityType ?? 'Employee',
      entityId: over.entityId ?? crypto.randomUUID(),
      createdAt: over.createdAt ?? new Date(),
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('fetchAuditPage', () => {
  it('returns newest-first and paginates by keyset cursor', async () => {
    for (let i = 0; i < AUDIT_PAGE_SIZE + 5; i++) {
      await makeAudit({ createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, i)) });
    }
    const first = await fetchAuditPage({});
    expect(first.rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    // newest first
    expect(first.rows[0].createdAt.getTime()).toBeGreaterThan(first.rows[1].createdAt.getTime());

    const second = await fetchAuditPage({}, first.nextCursor ?? undefined);
    expect(second.rows).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    // no overlap
    const firstIds = new Set(first.rows.map((r) => r.id));
    expect(second.rows.every((r) => !firstIds.has(r.id))).toBe(true);
  });

  it('applies the action filter via buildAuditWhere', async () => {
    await makeAudit({ action: 'payroll.publish' });
    await makeAudit({ action: 'employee.update' });
    const { rows } = await fetchAuditPage(buildAuditWhere({ action: 'payroll.publish' }));
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('payroll.publish');
  });
});

describe('resolveActors', () => {
  it('resolves employee names and email, and retains a deleted actor id', async () => {
    const u1 = await prisma.user.create({ data: { email: 'boss@x.com' } });
    const u2 = await prisma.user.create({ data: {} });
    await prisma.employee.create({
      data: {
        userId: u2.id,
        firstName: 'สม',
        lastName: 'ชาย',
        branchId: (await prisma.branch.create({ data: { name: 'HQ' } })).id,
        salaryType: 'Monthly',
        baseSalary: 20000,
        status: 'Active',
        hiredAt: new Date('2026-01-01'),
      },
    });
    const map = await resolveActors([u1.id, u2.id, 'ffffffff-ffff-4fff-8fff-ffffffffffff', null]);
    expect(map.get(u1.id)).toBe('boss@x.com');
    expect(map.get(u2.id)).toBe('สม ชาย');
    expect(map.has('ffffffff-ffff-4fff-8fff-ffffffffffff')).toBe(false); // not a real user
  });
});
```

> Note: `makeAudit` writes `entityId` as a random UUID because `AuditLog.entityId` is `@db.Uuid`. The `branch.create` inside `resolveActors` seeds the minimum Employee FK graph; if your `Branch`/`Employee` models require more non-null fields, mirror the fuller `makeEmployee` helper in `tests/integration/reports.integration.test.ts`.

- [ ] **Step 6: Run integration test to verify it passes**

Run: `npm run test:integration -- audit-query`
Expected: PASS. (Requires the local test DB per `vitest.integration.config.ts` — `TEST_DATABASE_URL` / default `127.0.0.1:54422/koolman_test`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/audit/query.ts src/lib/audit/query.test.ts tests/integration/audit-query.integration.test.ts
git commit -m "feat(audit): query layer — where-builder, keyset paging, actor resolution"
```

---

### Task 5: `AuditRow` client component

**Files:**
- Create: `src/app/(admin)/admin/audit/audit-row.tsx`

**Interfaces:**
- Consumes: `actionLabel`, `entityLabel`, `isSensitive` from `@/lib/audit/labels`; `diffValues` from `@/lib/audit/diff`; `formatThaiDate` from `@/lib/format`; `StatusBadge` from `@/components/ui/status-badge`.
- Produces: `AuditRow` React component and its `AuditRowData` prop type (consumed by the page in Task 7):

```typescript
export type AuditRowData = {
  id: string;
  actorLabel: string; // resolved on the server ('ระบบ' for null actor)
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string; // ISO
  before: unknown;
  after: unknown;
  metadata: unknown;
};
```

- [ ] **Step 1: Create the component**

Create `src/app/(admin)/admin/audit/audit-row.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { diffValues } from '@/lib/audit/diff';
import { actionLabel, entityLabel, isSensitive } from '@/lib/audit/labels';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatThaiDate } from '@/lib/format';

export type AuditRowData = {
  id: string;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  before: unknown;
  after: unknown;
  metadata: unknown;
};

export function AuditRow({ row }: { row: AuditRowData }) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const diff = diffValues(row.before, row.after);
  const when = formatThaiDate(new Date(row.createdAt));
  const entityHref = `/admin/audit?entityType=${encodeURIComponent(row.entityType)}&entityId=${encodeURIComponent(row.entityId)}`;

  return (
    <li className="surface px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink-1">{row.actorLabel}</span>
          <span className="text-ink-3">{actionLabel(row.action)}</span>
          {isSensitive(row.action) && <StatusBadge status="danger">สำคัญ</StatusBadge>}
          <span className="text-xs text-ink-4">· {entityLabel(row.entityType)}</span>
        </span>
        <span className="whitespace-nowrap text-xs text-ink-4">{when}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 text-sm">
          <a href={entityHref} className="text-primary-700 hover:text-primary-800">
            ดูประวัติของรายการนี้ →
          </a>

          {diff.length > 0 ? (
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {diff.map((d) => (
                  <tr key={d.field} className={d.changed ? '' : 'text-ink-4'}>
                    <td className="py-1 pr-4 font-medium text-ink-2">{d.label}</td>
                    <td className="py-1 pr-2 text-ink-3">{d.before}</td>
                    <td className="py-1 pr-2">→</td>
                    <td className="py-1 text-ink-1">{d.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-ink-4">ไม่มีรายละเอียดการเปลี่ยนแปลง</p>
          )}

          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-xs text-ink-4 underline"
          >
            {showRaw ? 'ซ่อน JSON ดิบ' : 'ดู JSON ดิบ'}
          </button>
          {showRaw && (
            <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs text-ink-2">
              {JSON.stringify({ before: row.before, after: row.after, metadata: row.metadata }, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
```

> `StatusBadge`'s `status` prop is a `StatusKey`. Confirm a red/danger key exists in `src/components/ui/status-badge.tsx` (`STATUS_COLORS`). If the key is named differently (e.g. `'error'` or `'red'`), use that name; do not invent one.

- [ ] **Step 2: Verify typecheck & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors in `audit-row.tsx`. Fix any `StatusKey` / `surface` / `text-ink-*` mismatches against the real design tokens.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/audit/audit-row.tsx"
git commit -m "feat(audit): expandable AuditRow with field diff and raw JSON toggle"
```

---

### Task 6: `AuditFilters` client component

**Files:**
- Create: `src/app/(admin)/admin/audit/audit-filters.tsx`

**Interfaces:**
- Consumes: `useRouter` from `next/navigation`; `ACTION_LABELS`, `ENTITY_TYPE_LABELS` from `@/lib/audit/labels`.
- Produces: `AuditFilters` component with props:

```typescript
type AuditFiltersProps = {
  initial: { actor?: string; action?: string; entityType?: string; dateFrom?: string; dateTo?: string };
  actors: { id: string; label: string }[]; // admin/owner users, provided by the page
};
```

- [ ] **Step 1: Create the component**

Create `src/app/(admin)/admin/audit/audit-filters.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { ACTION_LABELS, ENTITY_TYPE_LABELS } from '@/lib/audit/labels';

type AuditFiltersProps = {
  initial: { actor?: string; action?: string; entityType?: string; dateFrom?: string; dateTo?: string };
  actors: { id: string; label: string }[];
};

export function AuditFilters({ initial, actors }: AuditFiltersProps) {
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      const value = typeof v === 'string' ? v.trim() : '';
      if (value) params.set(k, value);
    }
    // Filter changes reset keyset pagination — do not carry `cursor`.
    const qs = params.toString();
    router.push(qs ? `/admin/audit?${qs}` : '/admin/audit');
  }

  return (
    <form onSubmit={handleSubmit} className="surface flex flex-wrap items-end gap-3 p-4">
      <label className="flex flex-col text-xs text-ink-3">
        ผู้กระทำ
        <select name="actor" defaultValue={initial.actor ?? ''} className="input mt-1">
          <option value="">ทั้งหมด</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col text-xs text-ink-3">
        การกระทำ
        <select name="action" defaultValue={initial.action ?? ''} className="input mt-1">
          <option value="">ทั้งหมด</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col text-xs text-ink-3">
        ประเภทรายการ
        <select name="entityType" defaultValue={initial.entityType ?? ''} className="input mt-1">
          <option value="">ทั้งหมด</option>
          {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col text-xs text-ink-3">
        ตั้งแต่
        <input type="date" name="dateFrom" defaultValue={initial.dateFrom ?? ''} className="input mt-1" />
      </label>

      <label className="flex flex-col text-xs text-ink-3">
        ถึง
        <input type="date" name="dateTo" defaultValue={initial.dateTo ?? ''} className="input mt-1" />
      </label>

      <button type="submit" className="btn btn-secondary">
        กรอง
      </button>
    </form>
  );
}
```

> `className="input"`, `btn`, `btn-secondary`, `surface` are assumed utility classes. Verify against an existing filter component (`src/app/(admin)/admin/employees/employee-filters.tsx`). If that file uses raw `<input className="...">` with different classes or a shared `FormField`, match it rather than these placeholders.

- [ ] **Step 2: Verify typecheck & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors in `audit-filters.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/audit/audit-filters.tsx"
git commit -m "feat(audit): URL-driven filter bar (actor/action/entity/date)"
```

---

### Task 7: Audit page (server component) wiring

**Files:**
- Create: `src/app/(admin)/admin/audit/page.tsx`

**Interfaces:**
- Consumes: `requireGlobalPermission` from `@/lib/auth/check-permission`; `buildAuditWhere`, `fetchAuditPage`, `resolveActors` from `@/lib/audit/query`; `AuditRow`, `AuditRowData` from `./audit-row`; `AuditFilters` from `./audit-filters`; `prisma`; `PageHeader` from `@/components/ui/page-header`.

- [ ] **Step 1: Create the page**

Create `src/app/(admin)/admin/audit/page.tsx`:

```tsx
import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { requireGlobalPermission } from '@/lib/auth/check-permission';
import { buildAuditWhere, fetchAuditPage, resolveActors } from '@/lib/audit/query';
import { PageHeader } from '@/components/ui/page-header';
import { AuditFilters } from './audit-filters';
import { AuditRow, type AuditRowData } from './audit-row';

type SearchParams = Promise<{
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
}>;

export default async function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  await requireGlobalPermission('audit.read');
  const sp = await searchParams;

  const where = buildAuditWhere(sp);
  const { rows, nextCursor } = await fetchAuditPage(where, sp.cursor);

  const actorMap = await resolveActors(rows.map((r) => r.actorId));

  // Actor filter options: users who hold at least one role assignment (admins/owners).
  const admins = await prisma.user.findMany({
    where: { roleAssignments: { some: {} } },
    select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const actorOptions = admins.map((u) => ({
    id: u.id,
    label: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : (u.email ?? u.id.slice(0, 8)),
  }));

  const data: AuditRowData[] = rows.map((r) => ({
    id: r.id,
    actorLabel: r.actorId ? (actorMap.get(r.actorId) ?? r.actorId.slice(0, 8)) : 'ระบบ',
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    createdAt: r.createdAt.toISOString(),
    before: r.beforeValue,
    after: r.afterValue,
    metadata: r.metadata,
  }));

  // Preserve active filters when following the next-page cursor link.
  const nextParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k !== 'cursor' && typeof v === 'string' && v) nextParams.set(k, v);
  }
  if (nextCursor) nextParams.set('cursor', nextCursor);
  const nextHref = `/admin/audit?${nextParams.toString()}`;

  return (
    <div className="space-y-4">
      <PageHeader title="ประวัติการเปลี่ยนแปลง" />
      <AuditFilters
        initial={{
          actor: sp.actor,
          action: sp.action,
          entityType: sp.entityType,
          dateFrom: sp.dateFrom,
          dateTo: sp.dateTo,
        }}
        actors={actorOptions}
      />

      {data.length === 0 ? (
        <div className="surface p-8 text-center text-ink-4">ไม่พบรายการที่ตรงกับตัวกรอง</div>
      ) : (
        <ul className="space-y-2">
          {data.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Link href={nextHref} className="btn btn-secondary">
            ถัดไป →
          </Link>
        </div>
      )}
    </div>
  );
}
```

> `PageHeader`'s exact prop API and the `btn`/`surface`/`text-ink-*` classes must match existing usage — cross-check `src/app/(admin)/admin/employees/page.tsx`. Adjust prop names (e.g. if `PageHeader` needs `subtitle` or an action slot) to the real signature.

- [ ] **Step 2: Verify typecheck & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors in `audit/page.tsx`.

- [ ] **Step 3: Manual smoke test**

Start the dev server (`npm run dev`), sign in as an admin/superadmin, visit `/admin/audit`. Verify: rows render newest-first; a filter (e.g. action = เผยแพร่เงินเดือน) narrows results and updates the URL; clicking a row expands a diff; "ถัดไป" advances the page and keeps filters; a sensitive row shows the badge.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/audit/page.tsx"
git commit -m "feat(audit): /admin/audit page — gated feed with filters and paging"
```

---

### Task 8: Enable the sidebar item

**Files:**
- Modify: `src/components/admin/sidebar.tsx`

- [ ] **Step 1: Flip the audit item to live + permission-gated**

In `src/components/admin/sidebar.tsx`, find the System (`ระบบ`) section item:

```typescript
{ href: '/admin/audit', label: 'Audit log', Icon: History }, // disabled — "coming soon" placeholder
```

Replace with:

```typescript
{ href: '/admin/audit', label: 'ประวัติการเปลี่ยนแปลง', Icon: History, enabled: true, permission: 'audit.read' },
```

> This shows the item to any `audit.read` holder. The *page* enforces global scope via `requireGlobalPermission`; since `audit.read` is currently granted only to global Admin + Superadmin, no branch-scoped holder exists to see a dead link. If branch-scoped `audit.read` is ever granted, revisit sidebar visibility (Phase 2).

- [ ] **Step 2: Verify typecheck, lint, and full unit suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all green.

- [ ] **Step 3: Manual check**

Reload the admin app: the System section shows "ประวัติการเปลี่ยนแปลง" as a live link (no "เร็วๆ นี้" tag) for an admin; the link opens the page.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/sidebar.tsx
git commit -m "feat(audit): enable /admin/audit in the sidebar"
```

---

## Self-Review

**Spec coverage** (against `2026-07-06-audit-log-viewer-design.md`):

- Route + gate (global-scoped `audit.read`) → Tasks 3, 7. ✅
- `hasGlobalPermission` helper → Task 3. ✅
- Sidebar enable + visibility gate → Task 8. ✅
- Query layer (`buildAuditWhere`, keyset paging, `resolveActors`) → Task 4. ✅
- Shared labels (dedupe owner page), entity labels, `SENSITIVE_ACTIONS`, `FIELD_LABELS` → Task 1. ✅
- Field diff + formatters + raw JSON toggle → Tasks 2, 5. ✅
- `AuditFilters` (URL state; actor/date/action lead) → Task 6. ✅
- `AuditRow` (collapsed summary, sensitive badge, expand → diff + metadata) → Task 5. ✅
- Target = entity link that self-filters the feed → Task 5 (`entityHref`). ✅
- Tests: unit (diff, labels, where-builder, global-permission) + integration (paging, filter, actor resolution) → Tasks 1–4. ✅
- Non-goals (entity tabs, branch scoping, CSV, streaming, bulk grouping) → not implemented, as intended. ✅

**Deviation from spec, noted:** pagination is **forward-only** (next cursor), not prev/next. Keyset back-paging needs a cursor stack; deferred as YAGNI. Users narrow with the date/actor filters instead. Flag to the user at execution time if bidirectional paging is wanted.

**Placeholder scan:** No TBD/TODO in task steps. Design-token/class names (`surface`, `btn`, `input`, `text-ink-*`, `StatusKey='danger'`, `PageHeader` props) are called out with explicit "verify against existing file" notes rather than assumed silently — these are the known-unknowns a fresh implementer must reconcile with the real UI kit.

**Type consistency:** `AuditRowData` defined in Task 5, consumed in Task 7 — field names match (`actorLabel`, `before`/`after`/`metadata` as `unknown`). `buildAuditWhere`/`fetchAuditPage`/`resolveActors` signatures in Task 4 match their calls in Task 7. `hasGlobalPermission(assignments, permission)` in Task 3 matches its use in `requireGlobalPermission`.
