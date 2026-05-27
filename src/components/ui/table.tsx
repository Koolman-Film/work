import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('min-w-full divide-y divide-gray-200', className)} {...rest} />
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-gray-50', className)} {...rest} />;
}

export function TBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-gray-100 bg-white', className)} {...rest} />;
}

export function TR({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('hover:bg-gray-50', className)} {...rest} />;
}

export function TH({ className, scope = 'col', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cn(
        'px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500',
        className,
      )}
      {...rest}
    />
  );
}

export function TD({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 text-sm text-gray-700', className)} {...rest} />;
}
