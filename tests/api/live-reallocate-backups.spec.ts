import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';

const SERVER_HEADERS = {
  'Content-Type': 'application/octet-stream',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

test.describe.serial('Live reallocation round backups', () => {
  test('keeps named round backups available until the target confirms their import', async ({ page, request }) => {
    await setupTestContext(page, request);
    const setup = await setupTournament(request, { prefix: 'live-backups' });
    expect(setup).toBeTruthy();

    const match = await findMatchByTeams(request, setup!.teams[0].id, setup!.teams[1].id);
    expect(match?.slug).toBeTruthy();
    expect(match?.id).toBeTruthy();

    const backup = JSON.stringify({ matchid: String(match!.id), round: '07', valve_backup: 'native-state' });
    const checkpoint = await request.post(`/api/matches/${match!.slug}/live-reallocation-state`, {
      headers: SERVER_HEADERS,
      data: Buffer.from(backup),
    });
    expect(checkpoint.ok(), await checkpoint.text()).toBe(true);

    const fileName = `matchzy_${match!.id}_0_round07.json`;
    const uploaded = await request.post(`/api/matches/${match!.slug}/live-reallocation-backups`, {
      headers: { ...SERVER_HEADERS, 'MatchZy-FileName': fileName },
      data: Buffer.from(backup),
    });
    expect(uploaded.ok(), await uploaded.text()).toBe(true);

    const bundle = await request.get(`/api/matches/${match!.slug}/live-reallocation-backups`, {
      headers: { 'X-MatchZy-Token': SERVER_HEADERS['X-MatchZy-Token'] },
    });
    expect(bundle.ok(), await bundle.text()).toBe(true);
    expect(await bundle.json()).toMatchObject({
      matchid: match!.id,
      backups: [{ fileName, content: backup }],
    });

    const confirmed = await request.post(
      `/api/matches/${match!.slug}/live-reallocation-backups/imported`,
      {
        headers: { 'Content-Type': 'application/json', 'X-MatchZy-Token': SERVER_HEADERS['X-MatchZy-Token'] },
        data: { matchid: match!.id, imported: 1 },
      }
    );
    expect(confirmed.ok(), await confirmed.text()).toBe(true);
  });
});
