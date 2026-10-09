import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import type { PlayerDetail, Team } from '../../client/src/types';

const firstId = '76561198000000101';
const secondId = '76561198000000102';
const fixturePlayers: PlayerDetail[] = ['Puffch1k', 'ne3nik', 'zimmer4112', 'fremorr1', '/'].map(
  (name, index) => ({
    id: String(BigInt(firstId) + BigInt(index)),
    name,
    avatar: '/fixtures/steam.svg',
    photoUrl: index % 2 === 0 ? '/fixtures/custom.svg?v=1' : undefined,
    currentElo: 1500 + index * 10,
    startingElo: 1500,
    matchCount: 0,
    createdAt: 1,
    updatedAt: 1,
    isAdmin: index === 0,
    isSpectator: index === 1,
  })
);
const fixtureTeam: Team = {
  id: 'test-team-editor',
  name: 'Gaidziai',
  tag: 'GAID',
  captainSteamId: firstId,
  players: fixturePlayers.map((player) => ({
    steamId: player.id,
    name: 'Old roster name',
    avatar: '/fixtures/old.svg',
    elo: 1000,
  })),
};
let bundle: string;

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { CssBaseline, ThemeProvider } from '@mui/material';
        import { I18nextProvider } from 'react-i18next';
        import i18n from './client/src/i18n';
        import { theme } from './client/src/theme';
        import { SnackbarProvider } from './client/src/contexts/SnackbarContext';
        import TeamModal from './client/src/components/modals/TeamModal';
        const team = ${JSON.stringify(fixtureTeam)};
        function Harness() {
          const [open, setOpen] = React.useState(true);
          return <><button onClick={() => setOpen(true)}>Reopen team</button>
            <TeamModal open={open} team={team} onClose={() => setOpen(false)} onSave={() => {}} />
          </>;
        }
        i18n.changeLanguage('en').then(() => {
          createRoot(document.getElementById('root')!).render(
            <React.StrictMode><I18nextProvider i18n={i18n}><ThemeProvider theme={theme}>
              <CssBaseline /><SnackbarProvider><Harness /></SnackbarProvider>
            </ThemeProvider></I18nextProvider></React.StrictMode>
          );
        });`,
      resolveDir: process.cwd(),
      sourcefile: 'team-editor-harness.tsx',
      loader: 'tsx',
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    jsx: 'automatic',
  });
  bundle = result.outputFiles[0].text;
});

async function setupEditor(page: Page, failProfiles = false) {
  const profiles = structuredClone(fixturePlayers);
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const errors: string[] = [];
  let profilesFailed = failProfiles;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://team-editor.test/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === '/') {
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/bundle.js"></script>' });
    }
    if (path === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (path.startsWith('/fixtures/')) {
      const color = path.includes('custom') ? '#f4b876' : '#89b4fa';
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${color}"/><circle cx="40" cy="30" r="14" fill="#30303c"/><path d="M16 76v-12a24 24 0 0148 0v12" fill="#30303c"/></svg>` });
    }
    if (method !== 'GET') writes.push({ method, path, body: request.postDataJSON() });
    if (path === '/api/players' && method === 'GET') {
      if (profilesFailed) return route.fulfill({ status: 503, json: { success: false, error: 'Offline' } });
      return route.fulfill({ json: { success: true, players: profiles } });
    }
    if (path === '/api/players' && method === 'POST') {
      const input = request.postDataJSON();
      const player = { ...fixturePlayers[0], ...input, currentElo: input.elo ?? 1500, photoUrl: input.photoUrl || undefined };
      profiles.push(player);
      return route.fulfill({ json: { success: true, player } });
    }
    const playerMatch = /^\/api\/players\/([^/]+)(\/photo)?$/.exec(path);
    if (playerMatch) {
      const index = profiles.findIndex((player) => player.id === playerMatch[1]);
      if (index < 0) return route.fulfill({ status: 404, json: { success: false, error: 'Player not found' } });
      if (method === 'PUT') {
        const input = request.postDataJSON();
        profiles[index] = { ...profiles[index], ...input, currentElo: input.elo, photoUrl: input.photoUrl || undefined };
      }
      if (playerMatch[2] && method === 'POST') {
        profiles[index] = { ...profiles[index], photoUrl: '/fixtures/custom.svg?v=2' };
      }
      return route.fulfill({ json: { success: true, player: profiles[index] } });
    }
    if (path === `/api/teams/${fixtureTeam.id}` && method === 'PUT') {
      return route.fulfill({ json: { success: true } });
    }
    if (path === `/api/teams/${fixtureTeam.id}`) return route.fulfill({ json: { success: true, team: fixtureTeam } });
    if (path === '/api/teams') return route.fulfill({ json: { success: true, teams: [fixtureTeam] } });
    return route.fulfill({ status: 404, json: { success: false, error: 'Unexpected request' } });
  });
  await page.goto('http://team-editor.test/');
  await expect(page.getByTestId('team-modal')).toBeVisible();
  return { profiles, writes, errors, restoreProfiles: () => { profilesFailed = false; } };
}

