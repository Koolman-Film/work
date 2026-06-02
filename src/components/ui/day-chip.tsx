import { cn } from '@/lib/utils';

/**
 * Date tile for leave/attendance rows (the `.day` chip from the mockups):
 * a small rounded square with a big day number over a short Thai month.
 */
const tones = {
  brand: 'border-primary-100 bg-primary-50 text-primary-700',
  danger: 'border-red-200 bg-red-50 text-red-700',
} as const;

export function DayChip({
  day,
  month,
  tone = 'brand',
  className,
}: {
  day: string | number;
  month: string;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex w-10 shrink-0 flex-col items-center justify-center rounded-lg border py-1',
        tones[tone],
        className,
      )}
    >
      <span className="font-display text-sm font-bold leading-none">{day}</span>
      <span className="font-display text-[8px] font-semibold leading-tight">{month}</span>
    </span>
  );
}
