import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * A modal backdrop must cover the whole viewport, sidebar included.
 *
 * <Dialog> renders inline with `fixed inset-0` — no portal — so it depends on
 * the viewport being its containing block. Any ancestor with a transform,
 * filter, or running animation takes that role instead, and `fixed` silently
 * starts resolving against that ancestor's box.
 *
 * That is exactly what the page-entrance wrapper did: `animation: … both`
 * keeps the final keyframe's `transform: translateY(0)` applied forever, and
 * `translateY(0)` is not `none`. Every dialog under /admin then sized itself
 * to <main> — the sidebar stayed undimmed and the panel centred in the content
 * column instead of the screen. Nothing threw, no test failed, and the page
 * looked fine until someone opened a modal.
 *
 * Asserted geometrically rather than by inspecting CSS, so it holds regardless
 * of which property reintroduces a containing block.
 */

/**
 * Returns every `position: fixed` element that sits inside an ancestor which
 * has taken over as its containing block.
 *
 * transform/filter/backdrop-filter/perspective/contain/will-change all do
 * that, so asserting the invariant catches whichever property does it next
 * rather than only the one that did it last.
 *
 * It sees only what is MOUNTED, which is a real limit worth stating: run
 * against the CSS that caused the original bug, this passed — no dialog was
 * open, and the toast container and drawer sit above <PageFade> in the layout
 * so nothing captured them. The dialog case needs the geometric test above,
 * which opens one. Neither test subsumes the other.
 *
 * Run only at rest: the page entrance legitimately holds a transform for its
 * 320ms, so callers wait for animations to finish first.
 */
async function capturedFixedElements(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const PROPS = [
      'transform',
      'filter',
      'backdropFilter',
      'perspective',
      'willChange',
      'contain',
    ] as const;
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0, 3).join('.')}`;

    const out: Array<{ fixed: string; ancestor: string; prop: string; value: string }> = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (getComputedStyle(el).position !== 'fixed') continue;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        const hit = PROPS.find((prop) => {
          const v = s[prop];
          return v && v !== 'none' && v !== 'auto' && v !== 'normal';
        });
        if (hit) {
          out.push({ fixed: describe(el), ancestor: describe(p), prop: hit, value: s[hit] });
          break;
        }
      }
    }
    return out;
  });
}

/** Wait for the page entrance to finish so its transform is gone. */
async function settle(page: import('@playwright/test').Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
}

test.describe('dialog backdrop covers the viewport', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  test('backdrop spans the full viewport, not just the content column', async ({ page }) => {
    const suffix = e2eId();
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${suffix}` } });
    const user = await prisma.user.create({ data: {} });
    const employee = await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: `e2e-First-${suffix}`,
        lastName: `e2e-Last-${suffix}`,
        branchId: branch.id,
        assignedBranchIds: [branch.id],
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20_000),
        status: 'Active',
        canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });
    await prisma.cashAdvance.create({
      data: {
        employeeId: employee.id,
        amount: new Prisma.Decimal(4242),
        status: 'Pending',
      },
    });

    await loginAsAdmin(page);
    await page.goto('/admin/advance');

    const row = page.getByRole('button', {
      name: new RegExp(`ตรวจสอบคำขอเบิกของ.*${suffix}`),
    });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // The backdrop is the dialog's parent — the `fixed inset-0` element.
    const box = await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"]');
      const backdrop = panel?.parentElement;
      if (!backdrop) throw new Error('no backdrop found');
      const r = backdrop.getBoundingClientRect();
      return {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });

    // Pinned to the viewport's own origin and size. Before the fix the
    // backdrop started at the sidebar's right edge (left ≈ 256) and was
    // exactly that much narrower.
    expect(box.left).toBeLessThanOrEqual(1);
    expect(box.top).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(box.vw - 1);
    expect(box.height).toBeGreaterThanOrEqual(box.vh - 1);

    // And the sidebar is actually behind the scrim rather than beside it.
    const sidebarCovered = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      if (!aside) return null;
      const r = aside.getBoundingClientRect();
      const midpoint = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return aside.contains(midpoint) ? 'sidebar' : 'covered';
    });
    expect(sidebarCovered).toBe('covered');
  });
});

test.describe('no fixed element is captured by a transformed ancestor', () => {
  test('desktop: admin shell at rest', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/approvals');
    await settle(page);

    // Covers the toast container (always rendered, empty or not) and every
    // other fixed element present on the page.
    expect(await capturedFixedElements(page)).toEqual([]);
  });

  test('mobile: with the nav drawer open @mobile', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin');
    await settle(page);

    // The drawer's scrim only exists while open, so it has to be opened to be
    // checked at all.
    await page.getByRole('button', { name: 'เปิดเมนู' }).click();
    await expect
      .poll(async () => (await page.locator('aside').boundingBox())?.x ?? -999)
      .toBeGreaterThanOrEqual(-1);
    await settle(page);

    expect(await capturedFixedElements(page)).toEqual([]);
  });
});