async function cancelPlayer(page: Page) {
  await page.getByTestId('player-modal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('player-modal')).not.toBeVisible();
}

test('shows both images and opens the editor from every player detail and the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1040 });
  const state = await setupEditor(page);
  const row = page.getByTestId(`team-edit-player-${firstId}`);
  await expect(row).toContainText('Puffch1k');
  await expect(row).toContainText('ELO: 1500');
  await expect(page.getByTestId('team-custom-images-count')).toHaveText('Custom images: 3 / 5');
  await expect(page.getByTestId(`team-player-photo-status-${firstId}`)).toHaveText('Custom image set');
  await expect(page.getByTestId(`team-player-photo-status-${secondId}`)).toHaveText('No custom image');
  await expect(row.getByRole('img', { name: 'Puffch1k', exact: true })).toHaveAttribute('src', '/fixtures/steam.svg');
  await expect(row.getByRole('img', { name: 'Custom image for Puffch1k' })).toHaveAttribute('src', '/fixtures/custom.svg?v=1');
  for (const target of [
    row.getByText('Puffch1k', { exact: true }),
    row.getByText(firstId, { exact: true }),
    row.getByText('ELO: 1500', { exact: true }),
    row.getByRole('img', { name: 'Puffch1k', exact: true }),
    row.getByRole('img', { name: 'Custom image for Puffch1k' }),
  ]) {
    await target.click();
    await expect(page.getByTestId('player-modal')).toBeVisible();
    await expect(page.getByTestId('player-name-input')).toHaveValue('Puffch1k');
    await expect(page.getByTestId('player-steam-id-input')).toBeDisabled();
    await cancelPlayer(page);
  }
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('player-modal')).toBeVisible();
  await cancelPlayer(page);
  await row.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('player-modal')).toBeVisible();
  await cancelPlayer(page);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
  await page.getByTestId('team-modal').locator('.MuiDialogContent-root').evaluate((content) => {
    const firstRow = content.querySelector('[data-testid^=team-edit-player-]')!;
    content.scrollTop += firstRow.getBoundingClientRect().top - content.getBoundingClientRect().top - 180;
  });
  await page.screenshot({ path: 'test-results/team-player-editor-desktop.png' });
});

