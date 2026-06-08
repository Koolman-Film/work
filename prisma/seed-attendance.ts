/**
 * Dev-only sample attendance for local QA of the redesigned attendance pages
 * (records list, live board, disputed inbox).
 *
 * Gives the two seeded branches geofence coords, then creates today's check-in
 * board across them — most Confirmed (within geofence), a couple checked-out,
 * one late-ish, two Disputed (GPS outside the radius), and leaves two employees
 * with no row (so the live "ยังไม่มา" count is real) — plus a few earlier-in-June
 * rows for the records list. Idempotent on (employee, date, CheckIn).
 *
 * Run:  npm run db:seed:attendance   (uses .env.local — LOCAL dev only!)
 */

// biome-ignore-all lint/suspicious/noConsole: seed scripts are CLI tools — console is the output channel

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function assertLocalDb() {
  const url = process.env.DATABASE_URL ?? '';
  const isLocal =
    /(127\.0\.0\.1|localhost|@127|:54422)/.test(url) &&
    !/supabase\.co|bltjmjfznbxkgrrdbzci/.test(url);
  if (!isLocal) {
    throw new Error(
      `Refusing to seed: DATABASE_URL does not look local (${url.replace(/:[^:@/]+@/, ':***@')})`,
    );
  }
}

/** Bangkok "today" as a date-only Date (UTC midnight of the BKK calendar day). */
function bangkokToday(): Date {
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
function at(date: Date, hhmm: string): Date {
  return new Date(`${ymd(date)}T${hhmm}:00+07:00`);
}

const BRANCH_COORDS: Record<string, { latitude: number; longitude: number; radiusMeters: number }> =
  {
    สำนักงานใหญ่: { latitude: 13.7563, longitude: 100.5018, radiusMeters: 150 },
    'สาขา 2': { latitude: 13.746, longitude: 100.534, radiusMeters: 150 },
  };

async function main() {
  assertLocalDb();

  // 1. Geofence coords for the two seeded branches (idempotent).
  for (const [name, c] of Object.entries(BRANCH_COORDS)) {
    await prisma.branch.updateMany({ where: { name }, data: c });
  }
  const branches = await prisma.branch.findMany({
    select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true },
  });
  const branchById = new Map(branches.map((b) => [b.id, b]));

  const employees = await prisma.employee.findMany({
    orderBy: { firstName: 'asc' },
    select: { id: true, userId: true, firstName: true, lastName: true, branchId: true },
  });
  if (employees.length === 0) {
    throw new Error('No employees — run `npm run db:seed:employees` first.');
  }

  const today = bangkokToday();

  async function ensureCheckIn(opts: {
    employee: (typeof employees)[number];
    date: Date;
    clockInAt: Date;
    clockOutAt?: Date;
    status: 'Confirmed' | 'Disputed';
    /** GPS offset north of the branch, in metres (drives the computed distance). */
    offsetMeters: number;
    disputeReason?: string;
  }): Promise<'created' | 'skipped'> {
    const { employee, date } = opts;
    const existing = await prisma.attendance.findFirst({
      where: { employeeId: employee.id, date, type: 'CheckIn' },
      select: { id: true },
    });
    if (existing) return 'skipped';

    const branch = branchById.get(employee.branchId);
    // GPS = branch coords offset north by offsetMeters (1° lat ≈ 111,320 m).
    const lat =
      branch?.latitude != null ? Number(branch.latitude) + opts.offsetMeters / 111_320 : null;
    const lng = branch?.longitude != null ? Number(branch.longitude) : null;

    await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date,
        type: 'CheckIn',
        source: 'Liff',
        clockInAt: opts.clockInAt,
        clockOutAt: opts.clockOutAt ?? null,
        checkInLat: lat,
        checkInLng: lng,
        checkInBranchId: employee.branchId,
        checkInStatus: opts.status,
        disputeReason: opts.disputeReason ?? null,
        createdById: employee.userId,
        createdAt: opts.clockInAt,
      },
    });
    return 'created';
  }

  let created = 0;
  let skipped = 0;
  const bump = (r: 'created' | 'skipped') => {
    if (r === 'created') created++;
    else skipped++;
  };

  // ── Today's board ── indices 0–7 present, 8+ absent ("ยังไม่มา").
  //   2,3 checked out · 4 late-ish · 5,6 disputed (outside geofence).
  const present = Math.min(8, employees.length);
  for (let i = 0; i < present; i++) {
    const e = employees[i];
    if (!e) continue;
    if (i === 5 || i === 6) {
      bump(
        await ensureCheckIn({
          employee: e,
          date: today,
          clockInAt: at(today, i === 5 ? '08:33' : '08:55'),
          status: 'Disputed',
          offsetMeters: 240,
          disputeReason: 'อยู่นอกรัศมี geofence (≈240 ม. เกิน 150 ม.)',
        }),
      );
    } else if (i === 2 || i === 3) {
      bump(
        await ensureCheckIn({
          employee: e,
          date: today,
          clockInAt: at(today, '08:30'),
          clockOutAt: at(today, '17:10'),
          status: 'Confirmed',
          offsetMeters: 20,
        }),
      );
    } else if (i === 4) {
      bump(
        await ensureCheckIn({
          employee: e,
          date: today,
          clockInAt: at(today, '09:18'),
          status: 'Confirmed',
          offsetMeters: 25,
        }),
      );
    } else {
      bump(
        await ensureCheckIn({
          employee: e,
          date: today,
          clockInAt: at(today, `08:${String(40 + i).padStart(2, '0')}`),
          status: 'Confirmed',
          offsetMeters: 18,
        }),
      );
    }
  }

  // ── History (records list): employees 0–3 on the previous few days. ──
  for (const back of [1, 2, 3]) {
    const d = addDays(today, -back);
    for (let i = 0; i < Math.min(4, employees.length); i++) {
      const e = employees[i];
      if (!e) continue;
      bump(
        await ensureCheckIn({
          employee: e,
          date: d,
          clockInAt: at(d, '08:35'),
          clockOutAt: at(d, '17:05'),
          status: 'Confirmed',
          offsetMeters: 15,
        }),
      );
    }
  }

  const byStatus = await prisma.attendance.groupBy({
    by: ['checkInStatus'],
    _count: { _all: true },
  });
  const disputed = await prisma.attendance.count({
    where: { type: 'CheckIn', checkInStatus: 'Disputed', deletedAt: null },
  });
  console.log(`Attendance: created ${created}, skipped ${skipped} (already present).`);
  console.log(
    '  by checkInStatus:',
    byStatus.map((g) => `${g.checkInStatus ?? 'null'}=${g._count._all}`).join(', '),
  );
  console.log(`  disputed pending today: ${disputed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
