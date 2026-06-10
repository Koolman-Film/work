'use client';

/**
 * Leave-request form — Client Component because we need live working-day
 * count as the user picks dates, and the action result drives the
 * post-submit redirect.
 *
 * Working-day preview is computed client-side from the chosen dates
 * (excluding Sundays). Holidays are NOT factored into the preview — the
 * authoritative count happens on the server side at approval time. The
 * preview is purely "give the employee a ballpark."
 */

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { submitLeaveRequest } from '@/lib/leave/actions';
import {
  formatDurationParts,
  type LeaveUnit,
  type LeaveUnitConfig,
  segmentFor,
  splitDaysHours,
  standardDayMinutes,
} from '@/lib/leave/units';
import { parseInputDate, workingDaysIn } from '@/lib/leave/working-days';
import { compressToJpeg, uploadLeaveMedicalCert } from '@/lib/storage/upload-selfie';
import { createClient } from '@/lib/supabase/browser';

type LeaveTypeOption = {
  id: string;
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
  allowFullDay: boolean;
  allowHalfDay: boolean;
  allowHourly: boolean;
  overQuotaPolicy: 'Block' | 'DeductPay';
};

type Props = {
  leaveTypes: readonly LeaveTypeOption[];
  /** YYYY-MM-DD for the date input `min` — earliest back-fileable day (today − 7d). */
  minDate: string;
  /** YYYY-MM-DD the form pre-fills — today in Bangkok (not the back-date floor). */
  defaultDate: string;
  leaveConfig: LeaveUnitConfig;
  /** Remaining minutes per leave type id for the current year (null = unlimited). */
  remainingByType: Record<string, number | null>;
  /** Per-minute deduction rate (Baht) derived from employee salary on the server. */
  ratePerMinute: number;
};

