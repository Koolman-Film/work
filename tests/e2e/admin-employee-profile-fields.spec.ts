import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId } from './helpers/db';

/**
 * Employee profile fields (date of birth + bank account) across the
 * add → edit → clear lifecycle. Cleanup sweeps e2e- employees via the
 * shared helper (matches firstName/lastName startsWith 'e2e-').
 */

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
    await page.getByLabel('วันเกิด').fill('2000-05-20');
    await page.getByLabel('ธนาคาร').selectOption({ index: 1 }); // first bank (KBANK)
    await page.getByLabel('เลขที่บัญชี').fill('123-4-56789-0');
    await page.getByLabel('ชื่อบัญชี').fill('e2e Account Holder');
    await page.getByRole('button', { name: 'สร้างพนักงาน' }).click();

    // createEmployee redirects to the edit page on success.
    await page.waitForURL(/\/admin\/employees\/[^/]+\/edit/);

    // Values persisted + reflected on the edit form.
    await expect(page.getByLabel('วันเกิด')).toHaveValue('2000-05-20');
    await expect(page.getByLabel('เลขที่บัญชี')).toHaveValue('1234567890'); // normalized
    await expect(page.getByLabel('ชื่อบัญชี')).toHaveValue('e2e Account Holder');
    expect(await page.getByLabel('ธนาคาร').inputValue()).not.toBe('');

    // ── Edit (change bank + account) ────────────────────────────────
    await page.getByLabel('ธนาคาร').selectOption({ index: 2 }); // second bank
    await page.getByLabel('เลขที่บัญชี').fill('9876543210');
    await page.getByRole('button', { name: 'บันทึก' }).click();
    await page.waitForURL(/\/edit\?ok=1/);
    await expect(page.getByLabel('เลขที่บัญชี')).toHaveValue('9876543210');

    // ── Clear all three ─────────────────────────────────────────────
    await page.getByLabel('วันเกิด').fill('');
    await page.getByLabel('ธนาคาร').selectOption({ value: '' }); // — ไม่ระบุ —
    await page.getByLabel('เลขที่บัญชี').fill('');
    await page.getByLabel('ชื่อบัญชี').fill('');
    await page.getByRole('button', { name: 'บันทึก' }).click();
    await page.waitForURL(/\/edit\?ok=1/);

    await expect(page.getByLabel('วันเกิด')).toHaveValue('');
    await expect(page.getByLabel('เลขที่บัญชี')).toHaveValue('');
    await expect(page.getByLabel('ชื่อบัญชี')).toHaveValue('');
    expect(await page.getByLabel('ธนาคาร').inputValue()).toBe('');
  });
});
