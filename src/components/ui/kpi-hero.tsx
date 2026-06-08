import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Dashboard hero (Sapphire gradient). Leads with two equal figures —
 * checked-in (white) and not-checked-in (amber, the action-needed number) —
 * with the expected total, a progress bar, and late/leave sub-stats.
 *
 * Each figure can optionally be a link (`checkedInHref` / `notCheckedInHref`):
 * when set, the number+label column becomes a clickable `<Link>` with a hover
 * affordance. When omitted it renders as a plain figure (unchanged).
 */
export function KpiHero({
  checkedIn,
  notCheckedIn,
  total,
  late,
  leave,
  percent,
  checkedInHref,
  notCheckedInHref,
}: {
  checkedIn: number;
  notCheckedIn: number;
  total: number;
  late?: number;
  leave?: number;
  /** Override the bar %; defaults to checkedIn/total. */
  percent?: number;
  checkedInHref?: string;
  notCheckedInHref?: string;
}) {
  const pct = percent ?? (total > 0 ? Math.round((checkedIn / total) * 100) : 0);
  return (
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-2xl p-5 text-white shadow-hero"
      style={{
        background: 'linear-gradient(135deg, var(--color-primary-700), var(--color-primary-900))',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="font-display text-[11.5px] font-semibold uppercase tracking-wider opacity-70">
          การเข้างานวันนี้
        </div>
        <div className="text-right leading-tight">
          <div className="text-[13px] font-semibold tabular opacity-85">{total}</div>
          <div className="text-[10px] opacity-55">ที่ต้องเข้า</div>
        </div>
      </div>

      <div className="mt-2 flex items-end gap-5">
        <Figure href={checkedInHref} ariaLabel="ดูรายชื่อผู้ที่เข้างานแล้ว">
          <div className="font-display text-[52px] font-black leading-none tabular tracking-[-0.04em]">
            {checkedIn}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs opacity-85">
            <span className="size-2 rounded-full bg-[#6ee7b7]" />{' '}
            <span className="group-hover:underline">เข้างานแล้ว</span>
          </div>
        </Figure>
        <div className="mb-1.5 h-12 w-px bg-white/20" />
        <Figure href={notCheckedInHref} ariaLabel="ดูรายชื่อผู้ที่ยังไม่เข้า">
          <div className="font-display text-[52px] font-black leading-none tabular tracking-[-0.04em] text-[#fde68a]">
            {notCheckedIn}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs opacity-85">
            <span className="size-2 rounded-full bg-accent-400" />{' '}
            <span className="group-hover:underline">ยังไม่เข้า</span>
          </div>
        </Figure>
      </div>

      <div className="mt-auto pt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, var(--color-accent-400), #f59e0b)',
            }}
          />
        </div>
        <div className="mt-2.5 flex items-center gap-4 text-[11.5px] opacity-80">
          <span>เข้าแล้ว {pct}%</span>
          {late != null && <span>● สาย {late}</span>}
          {leave != null && <span>● ลา {leave}</span>}
        </div>
      </div>
    </div>
  );
}

/** A figure column: a hover-underlining `<Link>` when `href` is set, else a plain block. */
function Figure({
  href,
  ariaLabel,
  children,
}: {
  href?: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        className="group -m-1 rounded-lg p-1 transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        {children}
      </Link>
    );
  }
  return <div>{children}</div>;
}
