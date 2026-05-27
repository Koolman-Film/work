import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { prisma } from '@/lib/db/prisma';

/**
 * /admin/settings/holidays — list of company holidays.
 *
 * Sort: by date ascending (chronological from oldest to newest). When the
 * list grows beyond a year or two, we'll add year-tabs; for now flat is
 * fine — Thailand has ~16 official holidays per year, so a 2-year list
 * is ~32 rows, comfortably scannable.
 *
 * The "วัน" column shows day-of-week in Thai — useful for admins to
 * eyeball whether a holiday falls on a Sunday (already excluded by
 * workingDaysIn anyway, so listing it is mostly for clarity) or weekday.
 */

type SearchParams = Promise<{ error?: string }>;

const THAI_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;

function formatDate(d: Date): string {
  // Display in Thai locale with Buddhist year.
  return d.toLocaleDateString('th-TH', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function dayOfWeekTh(d: Date): string {
  const idx = d.getUTCDay();
  return THAI_DOW[idx] ?? '?';
}

export default async function HolidayListPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  // Only non-archived; chronological.
  const rows = await prisma.holiday.findMany({
    where: { archivedAt: null },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, name: true, isSubstitute: true },
  });

  // Group by Gregorian year for the table header, since holidays span
  // multiple years and grouping helps the eye.
  const byYear = new Map<number, typeof rows>();
  for (const r of rows) {
    const y = r.date.getUTCFullYear();
    const bucket = byYear.get(y) ?? [];
    bucket.push(r);
    byYear.set(y, bucket);
  }

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">วันหยุด</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            วันหยุดที่ไม่นับเป็นวันลา — ใช้กับการคำนวณวันทำงานในคำขอลา
          </p>
        </div>
        <Link href="/admin/settings/holidays/new">
          <Button>+ เพิ่มวันหยุด</Button>
        </Link>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            ทั้งหมด <span className="tabular-nums text-gray-500">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-500">ยังไม่มีวันหยุด</p>
              <p className="mt-1 text-xs text-gray-400">
                หากไม่ตั้งวันหยุดไว้ ระบบจะคิดวันลาโดยข้ามเฉพาะวันอาทิตย์
              </p>
              <Link href="/admin/settings/holidays/new" className="mt-3 inline-block">
                <Button variant="secondary">+ เพิ่มวันหยุดแรก</Button>
              </Link>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>วันที่</TH>
                  <TH>วัน</TH>
                  <TH>ชื่อวันหยุด</TH>
                  <TH>ประเภท</TH>
                  <TH className="text-right">การจัดการ</TH>
                </TR>
              </THead>
              <TBody>
                {Array.from(byYear.entries()).flatMap(([year, group]) => [
                  // Year separator row.
                  <TR key={`year-${year}`}>
                    <TD
                      className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500"
                      colSpan={5}
                    >
                      ปี {year + 543} (ค.ศ. {year})
                    </TD>
                  </TR>,
                  ...group.map((h) => (
                    <TR key={h.id}>
                      <TD className="font-mono text-gray-700">{formatDate(h.date)}</TD>
                      <TD className="text-gray-500">{dayOfWeekTh(h.date)}</TD>
                      <TD className="font-medium text-gray-900">{h.name}</TD>
                      <TD>
                        {h.isSubstitute ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            ชดเชย
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Link
                          href={`/admin/settings/holidays/${h.id}/edit`}
                          className="text-sm font-medium text-primary-600 hover:text-primary-700"
                        >
                          แก้ไข
                        </Link>
                      </TD>
                    </TR>
                  )),
                ])}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
