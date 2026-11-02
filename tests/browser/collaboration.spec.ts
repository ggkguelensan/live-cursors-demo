import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Pause collaborators' }).click();
  await expect(page.getByText('All replicas agree')).toBeVisible();
  await expect(page.locator('.cursor-badge')).toHaveCount(6);
});

test('typing, selection and tags reach the other perspective without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const maya = page.getByRole('textbox', { name: "Maya's document" });
  const leo = page.getByRole('textbox', { name: "Leo's document" });
  await maya.fill('Hello from Maya. A shared idea.');
  await expect(leo).toHaveValue('Hello from Maya. A shared idea.');
  await maya.focus();
  await maya.press('ControlOrMeta+A');
  await maya.press('ArrowRight');
  for (let index = 0; index < 6; index++) await maya.press('ArrowLeft');
  for (let index = 0; index < 6; index++) await maya.press('Shift+ArrowLeft');
  expect(
    await maya.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]),
  ).toEqual([19, 25]);
  await page
    .getByRole('region', { name: 'Maya’s perspective' })
    .getByRole('button', { name: 'Tag selection' })
    .click();
  await expect(page.locator('.tag-chip')).toHaveCount(2);
  await expect(page.getByText('All replicas agree')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Command+/ types into a cursor bubble; Escape preserves it for 30 seconds', async ({
  page,
}) => {
  const maya = page.getByRole('textbox', { name: "Maya's document" });
  const original = await maya.inputValue();
  await maya.focus();
  await maya.press('Meta+/');
  const composer = page.getByRole('textbox', { name: 'Comment as Maya Chen' });
  await expect(composer).toBeFocused();
  await composer.fill('This thought belongs to my cursor.');
  await composer.press('Escape');
  await expect(maya).toBeFocused();
  await expect(maya).toHaveValue(original);
  await expect(
    page.getByText('This thought belongs to my cursor.', { exact: true }).first(),
  ).toBeVisible();
  await page.clock.runFor(1500);
  await expect(page.getByText('This thought belongs to my cursor.', { exact: true })).toHaveCount(
    2,
  );
  await page.clock.fastForward(29000);
  await expect(page.getByText('This thought belongs to my cursor.', { exact: true })).toHaveCount(
    0,
  );
  await expect(maya).toHaveValue(original);
});

test('a concurrent edit race converges and small screens do not overflow', async ({ page }) => {
  await page.getByRole('button', { name: 'Race two edits' }).click();
  await expect(page.getByText('All replicas agree')).toBeVisible();
  const maya = page.getByRole('textbox', { name: "Maya's document" });
  await expect(maya).toHaveValue(/\+ Maya/);
  await expect(maya).toHaveValue(/\+ Leo/);
  await expect(page.getByRole('textbox', { name: "Leo's document" })).toHaveValue(
    await maya.inputValue(),
  );
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('collaborators visibly react to each other and avatar names expand on hover', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Run collaborators' }).click();
  await page.clock.runFor(20000);
  await expect(page.getByRole('button', { name: 'Reset and replay' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: "Maya's document" })).toHaveValue(
    /Keep the note short, clear\./,
  );
  await expect(page.locator('.tag-chip')).toHaveCount(2);
  await expect(
    page.locator('.cursor-comment p').filter({ hasText: 'Love this direction' }),
  ).toHaveCount(2);
  await page.locator('.cursor-badge').first().hover();
  await expect(page.locator('.cursor-badge').first().locator('.cursor-name')).toBeVisible();
  const bubbles = await page
    .locator('.perspective')
    .first()
    .locator('.cursor-comment')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { text: node.textContent, x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
  for (let i = 0; i < bubbles.length; i++)
    for (let j = i + 1; j < bubbles.length; j++) {
      const a = bubbles[i],
        b = bubbles[j];
      expect(
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y,
        JSON.stringify(bubbles),
      ).toBe(false);
    }
  await page.screenshot({ path: 'test-results/collaborators.png', fullPage: true });
});

test('a single avatar flies to the growing comment corner and returns after expiry', async ({
  page,
}) => {
  const layer = page
    .locator('.perspective')
    .first()
    .locator('.cursor-layer[data-user="Maya Chen"]');
  const avatar = layer.locator('.cursor-badge img');
  const stem = layer.locator('.cursor-stem');
  const maya = page.getByRole('textbox', { name: "Maya's document" });
  await maya.focus();
  await maya.press('Meta+/');
  const composer = page.getByRole('textbox', { name: 'Comment as Maya Chen' });
  await expect(composer).toBeFocused();
  await composer.fill('Hi');
  const initial = await layer.locator('.cursor-comment').boundingBox();
  await composer.fill(
    'A longer thought stretches the container while my avatar stays attached to its far corner. This is a cursor comment, never document text.',
  );
  const body = layer.locator('.cursor-comment');
  await expect(avatar).toHaveCount(1);
  await expect
    .poll(async () => {
      const image = (await avatar.boundingBox())!;
      const rect = (await body.boundingBox())!;
      return (
        Math.abs(image.x + image.width / 2 - rect.x - rect.width) +
        Math.abs(image.y + image.height / 2 - rect.y)
      );
    })
    .toBeLessThan(3);
  const expanded = (await body.boundingBox())!;
  expect(expanded.width).toBeGreaterThan(initial!.width);
  expect(expanded.height).toBeGreaterThan(initial!.height);
  await page.screenshot({ path: 'test-results/tethered-comment.png', fullPage: true });
  await composer.press('Escape');
  await expect(maya).toBeFocused();
  await page.clock.fastForward(31000);
  await expect(layer.locator('.cursor-comment')).toHaveAttribute('data-open', 'false');
  await expect
    .poll(async () => {
      const image = (await avatar.boundingBox())!;
      const caret = (await stem.boundingBox())!;
      return Math.abs(image.x - caret.x - 1) + Math.abs(image.y + image.height / 2 - caret.y + 16);
    })
    .toBeLessThan(3);
});

test('reduced motion keeps the transported avatar immediate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('textbox', { name: "Maya's document" }).press('Meta+/');
  const composer = page.getByRole('textbox', { name: 'Comment as Maya Chen' });
  await expect(composer).toBeFocused();
  expect(
    await page
      .locator('.perspective')
      .first()
      .locator('.cursor-layer[data-user="Maya Chen"] .cursor-avatar-position')
      .evaluate((node) => getComputedStyle(node).transitionDuration),
  ).toBe('0s');
});
