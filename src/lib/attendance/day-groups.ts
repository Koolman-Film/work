/**
 * Collapse a flat attendance row list into one group per (employee, date).
 *
 * The admin records table shows a check-in and its `Late` row as separate
 * lines, so an admin reads the same day twice. This groups them for DISPLAY
 * only — `CheckIn` and `Late` remain separate rows in the database, enforced by
 * a partial unique index on (employeeId, date, type). Merging them in storage
 * would break `payroll/calc.ts`, which counts ROWS to build `absentCount` and
 * `lateRows`, plus the three-strike engine and every historical row.
 *
 * Insertion order is preserved for both groups and their members: the page
 * orders by date desc, and the grouped view must not silently re-sort into an
 * order the active filters do not imply. Members of a group are NOT assumed
 * adjacent — rows arrive ordered by date, so two employees on the same day
 * interleave.
 *
 * Generic over the row shape so it composes with buildAttendanceRowVM rather
 * than duplicating any of it.
 */
export type GroupableRow = { employeeId: string; date: Date };

export type DayGroup<T> = {
  /** `${employeeId}|${ymd}` — stable React key. */
  key: string;
  employeeId: string;
  /** UTC date of the group, YYYY-MM-DD. */
  ymd: string;
  rows: T[];
};

export function groupByEmployeeDay<T extends GroupableRow>(rows: readonly T[]): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  const index = new Map<string, DayGroup<T>>();
  for (const r of rows) {
    const ymd = r.date.toISOString().slice(0, 10);
    const key = `${r.employeeId}|${ymd}`;
    const existing = index.get(key);
    if (existing) {
      existing.rows.push(r);
      continue;
    }
    const group: DayGroup<T> = { key, employeeId: r.employeeId, ymd, rows: [r] };
    index.set(key, group);
    out.push(group);
  }
  return out;
}
