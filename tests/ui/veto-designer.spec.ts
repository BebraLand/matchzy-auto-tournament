import { test, expect } from '@playwright/test';
import { previewVeto } from '../../client/src/components/veto/VetoDesignCanvas';

test('admin edits a draft and publishes the veto canvas', async ({ page }) => {
  await page.route('**/api/auth/admin/me', (route) => route.fulfill({ json: { authenticated: true, steamId: '76561198000000000', provider: 'steam' } }));
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { authenticated: true, steamId: '76561198000000000', hasPlayerRecord: true } }));
  await page.route('**/api/broadcast-veto-design/draft', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { success: true, design: null, published: null } })
    : route.fulfill({ json: { success: true } }));
  await page.route('**/api/broadcast-veto-design/publish', (route) => route.fulfill({ json: { success: true } }));
  await page.route('**/api/integrations/jts-hud/broadcast-veto', (route) => route.fulfill({ json: { success: true, veto: { ...previewVeto('ban', 'bo3'), team1Name: 'ALPHA', team2Name: 'BRAVO' } } }));

  await page.goto('/veto-designer');
  await expect(page.getByText('VETO DESIGNER', { exact: true }).first()).toBeVisible();
  if (process.env.VETO_DESIGNER_SCREENSHOT) await page.screenshot({ path: process.env.VETO_DESIGNER_SCREENSHOT, fullPage: true });
  await page.getByRole('button', { name: '＋ Text' }).click();
  await expect(page.locator('.vdc-element.selected')).toBeVisible();
  await page.getByLabel('Text', { exact: true }).fill('CUSTOM VETO');
  await expect(page.locator('.vdc-element.selected')).toContainText('CUSTOM VETO');
  const save = page.waitForRequest((request) => request.url().endsWith('/api/broadcast-veto-design/draft') && request.method() === 'PUT');
  await page.getByRole('button', { name: 'Publish' }).click();
  const saved = await save;
  expect(saved.postDataJSON().design.screens.live.elements.some((element: { text?: string }) => element.text === 'CUSTOM VETO')).toBe(true);
  await expect(page.getByText(/Published/)).toBeVisible();
  await page.getByLabel('Preview scenario').selectOption('real');
  await expect(page.locator('.vdc-element').filter({ hasText: 'ALPHA' }).first()).toBeVisible();
});
