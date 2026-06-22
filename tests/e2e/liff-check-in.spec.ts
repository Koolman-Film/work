import { expect, test } from '@playwright/test';
import { loginAsWorker } from './helpers/auth';
import { cleanupE2eRecords, createE2eWorker, type E2eWorker, prisma } from './helpers/db';

/**
 * LIFF worker check-in — the most-used employee flow, and the one neither unit
 * nor integration tests can reach (it's gated by requireRole(['Staff']) and
 * driven by the browser's geolocation API).
 *
 * Strategy (see tests/e2e/README.md + TESTING.md):
 *   - Seed a Staff worker + geofenced branch via Prisma + Supabase Admin API.
 *   - Establish a real Supabase session via the test-only /api/test/session
 *     route (no LINE OIDC needed — the check-in page only wants the cookie).
 *   - Mock GPS with Playwright's context geolocation: inside the fence →
 *     Confirmed, far away → Disputed.
 *
 * Deferred: the selfie-required path (camera capture + Storage upload) — the
 * seeded branch sets requireSelfie=false. That's a separate, heavier spec.
 */

// Fixed branch centre (central Bangkok). createE2eWorker geofences the branch
// here with a 150 m radius and requireGps=true.
const BRANCH = { lat: 13.7563, lng: 100.5018 };
// ~11 km away — comfortably outside any sane radius.
const FAR = { lat: 13.85, lng: 100.6 };

/** Today's Bangkok calendar day as a @db.Date UTC-midnight (matches the app). */
function bangkokTodayUtcMidnight(): Date {
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

test.describe('LIFF worker check-in', () => {
  let worker: E2eWorker;

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    worker = await createE2eWorker({ lat: BRANCH.lat, lng: BRANCH.lng, radiusMeters: 150 });
    await loginAsWorker(page, { email: worker.email, password: worker.password });
  });

  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  test('records a Confirmed check-in when inside the geofence', async ({ page, context }) => {
    await context.setGeolocation({ latitude: BRANCH.lat, longitude: BRANCH.lng, accuracy: 10 });
    await page.goto('/liff/check-in');

    await page.getByRole('button', { name: 'เช็คอินเข้างาน' }).click();

    // UI settles into the terminal "done" card (branch requireCheckOut=false).
    await expect(page.getByText('เสร็จสิ้นวันนี้แล้ว')).toBeVisible();

    const row = await prisma.attendance.findFirst({
      where: { employeeId: worker.employeeId, type: 'CheckIn' },
    });
    expect(row).not.toBeNull();
    expect(row?.checkInStatus).toBe('Confirmed');
    expect(row?.checkInBranchId).toBe(worker.branchId);
    expect(row?.disputeReason).toBeNull();
  });

  test('records a Disputed check-in when outside the geofence', async ({ page, context }) => {
    await context.setGeolocation({ latitude: FAR.lat, longitude: FAR.lng, accuracy: 10 });
    await page.goto('/liff/check-in');

    await page.getByRole('button', { name: 'เช็คอินเข้างาน' }).click();

    // The status card flags the check-in for review with the "ตรวจสอบ" badge.
    // exact:true so we hit the badge, not the longer success message that also
    // contains the word ("เช็คอินบันทึกแล้ว แต่ต้องตรวจสอบ: ...").
    await expect(page.getByText('ตรวจสอบ', { exact: true })).toBeVisible();

    const row = await prisma.attendance.findFirst({
      where: { employeeId: worker.employeeId, type: 'CheckIn' },
    });
    expect(row?.checkInStatus).toBe('Disputed');
    // "อยู่นอกพื้นที่สาขา (geofence)" — out-of-range reason from evaluate.ts.
    expect(row?.disputeReason).toContain('geofence');
  });

  test('shows the done state (no check-in button) when already checked in today', async ({
    page,
    context,
  }) => {
    await context.setGeolocation({ latitude: BRANCH.lat, longitude: BRANCH.lng, accuracy: 10 });
    // Pre-seed today's CheckIn row, simulating an earlier check-in.
    await prisma.attendance.create({
      data: {
        employeeId: worker.employeeId,
        date: bangkokTodayUtcMidnight(),
        type: 'CheckIn',
        source: 'Liff',
        clockInAt: new Date(),
        checkInStatus: 'Confirmed',
        checkInBranchId: worker.branchId,
        createdById: worker.authUserId,
      },
    });

    await page.goto('/liff/check-in');

    await expect(page.getByText('เสร็จสิ้นวันนี้แล้ว')).toBeVisible();
    // The primary check-in button must be gone — the server already saw a row.
    await expect(page.getByRole('button', { name: 'เช็คอินเข้างาน' })).toHaveCount(0);
  });
});
