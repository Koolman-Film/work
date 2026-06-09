'use client';

/**
 * Profile edit form — single-form pattern (Save button at bottom).
 *
 * Why useTransition + manual error state rather than react-hook-form:
 *   - Five plain text fields with one Save button doesn't need RHF's
 *     overhead. State stays trivial.
 *   - The Server Action returns a discriminated `UpdateProfileResult`
 *     with an optional `field` pointer for per-field error rendering.
 *     We surface that via the FormField's `error` prop next to the
 *     offending input rather than as a single top-of-form toast.
 *
 * Optimistic UX: after a successful save we briefly show a green
 * "บันทึกแล้ว" affirmation then re-enable Save — the parent server
 * component will re-render on next nav with the persisted values.
 */

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  type UpdateProfileInput,
  type UpdateProfileResult,
  updateOwnProfile,
} from '@/lib/employee/profile-actions';

type Props = {
  initial: UpdateProfileInput;
};

export function ProfileForm({ initial }: Props) {
  const t = useTranslations('profile');
  const [nickname, setNickname] = useState(initial.nickname ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [personalEmail, setPersonalEmail] = useState(initial.personalEmail ?? '');
  const [address, setAddress] = useState(initial.address ?? '');
  const [emergencyContact, setEmergencyContact] = useState(initial.emergencyContact ?? '');

  const [errors, setErrors] = useState<Partial<Record<keyof UpdateProfileInput, string>>>({});
  const [globalMsg, setGlobalMsg] = useState<
    { kind: 'success'; text: string } | { kind: 'error'; text: string } | null
  >(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setGlobalMsg(null);

    startTransition(async () => {
      const result: UpdateProfileResult = await updateOwnProfile({
        nickname,
        phone,
        personalEmail,
        address,
        emergencyContact,
      });

      if (result.ok) {
        setGlobalMsg({ kind: 'success', text: t('saved') });
        // Auto-clear the affirmation after 2.5s so it doesn't linger.
        setTimeout(() => setGlobalMsg(null), 2500);
        return;
      }

      // Per-field error → render next to the input
      if (result.field) {
        setErrors({ [result.field]: result.message });
      } else {
        // Cross-cutting (e.g. db-error / forbidden) → top-of-form
        setGlobalMsg({ kind: 'error', text: result.message });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormField label={t('field.nickname')} htmlFor="nickname" error={errors.nickname}>
        <Input
          id="nickname"
          name="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={t('placeholder.nickname')}
          maxLength={50}
        />
      </FormField>

      <FormField
        label={t('field.phone')}
        htmlFor="phone"
        error={errors.phone}
        hint={t('hint.phone')}
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t('placeholder.phone')}
          inputMode="tel"
          autoComplete="tel"
        />
      </FormField>

      <FormField label={t('field.email')} htmlFor="personalEmail" error={errors.personalEmail}>
        <Input
          id="personalEmail"
          name="personalEmail"
          type="email"
          value={personalEmail}
          onChange={(e) => setPersonalEmail(e.target.value)}
          placeholder={t('placeholder.email')}
          inputMode="email"
          autoComplete="email"
        />
      </FormField>

      <FormField label={t('field.address')} htmlFor="address" error={errors.address}>
        <textarea
          id="address"
          name="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder={t('placeholder.address')}
        />
      </FormField>

      <FormField
        label={t('field.emergencyContact')}
        htmlFor="emergencyContact"
        error={errors.emergencyContact}
        hint={t('hint.emergencyContact')}
      >
        <Input
          id="emergencyContact"
          name="emergencyContact"
          value={emergencyContact}
          onChange={(e) => setEmergencyContact(e.target.value)}
          placeholder={t('placeholder.emergencyContact')}
          maxLength={200}
        />
      </FormField>

      {/* Status banner */}
      {globalMsg && (
        <div
          role={globalMsg.kind === 'error' ? 'alert' : 'status'}
          className={
            globalMsg.kind === 'success'
              ? 'rounded-md bg-green-50 px-3 py-2 text-sm text-green-700'
              : 'rounded-md bg-red-50 px-3 py-2 text-sm text-red-700'
          }
        >
          {globalMsg.text}
        </div>
      )}

      <div className="pt-2">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}
