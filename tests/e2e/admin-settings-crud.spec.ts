import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId } from './helpers/db';

/**
 * Parametrized smoke test for the four "simple" settings CRUDs:
 *
 *   - Branch (name only — geofence/address optional, defaults are fine)
 *   - AccountingGroup
 *   - LeaveType
 *   - Holiday (uniquely has TWO required fields: name + date)
 *
 * Department CRUD has its own spec (admin-department-crud.spec.ts) which
 * was the canonical lifecycle test; these four mirror the same flow with
 * config-driven differences in field labels, button text, and the unique-
 * constraint error message.
 *
 * Why this exists: when we fixed the nested-forms bug (commit 57aa88d),
 * the archive button moved into a sibling "พื้นที่อันตราย" block on all
 * four forms. The Department spec proved the fix worked for Department.
 * These four specs prove it landed correctly for the others. A copy-
 * paste error on one of them would surface here.
 */

type Field = {
  label: string | RegExp;
  /** YYYY-MM-DD for date inputs, anything else for text/textarea. */
  value: string;
};

type CrudConfig = {
  /** Spec describe-block name. */
  describe: string;
  /** Base URL for the list page. */
  baseUrl: string;
  /** H2 heading text on the list page. */
  listHeading: string;
  /** Add button text on the list page (e.g. "+ เพิ่มสาขา"). */
  addButtonText: string | RegExp;
  /** Submit button text on the create form. */
  submitCreateText: string;
  /** Submit button text on the edit form (always "บันทึก" in our codebase). */
  submitEditText: string;
  /**
   * Fields to fill on create. The first field's value is the unique
   * identifier we use to find the row in the list afterward.
   */
  createFields: Field[];
  /** Update applied during edit. We change the FIRST field to this value. */
  editValueForFirstField: (suffix: string) => string;
  /** Regex matching the row in the list (matches the edited value). */
  rowMatcherForEditedValue: (editedValue: string) => RegExp;
  /** Thai error text for the unique-constraint duplicate-name path. */
  duplicateErrorText: RegExp;
};

const CRUDS: CrudConfig[] = [
  {
    describe: 'Branch',
    baseUrl: '/admin/settings/branches',
    listHeading: 'สาขา',
    addButtonText: /\+ เพิ่มสาขา/,
    submitCreateText: 'สร้างสาขา',
    submitEditText: 'บันทึก',
    createFields: [{ label: 'ชื่อสาขา', value: '' /* filled at runtime */ }],
    editValueForFirstField: (suffix) => `e2e-Branch-Edit-${suffix}`,
    rowMatcherForEditedValue: (v) => new RegExp(v),
    duplicateErrorText: /สาขาชื่อนี้อยู่แล้ว/,
  },
  {
    describe: 'AccountingGroup',
    baseUrl: '/admin/settings/accounting-groups',
    listHeading: 'กลุ่มบัญชี',
    addButtonText: /\+ เพิ่มกลุ่ม/,
    submitCreateText: 'สร้างกลุ่ม',
    submitEditText: 'บันทึก',
    createFields: [{ label: 'ชื่อกลุ่ม', value: '' }],
    editValueForFirstField: (suffix) => `e2e-AcctGrp-Edit-${suffix}`,
    rowMatcherForEditedValue: (v) => new RegExp(v),
    duplicateErrorText: /กลุ่มชื่อนี้อยู่แล้ว/,
  },
  {
    describe: 'LeaveType',
    baseUrl: '/admin/settings/leave-types',
    listHeading: 'ประเภทการลา',
    addButtonText: /\+ เพิ่มประเภท/,
    submitCreateText: 'สร้างประเภท',
    submitEditText: 'บันทึก',
    createFields: [{ label: 'ชื่อประเภท', value: '' }],
    editValueForFirstField: (suffix) => `e2e-LType-Edit-${suffix}`,
    rowMatcherForEditedValue: (v) => new RegExp(v),
    duplicateErrorText: /ประเภทการลาชื่อนี้อยู่แล้ว/,
  },
  {
    describe: 'Holiday',
    baseUrl: '/admin/settings/holidays',
    listHeading: 'วันหยุด',
    addButtonText: /\+ เพิ่มวันหยุด/,
    submitCreateText: 'เพิ่มวันหยุด',
    submitEditText: 'บันทึก',
    // Holiday is special: two required fields. The "name" field is the one
    // we'll match on for row identification; "date" stays the same across
    // edits (changing it would create a different conceptual entity).
    createFields: [
      { label: 'ชื่อวันหยุด', value: '' }, // FIRST — becomes the row matcher
      { label: 'วันที่', value: '2030-07-15' }, // arbitrary future date unlikely to collide
    ],
    editValueForFirstField: (suffix) => `e2e-Holiday-Edit-${suffix}`,
    rowMatcherForEditedValue: (v) => new RegExp(v),
    duplicateErrorText: /วันหยุดในวันที่นี้อยู่แล้ว/,
  },
];

