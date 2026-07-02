'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

/**
 * Shared form for creating a new admin/owner account.
 *
 * Edit mode uses a separate, more specialized layout (split into "role"
 * + "reset password" + "archive" sections) — see /edit/page.tsx. This
 * form is create-only.
 *
 * Each row emits one `roleId` field and one `branchId` field with the
 * same name so the server action's `formData.getAll('roleId')` /
 * `getAll('branchId')` reads them index-aligned. `branchId` is either
 * a Branch UUID or the literal `'global'`.
 *
 * Privilege guards live server-side in `createTeamMember`; the form
 * lists all active roles without filtering (same rationale as
 * assignments-section.tsx — let the action surface the permission
 * error rather than hiding options confusingly).
 */

type RoleOpt = { id: string; name: string; isSuperadmin: boolean; isSystem: boolean };
type BranchOpt = { id: string; name: string };

type Props = {
  action: (formData: FormData) => Promise<void>;
  error?: string | null;
  /** Carried back across redirect so the email field doesn't lose its value. */
  email?: string | null;
  roles: RoleOpt[];
  branches: BranchOpt[];
};

let nextId = 0;
const newRow = (): Row => ({ uid: ++nextId, roleId: '', branchId: 'global' });

type Row = { uid: number; roleId: string; branchId: string };

export function TeamCreateForm({ action, error, email, roles, branches }: Props) {
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);

  const addRow = () => setRows((r) => [...r, newRow()]);

  const removeRow = (uid: number) =>
    setRows((r) => (r.length === 1 ? r : r.filter((row) => row.uid !== uid)));

  const setRow = (uid: number, patch: Partial<Omit<Row, 'uid'>>) =>
    setRows((r) => r.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));

  return (
    <form action={action}>
      <Card>
        <CardHeader>
          <CardTitle>เพิ่มผู้ดูแลใหม่</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <FormField label="อีเมล" htmlFor="email" required hint="ใช้สำหรับเข้าสู่ระบบ — ไม่ต้องยืนยันอีเมล">
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="off"
              maxLength={120}
              defaultValue={email ?? ''}
              autoFocus
            />
          </FormField>

          <FormField
            label="รหัสผ่านชั่วคราว"
            htmlFor="password"
            required
            hint="อย่างน้อย 8 ตัวอักษร — ส่งให้ผู้ใช้ใหม่ทาง LINE หรือพบกันตรงๆ"
          >
            <Input
              id="password"
              name="password"
              type="text"
              required
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              className="font-mono"
            />
          </FormField>

          {/* ─── Assignment rows ─────────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">
              บทบาท <span className="text-red-500">*</span>
            </p>

            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.uid} className="flex items-center gap-2">
                  <select
                    name="roleId"
                    required
                    value={row.roleId}
                    onChange={(e) => setRow(row.uid, { roleId: e.target.value })}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                  >
                    <option value="" disabled>
                      เลือกบทบาท...
                    </option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.isSuperadmin ? ' (Superadmin)' : ''}
                        {!r.isSystem ? ' [กำหนดเอง]' : ''}
                      </option>
                    ))}
                  </select>

                  <select
                    name="branchId"
                    required
                    value={row.branchId}
                    onChange={(e) => setRow(row.uid, { branchId: e.target.value })}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                  >
                    <option value="global">ทุกสาขา (Global)</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => removeRow(row.uid)}
                    aria-label="เอาออก"
                    disabled={rows.length === 1}
                    className="grid size-8 shrink-0 place-items-center rounded-md text-gray-400 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addRow}
              className="text-sm text-primary-600 hover:text-primary-800 hover:underline"
            >
              ＋ เพิ่มแถว
            </button>
          </div>
        </CardBody>
        <CardFooter className="flex items-center justify-between">
          <Link href="/admin/settings/team">
            <Button type="button" variant="secondary">
              ยกเลิก
            </Button>
          </Link>
          <Button type="submit">สร้างบัญชี</Button>
        </CardFooter>
      </Card>
    </form>
  );
}
