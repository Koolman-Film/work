import { Download } from 'lucide-react';

/** PDF / Excel / CSV download links for a report page. Server component —
 *  plain <a> hrefs carrying the page's current period + search params. */
export function ExportButtons({
  report,
  params,
}: {
  report: 'attendance' | 'leave' | 'advance';
  params: {
    m?: string;
    from?: string;
    to?: string;
    q?: string;
    branchId?: string;
    departmentId?: string;
  };
}) {
  const base = new URLSearchParams();
  for (const k of ['m', 'from', 'to', 'q', 'branchId', 'departmentId'] as const) {
    const v = params[k];
    if (v) base.set(k, v);
  }
  const href = (format: string) => {
    const p = new URLSearchParams(base);
    p.set('format', format);
    return `/admin/reports/${report}/export?${p.toString()}`;
  };
  const linkClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-gray-700 hover:bg-surface-muted';
  return (
    <div className="flex items-center gap-2">
      <a href={href('pdf')} className={linkClass} download>
        <Download size={13} /> PDF
      </a>
      <a href={href('xlsx')} className={linkClass} download>
        <Download size={13} /> Excel
      </a>
      <a href={href('csv')} className={linkClass} download>
        <Download size={13} /> CSV
      </a>
    </div>
  );
}
