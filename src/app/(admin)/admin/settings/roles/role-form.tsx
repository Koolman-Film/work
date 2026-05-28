'use client';

/**
 * Shared role form — used for both create + edit modes.
 *
 * Client Component because the permission picker has live UX:
 *   - "Select all in group" checkbox shows mixed state when partial
 *   - Permission count updates as user checks/unchecks
 *
 * The grouped layout uses PERMISSION_GROUPS from permissions.ts. Each
 * group is a collapsible section; users scroll the long list far less
 * than they would scrolling a flat alphabetical checkbox grid.
 *
 * System role notes (when isSystem=true):
 *   - `name` + `description` + `permissions` are editable
 *   - `key` is shown read-only
 *   - The form shows a yellow info banner explaining what's protected
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { PERMISSION_GROUPS, PERMISSIONS, type Permission } from '@/lib/auth/permissions';

type Mode =
  | { mode: 'create'; action: (formData: FormData) => Promise<void>; initial?: undefined }
  | {
      mode: 'edit';
      action: (formData: FormData) => Promise<void>;
      initial: {
        key: string;
        name: string;
        description: string | null;
        permissions: ReadonlyArray<string>;
        isSystem: boolean;
        isSuperadmin: boolean;
      };
    };

type Props = Mode & {
  error?: string | null;
  extraActions?: React.ReactNode;
};

export function RoleForm({ mode, action, initial, error, extraActions }: Props) {
  const isSystemRole = mode === 'edit' && initial.isSystem;
  const isSuperadminRole = mode === 'edit' && initial.isSuperadmin;

  // Track selected permissions in component state so we can render the
  // "X / Y selected" count + the group-level "select all" mixed state.
  const initialSet = useMemo(
    () => new Set((mode === 'edit' ? initial.permissions : []) as Permission[]),
    [mode, initial],
  );
  const [selected, setSelected] = useState<Set<Permission>>(initialSet);

  const totalCount = Object.keys(PERMISSIONS).length;

  function togglePermission(p: Permission, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });
  }

  function toggleGroup(groupPerms: ReadonlyArray<Permission>, allOn: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of groupPerms) {
        if (allOn) next.delete(p);
        else next.add(p);
      }
      return next;
    });
  }

  const submitLabel = mode === 'create' ? 'สร้างบทบาท' : 'บันทึก';

  return (
    <form action={action} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{mode === 'create' ? 'สร้างบทบาทใหม่' : `แก้ไข: ${initial.name}`}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {/* System role notice — explains what's locked vs editable */}
          {isSystemRole && (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="font-medium">บทบาทระบบ — แก้ไขได้บางส่วน</p>
              <p className="mt-0.5">
                ✓ แก้ชื่อ / คำอธิบาย / รายการสิทธิ์ได้
                <br />✗ ไม่สามารถลบหรือเปลี่ยน key ของบทบาทระบบ
                {isSuperadminRole && (
                  <>
                    <br />✗ Superadmin มีสิทธิ์ทุกอย่างโดยอัตโนมัติ — รายการด้านล่างเป็นเอกสารเฉยๆ
                  </>
                )}
              </p>
            </div>
          )}

          <FormField label="ชื่อบทบาท" htmlFor="name" required>
            <Input
              id="name"
              name="name"
              required
              maxLength={60}
              defaultValue={mode === 'edit' ? initial.name : ''}
              placeholder="เช่น หัวหน้าทีมติดฟิล์ม"
              autoFocus
            />
          </FormField>

          {mode === 'edit' && (
            <FormField
              label="Key (ID ภายในระบบ — ใช้ในโค้ด)"
              htmlFor="key"
              hint="กำหนดอัตโนมัติตอนสร้าง — ไม่สามารถแก้ไขได้"
            >
              <Input id="key" value={initial.key} readOnly className="bg-gray-50 font-mono" />
            </FormField>
          )}

          <FormField
            label="คำอธิบาย"
            htmlFor="description"
            hint="แสดงในหน้ารายการบทบาทเพื่อช่วยจำว่าบทบาทนี้ทำอะไรได้"
          >
            <Textarea
              id="description"
              name="description"
              rows={2}
              maxLength={500}
              defaultValue={mode === 'edit' ? (initial.description ?? '') : ''}
            />
          </FormField>
        </CardBody>
      </Card>

      {/* ─── Permission picker ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>
            สิทธิ์การใช้งาน{' '}
            <span className="text-sm font-normal text-gray-500">
              ({selected.size} / {totalCount} ติ๊ก)
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody>
          {isSuperadminRole && (
            <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Superadmin ได้รับสิทธิ์ทั้งหมดอัตโนมัติผ่าน flag <code>isSuperadmin=true</code> —
              รายการที่ติ๊กด้านล่างใช้สำหรับการอ้างอิงเท่านั้น
            </p>
          )}

          <div className="space-y-4">
            {PERMISSION_GROUPS.map((group) => {
              const groupSet = new Set(group.permissions);
              const checkedCount = group.permissions.filter((p) => selected.has(p)).length;
              const allChecked = checkedCount === group.permissions.length;
              const someChecked = checkedCount > 0 && !allChecked;

              return (
                <fieldset key={group.key} className="rounded-lg border border-gray-200 p-3">
                  <legend className="px-2">
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => {
                          if (el) el.indeterminate = someChecked;
                        }}
                        onChange={() => toggleGroup([...groupSet] as Permission[], allChecked)}
                        className="size-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500/30"
                      />
                      <span>
                        {group.label}{' '}
                        <span className="text-xs font-normal text-gray-500">
                          ({checkedCount}/{group.permissions.length})
                        </span>
                      </span>
                    </label>
                  </legend>
                  <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {group.permissions.map((p) => (
                      <label
                        key={p}
                        className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          name="permissions"
                          value={p}
                          checked={selected.has(p)}
                          onChange={(e) => togglePermission(p, e.target.checked)}
                          className="mt-0.5 size-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500/30"
                        />
                        <span className="min-w-0">
                          <span className="block leading-snug">{PERMISSIONS[p]}</span>
                          <code className="block text-[10px] text-gray-400">{p}</code>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </CardBody>
        <CardFooter className="flex justify-end">
          <Button type="submit">{submitLabel}</Button>
        </CardFooter>
      </Card>

      {extraActions && (
        <div className="rounded-xl border border-red-200 bg-red-50/30 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">พื้นที่อันตราย</p>
          <div className="mt-3 flex justify-end">{extraActions}</div>
        </div>
      )}
    </form>
  );
}
