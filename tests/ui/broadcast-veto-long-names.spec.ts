import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { defaultVetoDesign, previewVeto, type VetoDesign } from '../../client/src/components/veto/VetoDesignCanvas';
import type { VetoState } from '../../client/src/types/veto.types';

type HarnessWindow = typeof window & { renderVeto: (value: unknown) => void; vetoProps: { design: VetoDesign; veto: VetoState } };

const longName = 'Rassolnyye voyska';
let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { VetoDesignCanvas } from './client/src/components/veto/VetoDesignCanvas';
        const root = createRoot(document.getElementById('root'));
        window.renderVeto = (props) => { window.vetoProps = props; root.render(<VetoDesignCanvas {...props} maps={new Map()} />); };`,
      resolveDir: process.cwd(), sourcefile: 'veto-names-harness.tsx', loader: 'tsx',
    },
    bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic',
  });
  bundle = result.outputFiles[0].text;
});

async function render(page: Page, options: { team1?: string; team2?: string; scenario?: string; format?: 'bo1' | 'bo3' | 'bo5'; ownership?: boolean } = {}) {
  const design = defaultVetoDesign();
  const assetRoot = process.env.VETO_VISUAL_ASSETS;
  if (assetRoot) design.screens.live.backgroundImage = '/visual/background.png';
  design.showTimelineOwnership = options.ownership || false;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script src="/bundle.js"></script>' });
    if (assetRoot) {
      const filename = url.pathname.startsWith('/visual/') ? path.basename(url.pathname) : `${path.basename(url.pathname, '.webp')}.webp`;
      try { return await route.fulfill({ body: await readFile(path.join(assetRoot, filename)), contentType: filename.endsWith('.png') ? 'image/png' : 'image/webp' }); } catch { /* Use a deterministic empty image for unavailable map artwork. */ }
    }
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="400"><rect width="256" height="400" fill="#223347"/></svg>' });
  });
  await page.goto('http://veto-names.test/');
  const scenario = options.scenario || 'pending';
  const props = {
    design, screen: scenario === 'completed' ? 'completed' : 'live',
    veto: { ...previewVeto(scenario, options.format || 'bo3')!, team1Name: options.team1 || longName, team2Name: options.team2 || 'GJ' },
    branding: { displayName: 'BebraCup 2026', logoUrl: assetRoot ? '/visual/brand.png' : '', primaryColor: '#fff', secondaryColor: '#fff', showGitHubLink: false, showDocumentationLink: false, showVersion: false },
  };
  await page.evaluate((next) => (window as HarnessWindow).renderVeto(next), props);
  await expect(page.locator('.vdc-canvas')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function expectTextFits(page: Page, selector: string) {
  const metrics = () => page.locator(selector).evaluateAll((nodes) => nodes.map((node) => {
    const parent = node.parentElement!;
    const style = window.getComputedStyle(parent);
    const available = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const range = document.createRange();
    range.selectNodeContents(node);
    return { text: node.textContent, rects: range.getClientRects().length, width: node.scrollWidth, available, height: node.scrollHeight, parentHeight: parent.clientHeight, font: window.getComputedStyle(node).fontSize };
  }));
  try {
    await expect.poll(async () => {
      const nodes = await metrics();
      return nodes.length > 0 && nodes.every((node) => node.rects === 1 && node.width <= node.available + 1 && node.height <= node.parentHeight + 1);
    }).toBe(true);
  } catch (error) { console.log(selector, await metrics()); throw error; }
}

test('long team names fit the header and remain complete in every BO3 timeline step', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await render(page);
  const capture = process.env.VETO_CAPTURE_PHASE;
  if (capture) {
    const directory = path.resolve('tmp/veto-long-names');
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${capture}.png`) });
    await page.screenshot({ path: path.join(directory, `${capture}-header.png`), clip: { x: 60, y: 185, width: 1800, height: 145 } });
    await page.screenshot({ path: path.join(directory, `${capture}-timeline.png`), clip: { x: 60, y: 870, width: 1800, height: 115 } });
  }
  await expectTextFits(page, '[data-vdc-binding="team1"] > span');
  await expectTextFits(page, '[data-vdc-binding="team2"] > span');
  await expect(page.locator('[data-vdc-binding="team2"] > span')).toHaveCSS('font-size', '69px');
  await expect(page.locator('.vdc-step small').first()).toHaveText(longName.toUpperCase());
  await expectTextFits(page, '.vdc-step small > span');
});

test('fitting updates after a team rename and a designer resize, respecting logo space', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await render(page, { team1: 'GJ' });
  await expect(page.locator('[data-vdc-binding="team1"] > span')).toHaveCSS('font-size', '69px');
  await page.evaluate((name) => {
    const harness = window as HarnessWindow;
    harness.vetoProps.veto = { ...harness.vetoProps.veto, team1Name: name };
    harness.vetoProps.design = window.structuredClone(harness.vetoProps.design);
    const team = harness.vetoProps.design.screens.live.elements.find((element) => element.id === 'team1')!;
    team.w = 500;
    team.fontFamily = 'Georgia';
    harness.renderVeto(harness.vetoProps);
  }, longName);
  await expectTextFits(page, '[data-vdc-binding="team1"] > span');
  const name = page.locator('[data-vdc-binding="team1"] > span');
  const fittedSize = parseFloat(await name.evaluate((node) => window.getComputedStyle(node).fontSize));
  expect(fittedSize).toBeLessThan(69);
  await page.locator('[data-vdc-binding="team1"]').evaluate((node) => { node.style.width = '690px'; });
  await expectTextFits(page, '[data-vdc-binding="team1"] > span');
  await expect.poll(() => name.evaluate((node) => parseFloat(window.getComputedStyle(node).fontSize))).toBeGreaterThan(fittedSize);
});

test('both team headers and the active turn fit at a scaled broadcast resolution', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await render(page, { team2: longName, scenario: 'ban' });
  await expectTextFits(page, '[data-vdc-binding="team1"] > span');
  await expectTextFits(page, '[data-vdc-binding="team2"] > span');
  await expectTextFits(page, '[data-vdc-binding="turn"] > span');
});

test('extreme names use a readable single-line ellipsis and retain their full tooltip', async ({ page }) => {
  const extremeName = 'Rassolnyye voyska '.repeat(12).trim();
  await render(page, { team1: extremeName });
  const name = page.locator('[data-vdc-binding="team1"] > span');
  await expect(name).toHaveText(extremeName);
  await expect(name).toHaveAttribute('title', extremeName);
  await expect(name).toHaveCSS('white-space', 'nowrap');
  await expect(name).toHaveCSS('text-overflow', 'ellipsis');
  await expect(name).toHaveCSS('font-size', '34.5px');
  await expect(page.locator('.vdc-step small').first()).toHaveText(extremeName.toUpperCase());
});

for (const format of ['bo1', 'bo3', 'bo5'] as const) {
  test(`completed ${format} keeps full ownership labels and side choices`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await render(page, { scenario: 'completed', format, ownership: true });
    await expect(page.locator('[data-vdc-id="completed-match"]')).toHaveText(`${longName}  VS  GJ`);
    await expectTextFits(page, '[data-vdc-id="completed-match"] > span');
    await expectTextFits(page, '.vdc-step em > span');
    await expect(page.locator('.vdc-step em').filter({ hasText: longName.toUpperCase() }).first()).toHaveText(longName.toUpperCase());
    await expect(page.locator('.vdc-step em').filter({ hasText: ' · CT' }).first()).toBeVisible();
  });
}