export function LeaveNewForm({
  leaveTypes,
  minDate,
  defaultDate,
  leaveConfig,
  remainingByType,
  ratePerMinute,
}: Props) {
  const router = useRouter();
  const t = useTranslations('leave');
  const tUnits = useTranslations('units');
  const locale = useLocale() as Locale;
  // Locale-aware "1 วัน 3 ชม." / "1 day 3 hr" renderer for charge/balance lines.
  const fmtDuration = (minutes: number) =>
    formatDurationParts(splitDaysHours(minutes, leaveConfig), {
      day: (n) => tUnits('day', { n }),
      hour: (n) => tUnits('hour', { n }),
      min: (n) => tUnits('min', { n }),
    });
  const fmtMoney = (v: number) => formatMoney(v, locale);
  const [pending, startTransition] = useTransition();
  const [leaveTypeId, setLeaveTypeId] = useState<string>(leaveTypes[0]?.id ?? '');
  const [unit, setUnit] = useState<LeaveUnit>('FullDay');
  const [startTime, setStartTime] = useState<string>('13:00');
  const [endTime, setEndTime] = useState<string>('15:00');
  const [startDate, setStartDate] = useState<string>(defaultDate);
  const [endDate, setEndDate] = useState<string>(defaultDate);
  const [reason, setReason] = useState<string>('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleAttachmentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    setAttachmentFile(file);
    setAttachmentPreviewUrl(URL.createObjectURL(file));
  }

  function clearAttachment() {
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    setAttachmentFile(null);
    setAttachmentPreviewUrl(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  }

  const selectedType = leaveTypes.find((tp) => tp.id === leaveTypeId);

  // Units the selected type permits — the picker only offers these. Memoized
  // so it's a stable dependency for the reset effect below.
  const allowedUnits = useMemo<{ value: LeaveUnit; label: string }[]>(() => {
    const units: { value: LeaveUnit; label: string }[] = [];
    if (selectedType?.allowFullDay) units.push({ value: 'FullDay', label: t('new.unit.FullDay') });
    if (selectedType?.allowHalfDay) {
      units.push({ value: 'HalfMorning', label: t('new.unit.HalfMorning') });
      units.push({ value: 'HalfAfternoon', label: t('new.unit.HalfAfternoon') });
    }
    if (selectedType?.allowHourly) units.push({ value: 'Hourly', label: t('new.unit.Hourly') });
    return units;
  }, [selectedType, t]);

  // Snap `unit` to the first allowed unit whenever the selected type changes,
  // so the picker never shows a disallowed unit.
  useEffect(() => {
    const first = allowedUnits[0];
    if (first && !allowedUnits.some((u) => u.value === unit)) {
      setUnit(first.value);
    }
  }, [allowedUnits, unit]);

  // Client preview of the charged amount, shown as days+hours. For full-day
  // leave this is working-days × standard day (Sundays excluded; the server
  // re-computes holidays at approval). For partial leave it's the segment.
  const chargePreview = useMemo(() => {
    if (unit === 'FullDay') {
      const s = parseInputDate(startDate);
      const e = parseInputDate(endDate);
      if (!s || !e || e.getTime() < s.getTime()) return null;
      const days = workingDaysIn({ startDate: s, endDate: e, holidays: [] }).length;
      return days * standardDayMinutes(leaveConfig);
    }
    const seg = segmentFor(unit, leaveConfig, startTime, endTime);
    return seg ? seg.minutes : null;
  }, [unit, startDate, endDate, startTime, endTime, leaveConfig]);

  // Remaining balance for the selected type this year (null = unlimited).
  // Soft-warn only — never blocks submission (admin decides at approval).
  const remaining = remainingByType[leaveTypeId] ?? null;
  const exceeds = remaining != null && chargePreview != null && chargePreview > remaining;
  const overMinutes =
    remaining != null && chargePreview != null
      ? Math.max(0, chargePreview - Math.max(0, remaining))
      : 0;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        let attachmentKey: string | undefined;

        // Upload BEFORE creating the leave row. Failing the upload
        // should not produce a half-attached LeaveRequest — same
        // coupling principle as the advance receipt flow (A2).
        if (attachmentFile) {
          const supabase = createClient();
          const { data: authData } = await supabase.auth.getUser();
          if (!authData.user) {
            setError(t('new.error.sessionExpired'));
            return;
          }
          const compressed = await compressToJpeg(attachmentFile);
          const uploaded = await uploadLeaveMedicalCert(supabase, compressed, authData.user.id);
          attachmentKey = uploaded.key;
        }

        const result = await submitLeaveRequest({
          leaveTypeId,
          startDate,
          endDate: unit === 'FullDay' ? endDate : startDate,
          reason,
          attachmentKey,
          unit,
          startTime: unit === 'Hourly' ? startTime : null,
          endTime: unit === 'Hourly' ? endTime : null,
        });
        if (result.ok) {
          router.push(`/liff/leave/${result.id}`);
        } else {
          setError(result.message);
        }
      } catch (err) {
        const message =
          typeof err === 'object' && err !== null && 'kind' in err
            ? attachErrMessage(err as { kind: string; message?: string }, t)
            : err instanceof Error
              ? err.message
              : t('new.error.generic');
        setError(message);
      }
    });
  }

  const submitDisabled =
    pending ||
    !leaveTypeId ||
    !startDate ||
    (unit === 'FullDay' && !endDate) ||
    reason.trim().length < 4 ||
    chargePreview == null ||
    chargePreview === 0;

  return (
    <main className="mx-auto max-w-md px-4 pt-8 pb-12">
      <h1 className="text-2xl font-semibold text-gray-900">{t('new.title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('new.subtitle')}</p>

      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {/* Leave type */}
        <div>
          <label htmlFor="leaveTypeId" className="mb-1.5 block text-sm font-medium text-gray-700">
            {t('new.field.leaveType')} <span className="text-red-600">*</span>
          </label>
          <select
            id="leaveTypeId"
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {leaveTypes.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
                {tp.isPaid ? '' : ` ${t('new.unpaid')}`}
                {tp.annualQuota != null ? t('new.quotaSuffix', { n: tp.annualQuota }) : ''}
              </option>
            ))}
          </select>
          {selectedType && !selectedType.isPaid && (
            <p className="mt-1 text-xs text-amber-700">{t('new.unpaidNote')}</p>
          )}
        </div>

        {/* Unit (granularity) — only offered when the type allows >1 option */}
        {allowedUnits.length > 1 && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              {t('new.field.unit')}
            </span>
            <div className="flex flex-wrap gap-2">
              {allowedUnits.map((u) => (
                <button
                  key={u.value}
                  type="button"
                  onClick={() => setUnit(u.value)}
                  className={
                    unit === u.value
                      ? 'rounded-md border border-primary-600 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700'
                      : 'rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700'
                  }
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dates — full day uses a start/end range; partial uses a single date */}
        {unit === 'FullDay' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="startDate" className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('new.field.startDate')} <span className="text-red-600">*</span>
              </label>
              <input
                id="startDate"
                type="date"
                required
                min={minDate}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  // Auto-bump end if it's now < start.
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label htmlFor="endDate" className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('new.field.endDate')} <span className="text-red-600">*</span>
              </label>
              <input
                id="endDate"
                type="date"
                required
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="startDate" className="mb-1.5 block text-sm font-medium text-gray-700">
              {t('new.field.date')} <span className="text-red-600">*</span>
            </label>
            <input
              id="startDate"
              type="date"
              required
              min={minDate}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        )}

        {/* Hourly time window */}
        {unit === 'Hourly' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="startTime" className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('new.field.startTime')} <span className="text-red-600">*</span>
              </label>
              <input
                id="startTime"
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <div>
              <label htmlFor="endTime" className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('new.field.endTime')} <span className="text-red-600">*</span>
              </label>
              <input
                id="endTime"
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>
        )}

        {/* Charged-amount preview (days + hours) */}
        {chargePreview != null && (
          <p className="rounded-md bg-primary-50 px-3 py-2 text-xs text-primary-800">
            {t('new.preview')} <strong>{fmtDuration(chargePreview)}</strong>
            {unit === 'FullDay' && (
              <>
                {' '}
                <span className="text-primary-600">{t('new.previewNoSunday')}</span>
                <span className="block text-[10px] text-primary-600/80">
                  {t('new.previewAdminNote')}
                </span>
              </>
            )}
          </p>
        )}

        {/* Remaining balance + over-balance soft-warn */}
        {remaining != null && (
          <p className="text-xs text-gray-500">
            {t('new.remaining')} <strong>{fmtDuration(remaining)}</strong>
          </p>
        )}
        {exceeds && selectedType && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {selectedType.overQuotaPolicy === 'Block'
              ? t('new.exceedsBlock')
              : t('new.exceedsDeduct', {
                  over: fmtDuration(overMinutes),
                  amount: fmtMoney(overMinutes * ratePerMinute),
                })}
          </p>
        )}

        {/* Reason */}
        <div>
          <label htmlFor="reason" className="mb-1.5 block text-sm font-medium text-gray-700">
            {t('new.field.reason')} <span className="text-red-600">*</span>
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            minLength={4}
            maxLength={500}
            required
            placeholder={t('new.reasonPlaceholder')}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <p className="mt-1 text-right text-[10px] text-gray-400">{reason.length}/500</p>
        </div>

        {/* Optional attachment — typically a medical certificate */}
        <div>
          <label htmlFor="attachment" className="mb-1.5 block text-sm font-medium text-gray-700">
            {t('new.field.attachment')}{' '}
            <span className="text-gray-400">{t('new.attachmentHint')}</span>
          </label>

          {!attachmentPreviewUrl ? (
            <label
              htmlFor="attachment"
              className="flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500 hover:border-primary-300 hover:bg-primary-50/30"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="h-8 w-8 text-gray-400"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
              <span className="mt-2 font-medium text-gray-700">{t('new.attachmentDropLabel')}</span>
              <span className="text-xs">{t('new.attachmentFormats')}</span>
            </label>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
              {/* biome-ignore lint/performance/noImgElement: object-URL preview can't use next/image */}
              <img
                src={attachmentPreviewUrl}
                alt={t('new.attachmentPreviewAlt')}
                className="h-20 w-20 rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-gray-900">{attachmentFile?.name}</p>
                <p className="mt-0.5 text-[10px] text-gray-500">
                  {attachmentFile
                    ? t('new.attachmentSizeHint', { kb: Math.round(attachmentFile.size / 1024) })
                    : ''}
                </p>
                <button
                  type="button"
                  onClick={clearAttachment}
                  disabled={pending}
                  className="mt-1 text-[11px] text-red-600 hover:text-red-700"
                >
                  {t('new.removeAttachment')}
                </button>
              </div>
            </div>
          )}

          <input
            ref={attachmentInputRef}
            id="attachment"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleAttachmentChange}
            className="sr-only"
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            disabled={pending}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            {t('new.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitDisabled}
            className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending
              ? attachmentFile
                ? t('new.uploading')
                : t('new.submitting')
              : t('new.submit')}
          </button>
        </div>
      </form>
    </main>
  );
}

function attachErrMessage(
  e: { kind: string; message?: string },
  t: ReturnType<typeof useTranslations<'leave'>>,
): string {
  switch (e.kind) {
    case 'decode-failed':
      return t('new.error.decodeFailed');
    case 'upload-failed':
      return t('new.error.uploadFailed', { message: e.message ?? '' });
    case 'too-large-after-compress':
      return t('new.error.tooLarge');
    default:
      return t('new.error.generic');
  }
}
