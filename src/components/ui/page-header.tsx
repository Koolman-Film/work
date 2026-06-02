import type { ReactNode } from 'react';

/**
 * Unified page header (Sapphire Editorial): breadcrumb ("Workspace › section")
 * + title + optional subtitle, with a right-aligned actions slot. Every admin
 * page renders exactly one of these — it owns the breadcrumb (the Topbar no
 * longer renders one). Responsive: title scales, actions wrap, breadcrumb stays
 * compact on small screens.
 */
export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  actions,
}: {
  /** Section label; renders "Workspace › {breadcrumb}". */
  breadcrumb?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-7 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && (
          <nav
            className="mb-2 flex items-center gap-1.5 text-xs text-ink-3"
            aria-label="breadcrumb"
          >
            <span className="font-display">Workspace</span>
            <span className="text-ink-5">›</span>
            <span className="font-medium text-ink-2">{breadcrumb}</span>
          </nav>
        )}
        <h1 className="h-page text-2xl text-ink-1 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
