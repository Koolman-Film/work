import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { clearDate, dateValue, isoMonthsAhead, pickDate } from './helpers/date-field';
import { cleanupE2eRecords, e2eId } from './helpers/db';

/**
 * Employee profile fields (date of birth + bank account) across the
 * add → edit → clear lifecycle. Cleanup sweeps e2e- employees via the
 * shared helper (matches firstName/lastName startsWith 'e2e-').
 *
 * วันเกิด is a <DateField>, not a date input — it is driven through the
 * popover and asserted on the hidden input it submits. See helpers/date-field.
 */

// Two months back, so the picker reaches it in a couple of clicks. The exact
// date is irrelevant to what this test proves; only that it round-trips.
const DOB = isoMonthsAhead(-2, 12);

test.describe('Employee profile fields', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  test('admin can add, edit, and clear dob + bank account', async ({ page }) => {
    const suffix = e2eId();
    const firstName = `e2e-Emp-${suffix}`;

    await loginAsAdmin(page);

    // ── Create ──────────────────────────────────────────────────────
    await page.goto('/admin/employees/new');
    await page.getByLabel('ชื่อจริง').fill(firstName);
    await page.getByLabel('นามสกุล').fill('e2e-Last');
    await page.getByLabel('สาขาหลัก').selectOption({ index: 1 }); // first real branch
    await page.getByLabel('ฐานเงินเดือน (บาท)').fill('25000');
    // Required on create. Omitting it made the browser block submit with no
    // visible error, so the form simply sat there and waitForURL timed out.
    await page.getByLabel('ตารางงาน').selectOption({ index: 1 });
    await pickDate(page, page.getByLabel('วันเกิด'), DOB);
    await page.getByLabel('ธนาคาร').selectOption({ index: 1 }); // first bank (KBANK)
    await page.getByLabel('เลขที่บัญชี').fill('123-4-56789-0');
    await page.getByLabel('ชื่อบัญชี').fill('e2e Account Holder');
    await page.getByRole('button', { name: 'สร้างพนักงาน' }).click();

    // createEmployee redirects to the edit page on success.
    await page.waitForURL(/\/admin\/employees\/[^/]+\/edit/);

    // Values persisted + reflected on the edit form.
    await expect(dateValue(page, 'dateOfBirth')).toHaveValue(DOB);
    await expect(page.getByLabel('เลขที่บัญชี')).toHaveValue('1234567890'); // normalized
    await expect(page.getByLabel('ชื่อบัญชี')).toHaveValue('e2e Account Holder');
    expect(await page.getByLabel('ธนาคาร').inputValue()).not.toBe('');

    // ── Edit (change bank + account) ────────────────────────────────
    await page.getByLabel('ธนาคาร').selectOption({ index: 2 }); // second bank
    await page.getByLabel('เลขที่บัญชี').fill('9876543210');
    await page.locator('button[form="employee-form"]', { hasText: 'บันทึก' }).click();
    await page.waitForURL(/\/edit\?ok=1/);
    await expect(page.getByLabel('เลขที่บัญชี')).toHaveValue('9876543210');

    // ── Clear all three ─────────────────────────────────────────────
    await clearDate(page, page.getByLabel('วันเกิด'));
    await page.getByLabel('ธนาคาร').selectOption({ value: '' }); // — ไม่ระบุ —
    await page.getByLabel('เลขที่บัญชี').fill('');
    await page.getByLabel('ชื่อบัญชี').fill('');
    await page.locator('button[form="employee-form"]', { hasText: 'บันทึก' }).click();
    await page.waitForURL(/\/edit\?ok=1/);

    await expect(dateValue(page, 'dateOfBirth')).toHaveValue('');
    await expect(page.getByLabel('เลขที่บัญชี')).toHaveValue('');
    await expect(page.getByLabel('ชื่อบัญชี')).toHaveValue('');
    expect(await page.getByLabel('ธนาคาร').inputValue()).toBe('');
  });
});
