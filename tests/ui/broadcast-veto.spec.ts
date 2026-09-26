import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { defaultVetoDesign, previewVeto } from '../../client/src/components/veto/VetoDesignCanvas';

test('OBS veto output keeps fallback square and refreshes published data without reloading', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { MemoryRouter } from 'react-router-dom';
        import { BrandingProvider } from './client/src/contexts/BrandingContext';
        import BroadcastVeto from './client/src/pages/BroadcastVeto';
        createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/broadcast/veto']}><BrandingProvider><BroadcastVeto /></BrandingProvider></MemoryRouter>);`,
      resolveDir: process.cwd(), sourcefile: 'broadcast-harness.tsx', loader: 'tsx',
    },
    bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic',
  });
  await page.route('http://broadcast.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/bundle.js"></script>' });
    if (path === '/icon.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" />' });
    return route.fulfill({ status: 404 });
  });
  let design = defaultVetoDesign();
  let branding = { displayName: 'BebraCup 2026', logoUrl: '/icon.svg', primaryColor: '#fff', secondaryColor: '#fff', showGitHubLink: false, showDocumentationLink: false, showVersion: false };
  let teamName = 'erika team';
  let teamLogo: string | null = null;
  const veto = { ...previewVeto('pick', 'bo3')!, allMaps: ['de_ancient', 'de_anubis'], pickedMaps: [{ mapNumber: 1, mapName: 'de_anubis', pickedBy: 'team2', knifeRound: false }] };

  await page.route('**/api/settings/branding', (route) => route.fulfill({ json: { success: true, branding } }));
  await page.route('**/api/broadcast-veto-design/published', (route) => route.fulfill({ json: { success: true, design } }));
  await page.route('**/api/integrations/jts-hud/broadcast-veto', (route) => route.fulfill({ json: {
    success: true, veto: { ...veto, team1Name: 'aurum team', team2Name: teamName }, teamLogos: { team1: null, team2: teamLogo },
  } }));

  await page.goto('http://broadcast.test/');
  const fallback = page.locator('.vdc-map-logo-fallback');
  await expect(fallback).toBeVisible();
  await page.addStyleTag({ content: '.vdc-map-logo-fallback{aspect-ratio:auto!important}' });
  const size = await fallback.evaluate((node) => {
    const card = node.closest('.vdc-map')!.getBoundingClientRect();
    const logo = node.getBoundingClientRect();
    return { width: logo.width, height: logo.height, cardHeight: card.height };
  });
  expect(Math.abs(size.width - size.height)).toBeLessThan(2);
  expect(size.height).toBeLessThan(size.cardHeight / 2);

  await page.evaluate(() => { (window as typeof window & { vetoPageMarker?: boolean }).vetoPageMarker = true; });
  teamName = 'updated team';
  teamLogo = '/icon.svg?v=2';
  branding = { ...branding, displayName: 'Updated Cup' };
  design = { ...design, screens: { ...design.screens, live: { ...design.screens.live, background: '#123456', elements: design.screens.live.elements.map((element) => element.kind === 'maps' ? { ...element, mapImages: { de_anubis: '/icon.svg?v=3' } } : element) } } };

  await expect(page.locator('[data-vdc-binding="team2"]')).toContainText('updated team', { timeout: 10_000 });
  await expect(page.locator('[data-vdc-binding="brand"]')).toContainText('Updated Cup');
  await expect(page.locator('[data-vdc-binding="team2Logo"] img')).toHaveAttribute('src', teamLogo);
  await expect(page.getByTestId('broadcast-veto-map-de_anubis').locator('.vdc-map-photo')).toHaveAttribute('src', '/icon.svg?v=3');
  await expect(page.locator('.vdc-canvas')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  expect(await page.evaluate(() => (window as typeof window & { vetoPageMarker?: boolean }).vetoPageMarker)).toBe(true);
});
