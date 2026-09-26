import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest, impersonatePlayer, stopImpersonating } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { actingSteamIdFor } from '../helpers/veto';
import type { Team } from '../helpers/teams';

/** An assigned server must not expose connect controls until CS2 confirms its map. */
test.describe.serial('Assigned server on the player page', () => {
  test.setTimeout(120000);

  let team1: Team;
  let team2: Team;

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    await signInViaRequest(request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
      teamCount: 2,
      serverCount: 1,
      prefix: 'assigned',
    });
    expect(setup).toBeTruthy();
    [team1, team2] = [setup!.teams[0], setup!.teams[1]];

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();

    const state = await request.post('/api/test/match-state', {
      data: { slug: match!.slug, serverId: setup!.servers[0].id, status: 'loaded' },
    });
    expect(state.ok()).toBe(true);
  });

  test.afterEach(async ({ page, request }) => {
    await stopImpersonating(page.request);
    await stopImpersonating(request);
  });

  test(
    'hides connect details for an assigned server still reporting idle',
    { tag: ['@ui', '@regression'] },
    async ({ page }) => {
      const steamId = actingSteamIdFor(team1);
      expect(await impersonatePlayer(page.request, steamId)).toBe(true);

      await page.goto(`/player/${steamId}`, { waitUntil: 'domcontentloaded' });

      await expect(page.getByText(/Preparing CS2 server and map/i)).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByRole('button', { name: /Copy Console Command/i })).toHaveCount(0);
      await expect(page.getByText(/Waiting for Server Assignment/i)).toHaveCount(0);
    }
  );
});
