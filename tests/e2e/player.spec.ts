import { test, expect } from '@playwright/test';

const SITE_TOKEN = 'testtoken';

async function enterPin(page: any, pin: string) {
  await page.fill('input[type="password"]', pin);
}

async function submitPin(page: any) {
  await page.click('button:has-text("Enter")');
}

test('shows 403 without site token', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(403);
});

test('shows PIN screen with valid site token', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('wrong PIN shows error', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  await enterPin(page, '9876');
  await submitPin(page);
  await expect(page.locator('[role="alert"]').first()).toBeVisible();
});

test('correct PIN shows player', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  await enterPin(page, '0000');
  await submitPin(page);
  await expect(page.locator('.remaining-big')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.entry-list')).toBeVisible();
});

test('file list shows tracks', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  await enterPin(page, '0000');
  await submitPin(page);
  await page.waitForSelector('.entry-list li');
  const items = await page.locator('.entry-list li').count();
  expect(items).toBeGreaterThan(0);
});

test('play folder button visible when files exist', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  await enterPin(page, '0000');
  await submitPin(page);
  await page.waitForSelector('.play-folder-btn');
  await expect(page.locator('.play-folder-btn')).toBeVisible();
});

test('sign out returns to PIN screen', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  await enterPin(page, '0000');
  await submitPin(page);
  await page.waitForSelector('.remaining-big');
  await page.click('button:has-text("Sign out")');
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('admin link on PIN screen links to admin with site token', async ({ page }) => {
  await page.goto(`/?s=${SITE_TOKEN}`);
  const adminLink = page.locator('a:has-text("Admin")');
  await expect(adminLink).toBeVisible();
  const href = await adminLink.getAttribute('href');
  expect(href).toContain('/admin');
  expect(href).toContain(SITE_TOKEN);
});
