'use client';

/**
 * Change-password form for /admin/profile.
 *
 * Why a Client Component (not the redirect-with-?error= pattern the
 * other settings forms use):
 *   - Field-level error highlighting (current vs new) reads better
 *     when the error sits next to the offending input rather than in
 *     a global banner at the top
 *   - On success we want to CLEAR the input fields and show a green
 *     confirmation in-place — a redirect would lose the visual context
 *   - `useTransition` keeps the button disabled during the round-trip
 *     without writing our own loading state
 *
 * After a successful change we keep the user on the page (instead of
 * routing them to /admin) — they often want to verify the success
 * message before moving on. The success card sticks until they
 * navigate away.
 */

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { type ChangePasswordResult, changeMyPassword } from './actions';

type FormError = ChangePasswordResult & { ok: false };

export function ChangePasswordForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<FormError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Controlled inputs so we can clear them on success. (Uncontrolled
  // + form.reset() would work too, but explicit state is easier to
  // reason about when we also need to clear errors at the same moment.)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  function onSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const result = await changeMyPassword({
        currentPassword: String(formData.get('currentPassword') ?? ''),
        newPassword: String(formData.get('newPassword') ?? ''),
        confirmPassword: String(formData.get('confirmPassword') ?? ''),
      });

      if (result.ok) {
        setSuccess(result.message);
        // Clear all three fields so a casual onlooker doesn't see the
        // value lingering in the box, and so accidental double-submits
        // don't immediately fail the "must differ from current" check
        // with the now-old value.
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setError(result);
      }
    });
  }

  // Field-specific error matchers — keeps the JSX below tidier.
  const fieldError = (field: FormError['field']): string | null =>
    error?.field === field ? error.message : null;

  return (
    <form action={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>เปลี่ยนรหัสผ่าน</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          {/* Global (non-field) error / success banners */}
          {error?.field === 'form' && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error.message}
            </p>
          )}
          {success && (
            <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
              ✓ {success}
            </p>
          )}

          <FormField
            label="รหัสผ่านปัจจุบัน"
            htmlFor="currentPassword"
            required
            error={fieldError('currentPassword')}
          >
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </FormField>

          <FormField
            label="รหัสผ่านใหม่"
            htmlFor="newPassword"
            required
            hint="อย่างน้อย 8 ตัวอักษร — ผสมตัวเลข/สัญลักษณ์เพื่อเพิ่มความปลอดภัย"
            error={fieldError('newPassword')}
          >
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </FormField>

          <FormField
            label="ยืนยันรหัสผ่านใหม่"
            htmlFor="confirmPassword"
            required
            error={fieldError('confirmPassword')}
          >
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </FormField>
        </CardBody>
        <CardFooter className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
