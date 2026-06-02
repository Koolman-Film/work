import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Initials avatar (Sapphire Editorial). `tone="amber"` is the Superadmin "สป"
 * treatment from the mockups; default brand for everyone else.
 */
const sizes = { sm: 'size-8 text-[11px]', md: 'size-9 text-xs' } as const;
const tones = {
  brand: 'border-primary-200 bg-primary-50 text-primary-700',
  amber: 'border-accent-400/40 bg-accent-400/20 text-accent-600',
} as const;

export function Avatar({
  name,
  tone = 'brand',
  size = 'md',
  className,
}: {
  name: string;
  tone?: keyof typeof tones;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full border font-display font-bold',
        sizes[size],
        tones[tone],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
