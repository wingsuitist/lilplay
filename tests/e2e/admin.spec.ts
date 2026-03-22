import { test, expect } from '@playwright/test';

const SITE_TOKEN = 'testtoken';

test('admin page requires site token', async ({ page }) => {
  const res = await page.goto('/admin');
  expect(res?.status()).toBe(403);
});

test('admin page shows PIN screen with token', async ({ page }) => {
  await page.goto(`/admin?s=${SITE_TOKEN}`);
  await expect(page.locator('.keypad')).toBeVisible();
});

test('wrong admin PIN shows error', async ({ page }) => {
  await page.goto(`/admin?s=${SITE_TOKEN}`);
  for (const d of ['1', '2', '3', '4']) await page.click(`button:has-text("${d}")`);
  await page.click('button[aria-label="Confirm PIN"]');
  await expect(page.locator('[role="alert"], p:has-text("Wrong")').first()).toBeVisible({ timeout: 5000 });
});

test('correct admin PIN shows dashboard', async ({ page }) => {
  await page.goto(`/admin?s=${SITE_TOKEN}`);
  // Admin PIN is 9999
  for (let i = 0; i < 4; i++) await page.click('button:has-text("9")');
  await page.click('button[aria-label="Confirm PIN"]');
  await expect(page.locator('.child-card').first()).toBeVisible({ timeout: 5000 });
});

test('dashboard shows all children', async ({ page }) => {
  await page.goto(`/admin?s=${SITE_TOKEN}`);
  for (let i = 0; i < 4; i++) await page.click('button:has-text("9")');
  await page.click('button[aria-label="Confirm PIN"]');
  await page.waitForSelector('.child-card');
  const cards = await page.locator('.child-card').count();
  expect(cards).toBeGreaterThanOrEqual(3);
});

test('can add and delete a child', async ({ page }) => {
  await page.goto(`/admin?s=${SITE_TOKEN}`);
  for (let i = 0; i < 4; i++) await page.click('button:has-text("9")');
  await page.click('button[aria-label="Confirm PIN"]');
  await page.waitForSelector('.child-card');

  // Add child
  await page.click('button:has-text("+ Add child")');
  await page.fill('input[placeholder="Child\'s name"]', 'PlaywrightKid');
  await page.fill('input[placeholder="e.g. 1234"]', '3333');
  await page.click('button:has-text("Save")');
  // Wait for child card to appear
  await page.waitForSelector('.child-card:has-text("PlaywrightKid")', { timeout: 5000 });
  // Close any open dialog via JS (Alpine state)
  await page.evaluate(() => {
    const el = document.querySelector('[x-data]') as any;
    if (el && el._x_dataStack) {
      const data = el._x_dataStack[0];
      if (data) { data.showDialog = false; data.showDeleteDialog = false; }
    }
  });
  await page.waitForTimeout(500);

  // Delete it
  const card = page.locator('.child-card:has-text("PlaywrightKid")');
  await card.locator('button.contrast.outline:has-text("Delete")').click();
  // Wait for delete confirmation dialog then confirm
  await page.waitForTimeout(500);
  await page.locator('dialog[open] footer button.contrast').click();
  await expect(page.locator('.child-card:has-text("PlaywrightKid")')).not.toBeVisible({ timeout: 5000 });
});
