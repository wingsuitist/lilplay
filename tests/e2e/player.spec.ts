import { test, expect } from '@playwright/test';

const SITE_TOKEN = 'testtoken';

test('shows 403 without site token', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(403);
});

test('shows PIN screen with valid site token', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  await expect(page.locator('.keypad')).toBeVisible();
});

test('wrong PIN shows error', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  for (const d of ['9', '8', '7', '6']) {
    await page.click(`button:has-text("${d}")`);
  }
  await page.click('button[aria-label="Confirm PIN"]');
  await expect(page.locator('[role="alert"]').first()).toBeVisible();
});

test('correct PIN shows player', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  // Enter PIN 0000 (test child)
  for (let i = 0; i < 4; i++) await page.click('button:has-text("0")');
  await page.click('button[aria-label="Confirm PIN"]');
  await expect(page.locator('.remaining-big')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.entry-list')).toBeVisible();
});

test('file list shows tracks', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  for (let i = 0; i < 4; i++) await page.click('button:has-text("0")');
  await page.click('button[aria-label="Confirm PIN"]');
  await page.waitForSelector('.entry-list li');
  const items = await page.locator('.entry-list li').count();
  expect(items).toBeGreaterThan(0);
});

test('play folder button visible when files exist', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  for (let i = 0; i < 4; i++) await page.click('button:has-text("0")');
  await page.click('button[aria-label="Confirm PIN"]');
  await page.waitForSelector('.play-folder-btn');
  await expect(page.locator('.play-folder-btn')).toBeVisible();
});

test('sign out returns to PIN screen', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  for (let i = 0; i < 4; i++) await page.click('button:has-text("0")');
  await page.click('button[aria-label="Confirm PIN"]');
  await page.waitForSelector('.remaining-big');
  await page.click('button:has-text("Sign out")');
  await expect(page.locator('.keypad')).toBeVisible();
});
