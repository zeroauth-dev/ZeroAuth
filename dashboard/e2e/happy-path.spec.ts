/**
 * End-to-end happy path for the developer console.
 *
 *   signup → first-key reveal → overview → mint another key →
 *   register a device → see the resulting audit events.
 *
 * Runs against a fully booted backend at E2E_BASE_URL (default
 * http://localhost:3000). The backend must be on the same host as the
 * dashboard (served by Express at /dashboard) so cookies, JWT-in-
 * localStorage, and CORS all behave identically to production.
 *
 * CI provisions a fresh Postgres + a freshly-built Express + dashboard
 * before the test runs. Locally, the developer is expected to start the
 * dev stack (`./scripts/deploy.sh dev`) or have `npm run dev` running
 * with Postgres + Redis available.
 */

import { test, expect, type Page } from '@playwright/test';

const TIMESTAMP = Date.now();
const RANDOM = Math.random().toString(36).slice(2, 8);
const EMAIL = `playwright+${TIMESTAMP}-${RANDOM}@example.com`;
const PASSWORD = 'TestPassword-PlayE2E-2026';
const COMPANY = `Playwright Test ${RANDOM}`;
const DEVICE_NAME = `e2e-device-${RANDOM}`;
const SECOND_KEY_NAME = `playwright-secondary-${RANDOM}`;

test.describe.configure({ mode: 'serial' });

test.describe('developer console — happy path', () => {
  test('signup, mint key, register device, see audit events', async ({ page }) => {
    await runHappyPath(page);
  });
});

async function runHappyPath(page: Page): Promise<void> {
  // ─── 1. Signup ────────────────────────────────────────────────
  await page.goto('/dashboard/signup');
  await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();

  await page.getByLabel(/work email/i).fill(EMAIL);
  await page.getByLabel(/company name/i).fill(COMPANY);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();

  // ─── 2. First-key reveal modal ────────────────────────────────
  const revealHeading = page.getByRole('heading', { name: /save your first api key/i });
  await expect(revealHeading).toBeVisible({ timeout: 15_000 });

  const keyContainer = page.locator('div.font-mono').first();
  await expect(keyContainer).toContainText(/^za_(live|test)_[a-f0-9]{48}$/);
  const firstApiKey = (await keyContainer.textContent())?.trim() ?? '';
  expect(firstApiKey).toMatch(/^za_(live|test)_[a-f0-9]{48}$/);

  // Confirm + continue
  const confirmCheckbox = page.getByRole('checkbox', { name: /i have saved this key/i });
  await confirmCheckbox.check();
  await page
    .getByRole('button', { name: /i've saved it, take me to the console/i })
    .click();

  // ─── 3. Land on Overview ─────────────────────────────────────
  await expect(page).toHaveURL(/\/dashboard\/overview$/);
  await expect(page.getByRole('heading', { name: /^overview$/i })).toBeVisible();
  // Sidebar shows the new tenant identity
  await expect(page.locator('aside').getByText(COMPANY)).toBeVisible();

  // ─── 4. API Keys: default key listed; mint a second ──────────
  await page.getByRole('link', { name: /^api keys$/i }).click();
  await expect(page.getByRole('heading', { name: /api keys/i })).toBeVisible();
  // The auto-created "Default Live Key" row should be present.
  await expect(page.getByRole('cell', { name: /default live key/i })).toBeVisible();

  await page.getByRole('button', { name: /\+ new api key/i }).click();
  await expect(page.getByRole('heading', { name: /create new api key/i })).toBeVisible();
  await page.getByLabel(/^name$/i).fill(SECOND_KEY_NAME);
  // env: select "test" so we don't mix with the live default key
  await page.getByLabel(/^environment$/i).selectOption('test');
  await page.getByRole('button', { name: /^create key$/i }).click();

  // One-time reveal — copy the new key
  const newKeyHeading = page.getByRole('heading', { name: /save your api key/i });
  await expect(newKeyHeading).toBeVisible();
  await page.getByRole('button', { name: /^i've saved it$/i }).click();

  // New row appears in the list
  await expect(page.getByRole('cell', { name: SECOND_KEY_NAME })).toBeVisible();
  // ... and the test-environment badge is in the same row
  const newKeyRow = page.locator('tr', { hasText: SECOND_KEY_NAME });
  await expect(newKeyRow.getByText('test')).toBeVisible();

  // ─── 5. Devices: register one ────────────────────────────────
  // Switch the env switcher to "test" so the new device is registered
  // in the same environment we'll review the audit log in.
  await page.getByRole('button', { name: /^test$/i }).click();

  await page.getByRole('link', { name: /^devices$/i }).click();
  await expect(page.getByRole('heading', { name: /^devices$/i })).toBeVisible();
  await page.getByRole('button', { name: /\+ register device/i }).click();
  await expect(page.getByRole('heading', { name: /register a device/i })).toBeVisible();

  await page.getByLabel(/^name$/i).fill(DEVICE_NAME);
  await page.getByLabel(/^location id/i).fill('e2e-blr-01');
  await page.getByLabel(/^battery level/i).fill('87');
  await page.getByRole('button', { name: /^register$/i }).click();

  // Modal closes; toast confirms; the row shows up.
  await expect(page.getByText(/device registered/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('cell', { name: DEVICE_NAME })).toBeVisible();

  // ─── 6. Audit log shows the events we caused ─────────────────
  await page.getByRole('link', { name: /^audit log$/i }).click();
  await expect(page.getByRole('heading', { name: /^audit log$/i })).toBeVisible();

  // The audit log filter defaults to "All statuses" + no action filter,
  // limit=200, so the events we just generated are present.
  //
  // Even though we created the second API key in the "test" environment,
  // api_key.created is recorded with environment=null (audit row written
  // before scope assignment — see api-keys.ts), so it will only appear
  // when the env switcher is on "live". To keep this assertion robust we
  // switch to live for the audit check.
  await page.getByRole('button', { name: /^live$/i }).click();

  // The tenant.created row from signup must be present.
  await expect(page.getByRole('cell', { name: /tenant\.created/ }).first()).toBeVisible();

  // Switch back to test to see device.created.
  await page.getByRole('button', { name: /^test$/i }).click();
  await expect(page.getByRole('cell', { name: /device\.created/ }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(`Registered device .*`) })).toBeVisible();

  // ─── 7. Sign out → /login ────────────────────────────────────
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/login$/);
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
}