test('uploads and removes a custom photo, updates profile data, and keeps the team draft', async ({ page }) => {
  const state = await setupEditor(page);
  await page.getByTestId('team-name-input').fill('Unsaved team name');
  await page.getByTestId(`team-edit-player-${secondId}`).click();
  const editor = page.getByTestId('player-modal');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('combobox', { name: 'Team', exact: true })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await page.getByTestId('player-name-input').fill('Updated player');
  await editor.locator('input[type=file]').setInputFiles({
    name: 'portrait.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(editor.getByRole('img', { name: 'Player portrait preview' })).toHaveAttribute('src', /^data:image\/png/);
  await page.getByTestId('player-elo-input').fill('1600');
  await page.getByTestId('player-save-button').click();
  await page.getByTestId('confirm-dialog-confirm-button').click();
  await expect(editor).not.toBeVisible();
  const row = page.getByTestId(`team-edit-player-${secondId}`);
  await expect(row).toContainText('Updated player');
  await expect(row).toContainText('ELO: 1600');
  await expect(page.getByTestId(`team-player-photo-status-${secondId}`)).toHaveText('Custom image set');
  await expect(page.getByTestId('team-custom-images-count')).toHaveText('Custom images: 4 / 5');
  await expect(page.getByTestId('team-name-input')).toHaveValue('Unsaved team name');
  const profileWrite = state.writes.find((write) => write.path === `/api/players/${secondId}`)!;
  expect(profileWrite.body.isSpectator).toBe(true);
  expect(state.writes.some((write) => write.path.endsWith('/team') || write.path.startsWith('/api/teams/'))).toBe(false);
  await row.click();
  await page.getByTestId('player-photo-remove-button').click();
  await page.getByTestId('player-save-button').click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByTestId(`team-player-photo-status-${secondId}`)).toHaveText('No custom image');
  await expect(page.getByTestId('team-custom-images-count')).toHaveText('Custom images: 3 / 5');
  await page.getByTestId('team-save-button').click();
  const teamWrite = state.writes.find((write) => write.path === `/api/teams/${fixtureTeam.id}`)!;
  expect(teamWrite.body.name).toBe('Unsaved team name');
  expect((teamWrite.body.players as Team['players'])?.find((player) => player.steamId === secondId)).toMatchObject({ name: 'Updated player', elo: 1600 });
  expect(state.errors).toEqual([]);
});

test('replace and remove controls remain separate from editing', async ({ page }) => {
  const state = await setupEditor(page);
  await page.getByTestId(`team-replace-player-${firstId}`).click();
  await expect(page.getByTestId('player-selection-modal')).toBeVisible();
  await expect(page.getByTestId('player-modal')).not.toBeVisible();
  await page.getByTestId('player-selection-modal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByTestId(`team-remove-player-${secondId}`).click();
  await expect(page.getByTestId(`team-edit-player-${secondId}`)).toHaveCount(0);
  await expect(page.getByTestId('player-modal')).not.toBeVisible();
  expect(state.writes).toEqual([]);
});

test('failed profile loading shows unknown status and can be retried', async ({ page }) => {
  const state = await setupEditor(page, true);
  await expect(page.getByTestId(`team-player-photo-status-${firstId}`)).toHaveText('Image status unavailable');
  await expect(page.getByTestId('team-modal').getByText('No custom image', { exact: true })).toHaveCount(0);
  state.restoreProfiles();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId(`team-player-photo-status-${firstId}`)).toHaveText('Custom image set');
  expect(state.errors).toEqual([]);
});

test('new roster entries can open a prefilled editor before the team is saved', async ({ page }) => {
  const state = await setupEditor(page);
  const draftId = '76561198000000999';
  await page.getByTestId('team-steam-id-input').fill(draftId);
  await page.getByTestId('team-player-name-input').fill('New roster player');
  await page.getByTestId('team-add-player-button').click();
  await page.getByTestId(`team-edit-player-${draftId}`).click();
  await expect(page.getByTestId('player-name-input')).toHaveValue('New roster player');
  await page.getByTestId('player-name-input').fill('New edited player');
  await page.getByTestId('player-save-button').click();
  await expect(page.getByTestId('player-modal')).not.toBeVisible();
  await expect(page.getByTestId(`team-edit-player-${draftId}`)).toContainText('New edited player');
  expect(state.writes.map((write) => write.path)).toEqual(['/api/players']);
  expect(state.errors).toEqual([]);
});

test('compact layout stays inside the dialog and remains editable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setupEditor(page);
  const row = page.getByTestId(`team-edit-player-${firstId}`);
  await expect(row).toContainText('Puffch1k');
  await row.scrollIntoViewIfNeeded();
  const bounds = await row.evaluate((element) => {
    const dialog = element.closest('.MuiDialog-paper')!;
    const content = dialog.querySelector('.MuiDialogContent-root')!;
    return { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth };
  });
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
  await page.screenshot({ path: 'test-results/team-player-editor-mobile.png' });
  await row.click();
  await expect(page.getByTestId('player-modal')).toBeVisible();
  await cancelPlayer(page);
  expect(state.errors).toEqual([]);
});