/**
 * Fill a field by label, switching between input/textarea/date-input.
 * Playwright's getByLabel handles all three transparently when the label
 * is associated via htmlFor/id.
 */
async function fillField(
  page: import('@playwright/test').Page,
  field: Field,
  overrideValue?: string,
) {
  const target = overrideValue ?? field.value;
  await page.getByLabel(field.label).fill(target);
}

for (const cfg of CRUDS) {
  test.describe(`Settings CRUD — ${cfg.describe}`, () => {
    test.afterAll(async () => {
      await cleanupE2eRecords();
    });

    test('admin can create, edit, then archive', async ({ page }) => {
      const suffix = e2eId();
      const originalName = `e2e-${cfg.describe}-${suffix}`;
      const editedName = cfg.editValueForFirstField(suffix);

      await loginAsAdmin(page);

      // ── Create ──────────────────────────────────────────────────────
      await page.goto(cfg.baseUrl);
      await expect(page.getByRole('heading', { name: cfg.listHeading })).toBeVisible();

      await page.getByRole('link', { name: cfg.addButtonText }).first().click();
      await page.waitForURL(new RegExp(`${cfg.baseUrl}/new`));

      // Fill required fields. The FIRST field's value gets overridden with
      // our e2e-suffixed unique name; the rest use the config's defaults.
      for (let i = 0; i < cfg.createFields.length; i++) {
        const field = cfg.createFields[i];
        if (!field) continue;
        await fillField(page, field, i === 0 ? originalName : undefined);
      }
      await page.getByRole('button', { name: cfg.submitCreateText }).click();

      await page.waitForURL(new RegExp(`${cfg.baseUrl}$`));
      await expect(page.getByText(originalName).first()).toBeVisible();

      // ── Edit ────────────────────────────────────────────────────────
      // Click "แก้ไข" in the row we just created. Holiday's list uses a
      // year-grouped table, so we match by text proximity rather than
      // strict <tr>.
      const editLink = page
        .locator('tr')
        .filter({ hasText: originalName })
        .getByRole('link', { name: 'แก้ไข' });
      await editLink.click();
      await page.waitForURL(new RegExp(`${cfg.baseUrl}/[^/]+/edit`));

      // Change the first field's value, leave others alone.
      const firstField = cfg.createFields[0];
      if (!firstField) throw new Error('config has no fields');
      await page.getByLabel(firstField.label).fill(editedName);
      await page.getByRole('button', { name: cfg.submitEditText }).click();

      await page.waitForURL(new RegExp(`${cfg.baseUrl}$`));
      await expect(page.getByText(editedName).first()).toBeVisible();
      await expect(page.getByText(originalName).first()).not.toBeVisible();

      // ── Archive (THE point of this test) ────────────────────────────
      // After the nested-forms-bug fix, "เก็บถาวร" lives in a sibling
      // <form> outside the update form (the "พื้นที่อันตราย" block).
      // Pre-fix, clicking it would have submitted the update form. We
      // confirm it actually archives.
      const editLinkAfter = page
        .locator('tr')
        .filter({ hasText: editedName })
        .getByRole('link', { name: 'แก้ไข' });
      await editLinkAfter.click();
      await page.waitForURL(new RegExp(`${cfg.baseUrl}/[^/]+/edit`));

      const archiveButton = page.getByRole('button', { name: 'เก็บถาวร', exact: true });
      await expect(archiveButton).toBeVisible({ timeout: 5_000 });
      await archiveButton.click();
      await page.waitForURL(new RegExp(`${cfg.baseUrl}$`), { timeout: 10_000 });

      // The row should be gone from the default (non-archived) list view.
      await expect(page.getByText(editedName).first()).not.toBeVisible();
    });

    // The uniqueness-constraint test for Holiday is structurally
    // different — the "unique" axis is `date`, not `name`. Skip the
    // generic uniqueness test there; the create test already exercises
    // the success path.
    if (cfg.describe !== 'Holiday') {
      test('uniqueness constraint produces a Thai error message', async ({ page }) => {
        const name = `e2e-Dup-${cfg.describe}-${e2eId()}`;
        const firstField = cfg.createFields[0];
        if (!firstField) throw new Error('config has no fields');

        await loginAsAdmin(page);
        await page.goto(`${cfg.baseUrl}/new`);
        await fillField(page, firstField, name);
        await page.getByRole('button', { name: cfg.submitCreateText }).click();
        await page.waitForURL(new RegExp(`${cfg.baseUrl}$`));

        // Second attempt with the same name → should produce a Thai error.
        await page.goto(`${cfg.baseUrl}/new`);
        await fillField(page, firstField, name);
        await page.getByRole('button', { name: cfg.submitCreateText }).click();
        await page.waitForURL(new RegExp(`${cfg.baseUrl}/new`));

        await expect(
          page.getByRole('alert').filter({ hasText: cfg.duplicateErrorText }),
        ).toBeVisible();
      });
    }
  });
}
