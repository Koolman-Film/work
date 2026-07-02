'use client';

/**
 * MergePromptCard — the admin→employee identity merge flow.
 *
 * Rendered inside the /admin/settings/line chooser (the "ฉันเป็นพนักงานด้วย"
 * branch), so it opens straight into the "pick yourself" step: choose your
 * employee from a searchable list → get a QR → scan it with that employee's
 * LINE to complete the merge (grants admin onto the employee account).
 */

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  listMergeableEmployees,
  type MergeableEmployee,
  startAdminMerge,
} from '@/lib/auth/start-admin-merge';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

function fullName(e: MergeableEmployee): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

/** Non-interactive avatar — the whole row is the click target. */
function RowAvatar({ name, src }: { name: string; src: string | null }) {
  return (
    <span className="inline-grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-gray-200 bg-primary-50 font-display text-xs font-bold text-primary-700">
      {src ? (
        // biome-ignore lint/performance/noImgElement: short-lived signed storage URL; next/image caching doesn't apply
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

const CARD = 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm';

export function MergePromptCard() {
  const t = useTranslations('mergeWizard');

  // Flat state: employees === null while loading; qr set once generated.
  const [employees, setEmployees] = useState<MergeableEmployee[] | null>(null);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [qr, setQr] = useState<{ url: string; qrDataUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Open straight into the picker — the chooser already declared intent.
  useEffect(() => {
    let cancelled = false;
    listMergeableEmployees()
      .then((list) => {
        if (cancelled) return;
        setEmployees(list);
        setSelected(list[0]?.userId ?? '');
      })
      .catch(() => {
        if (!cancelled) setError('โหลดรายชื่อพนักงานไม่สำเร็จ');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!employees) return [];
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      `${e.firstName} ${e.lastName} ${e.nickname ?? ''}`.toLowerCase().includes(q),
    );
  }, [employees, query]);

  function generateQr() {
    if (!selected) return;
    startTransition(async () => {
      const result = await startAdminMerge({ employeeUserId: selected });
      if (result.ok) {
        setError(null);
        setQr({ url: result.url, qrDataUrl: result.qrDataUrl });
      } else {
        setError(result.message);
      }
    });
  }

  // ── QR view ──────────────────────────────────────────────────────────────
  if (qr) {
    return (
      <div className={cn(CARD, 'flex flex-col items-center text-center')}>
        <p className="text-sm font-semibold text-gray-900">{t('scanHint')}</p>
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          {/* biome-ignore lint/performance/noImgElement: inline data: URL (QR), not a storage asset */}
          <img src={qr.qrDataUrl} alt="QR code" width={208} height={208} className="rounded-lg" />
        </div>
        <p className="mt-3 max-w-xs break-all text-xs text-ink-3">{qr.url}</p>
        <button
          type="button"
          onClick={() => setQr(null)}
          className="mt-4 text-sm font-medium text-primary-700 hover:text-primary-800"
        >
          ← เลือกพนักงานใหม่
        </button>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (employees === null) {
    return (
      <div className={CARD}>
        <div className="h-9 w-full animate-pulse rounded-md bg-gray-100" />
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="size-9 animate-pulse rounded-full bg-gray-100" />
              <div className="h-4 flex-1 animate-pulse rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (employees.length === 0) {
    return <div className={cn(CARD, 'text-center text-sm text-ink-3')}>{t('pickerEmpty')}</div>;
  }

  // ── Picker ───────────────────────────────────────────────────────────────
  return (
    <div className={CARD}>
      <label htmlFor="merge-search" className="block text-sm font-semibold text-gray-900">
        {t('pickerLabel')}
      </label>
      <input
        id="merge-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('pickerSearch')}
        autoComplete="off"
        className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
      />

      <ul className="mt-2 max-h-72 divide-y divide-gray-100 overflow-auto rounded-lg border border-gray-200">
        {filtered.map((emp) => {
          const name = fullName(emp);
          const isSelected = emp.userId === selected;
          return (
            <li key={emp.userId}>
              <button
                type="button"
                onClick={() => setSelected(emp.userId)}
                aria-pressed={isSelected}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left transition',
                  isSelected ? 'bg-primary-50' : 'hover:bg-gray-50',
                )}
              >
                <RowAvatar name={name} src={emp.photoUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{name}</span>
                  {emp.nickname && (
                    <span className="block truncate text-xs text-gray-500">{emp.nickname}</span>
                  )}
                </span>
                {isSelected && (
                  <span
                    aria-hidden="true"
                    className="grid size-5 shrink-0 place-items-center rounded-full bg-primary-600 text-[11px] font-bold text-white"
                  >
                    ✓
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-gray-400">ไม่พบรายการ</li>
        )}
      </ul>

      {error && <p className="mt-3 text-sm font-medium text-danger-deep">{error}</p>}

      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={generateQr} disabled={isPending || !selected}>
          {isPending ? t('working') : t('pickerCta')}
        </Button>
      </div>
    </div>
  );
}
