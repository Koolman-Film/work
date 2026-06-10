/**
 * Plain GET-form name search — server-compatible (no JS needed). Hidden
 * inputs carry the current period params so searching doesn't reset the
 * month/range, and the PeriodPicker's withParams preserves `q` in return.
 */
export function NameSearch({
  q,
  params,
}: {
  q?: string;
  params: { m?: string; from?: string; to?: string };
}) {
  return (
    <form method="GET" className="flex items-center gap-2">
      {params.m && <input type="hidden" name="m" value={params.m} />}
      {params.from && <input type="hidden" name="from" value={params.from} />}
      {params.to && <input type="hidden" name="to" value={params.to} />}
      <input
        type="search"
        name="q"
        defaultValue={q ?? ''}
        placeholder="ค้นหาชื่อพนักงาน…"
        className="w-44 rounded-md border border-gray-300 px-2 py-1.5 text-sm sm:w-56"
      />
      <button
        type="submit"
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        ค้นหา
      </button>
    </form>
  );
}
