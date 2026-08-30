import { expect, test } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

test.describe.serial('Custom branding', () => {
  test('exposes branding to public pages', async ({ request }) => {
    const response = await request.get('/api/settings/branding');
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.branding).toMatchObject({
      displayName: expect.any(String),
      logoUrl: expect.any(String),
      primaryColor: expect.stringMatching(/^#[0-9A-F]{6}$/),
      secondaryColor: expect.stringMatching(/^#[0-9A-F]{6}$/),
    });
  });

  test('allows an admin to update and restore branding', async ({ page }) => {
    await ensureSignedIn(page);

    const originalResponse = await page.request.get('/api/settings/branding');
    expect(originalResponse.ok()).toBe(true);
    const original = (await originalResponse.json()).branding;
    const updated = {
      displayName: `Branding test ${Date.now()}`,
      logoUrl: original.logoUrl,
      primaryColor: '#112233',
      secondaryColor: '#445566',
    };

    try {
      const saveResponse = await page.request.put('/api/settings', { data: { branding: updated } });
      expect(saveResponse.ok()).toBe(true);
      expect((await saveResponse.json()).settings.branding).toEqual(updated);
    } finally {
      const restoreResponse = await page.request.put('/api/settings', {
        data: { branding: original },
      });
      expect(restoreResponse.ok()).toBe(true);
    }
  });
});
