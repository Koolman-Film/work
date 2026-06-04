import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId } from './helpers/db';

/**
 * Full CRUD lifecycle for /admin/settings/departments.
 *
 * Exercises: list → new → fill → submit → list (now with new row) →
 * edit → submit → list (with edited name) → archive → list (gone).
 *
 * This is the canonical "smoke + happy path" for a settings CRUD; if it
 * passes, the Branch / AccountingGroup / LeaveType CRUDs almost
 * certainly work too (they share the same actions.ts shape).
 */

test.describe('Admin Department CRUD', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  test('admin can create, edit, then archive a Department', async ({ page }) => {
    const suffix = e2eId();
    const originalName = `e2e-Dept-${suffix}`;
    const editedName = `e2e-Dept-Edit-${suffix}`;

    await loginAsAdmin(page);

    // ── Create ──────────────────────────────────────────────────────
    await page.goto('/admin/settings/departments');
    await expect(page.getByRole('heading', { name: 'แผนก' })).toBeVisible();

    await page
      .getByRole('link', { name: /\+ เพิ่มแผนก/ })
      .first()
      .click();
    await page.waitForURL(/\/departments\/new/);

    await page.getByLabel('ชื่อแผนก').fill(originalName);
    await page.getByLabel('คำอธิบาย').fill('Created by Playwright e2e test');
    await page.getByRole('button', { name: 'สร้างแผนก' }).click();

    await page.waitForURL(/\/departments$/);
    await expect(page.getByText(originalName).first()).toBeVisible();

    // ── Edit ────────────────────────────────────────────────────────
    // Click the "แก้ไข" link in the row containing our new dept.
    const newRow = page.getByRole('row', { name: new RegExp(originalName) });
    await newRow.getByRole('link', { name: 'แก้ไข' }).click();
    await page.waitForURL(/\/departments\/[^/]+\/edit/);

    const nameField = page.getByLabel('ชื่อแผนก');
    await nameField.fill(editedName);
    await page.getByRole('button', { name: 'บันทึก' }).click();

    await page.waitForURL(/\/departments$/);
    await expect(page.getByText(editedName).first()).toBeVisible();
    await expect(page.getByText(originalName).first()).not.toBeVisible();

    // ── Archive ─────────────────────────────────────────────────────
    const editedRow = page.getByRole('row', { name: new RegExp(editedName) });
    await editedRow.getByRole('link', { name: 'แก้ไข' }).click();
    await page.waitForURL(/\/departments\/[^/]+\/edit/);

    // Wait for the Danger Zone block to render. Per the nested-forms-bug
    // fix, the archive form is a sibling of the update form (not nested),
    // styled as a "พื้นที่อันตราย" block below the main card.
    const archiveButton = page.getByRole('button', { name: 'ลบถาวร', exact: true });
    await expect(archiveButton).toBeVisible({ timeout: 5_000 });
    await archiveButton.click();
    // Archive is a Server Action with a redirect + revalidatePath, which
    // takes a moment to round-trip. 10s is generous.
    await page.waitForURL(/\/admin\/settings\/departments$/, { timeout: 10_000 });

    // The list should no longer show our department (archive hides
    // non-archived-only by default).
    await expect(page.getByText(editedName).first()).not.toBeVisible();
  });

  test('uniqueness constraint produces a Thai error message', async ({ page }) => {
    // Pre-condition: a department with our name already exists. We create
    // it via the API path (going through the UI) and then attempt to
    // create a duplicate.
    const name = `e2e-Dup-${e2eId()}`;

    await loginAsAdmin(page);
    await page.goto('/admin/settings/departments/new');
    await page.getByLabel('ชื่อแผนก').fill(name);
    await page.getByRole('button', { name: 'สร้างแผนก' }).click();
    await page.waitForURL(/\/departments$/);

    // Try again with the same name.
    await page.goto('/admin/settings/departments/new');
    await page.getByLabel('ชื่อแผนก').fill(name);
    await page.getByRole('button', { name: 'สร้างแผนก' }).click();

    // Stays on the new page with a Thai error.
    await page.waitForURL(/\/departments\/new/);
    // Scope: Next.js renders a hidden route-announcer with role="alert";
    // ours is the visible <p role="alert"> inside the form. Filter by text.
    await expect(page.getByRole('alert').filter({ hasText: /แผนกชื่อนี้อยู่แล้ว/ })).toBeVisible();
  });
});
