'use client';

/**
 * LineConnectPanel — the single entry point for connecting an admin's LINE.
 *
 * Two audiences, one page:
 *   - "ผู้ดูแลอย่างเดียว"  → self-pairing (LinePairingCard): bind a fresh LINE
 *     to this admin account.
 *   - "ฉันเป็นพนักงานด้วย" → the merge wizard (MergePromptCard): the admin's
 *     LINE is already an employee, so we unify the two onto one account.
 *
 * The chooser exists because the two flows look identical to the user but are
 * mutually exclusive — self-pairing a LINE that's already an employee fails
 * (line-account-in-use), and that's exactly who needs the merge instead.
 */

import { useState } from 'react';
import { MergePromptCard } from '@/app/(admin)/admin/_components/merge-prompt-card';
import { cn } from '@/lib/utils';
import { LinePairingCard } from './line-pairing-card';

function ChoiceButton({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex-1 rounded-xl border px-4 py-3 text-left transition',
        active
          ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-300'
          : 'border-gray-200 bg-white hover:border-primary-200 hover:bg-primary-50/40',
      )}
    >
      <span className="block text-sm font-semibold text-gray-900">{title}</span>
      <span className="mt-0.5 block text-xs text-gray-500">{hint}</span>
    </button>
  );
}

export function LineConnectPanel({ paired, canMerge }: { paired: boolean; canMerge: boolean }) {
  const [choice, setChoice] = useState<'admin' | 'employee' | null>(null);

  // Already bound → nothing to choose; show the pairing/unpair card directly.
  if (paired) return <LinePairingCard paired />;

  // No employee half to merge with → self-pairing is the only path.
  if (!canMerge) return <LinePairingCard paired={false} />;

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-gray-700">คุณเป็นพนักงานในระบบด้วยหรือไม่?</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <ChoiceButton
            active={choice === 'admin'}
            onClick={() => setChoice('admin')}
            title="ผู้ดูแลอย่างเดียว"
            hint="ยังไม่มีบัญชีพนักงานในระบบ — เชื่อม LINE กับบัญชีผู้ดูแลนี้"
          />
          <ChoiceButton
            active={choice === 'employee'}
            onClick={() => setChoice('employee')}
            title="ฉันเป็นพนักงานด้วย"
            hint="มีบัญชีพนักงานอยู่แล้ว — รวมบัญชีเพื่อใช้ LINE เดียวทั้งสองเมนู"
          />
        </div>
      </div>

      {choice === 'admin' && <LinePairingCard paired={false} />}
      {choice === 'employee' && <MergePromptCard dismissible={false} />}
    </div>
  );
}
