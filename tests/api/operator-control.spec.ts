import { expect, test } from '@playwright/test';

type OperatorMatch = {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  status: string;
  serverId?: string | null;
  operatorState?: 'queued' | 'postponed' | 'held';
  queuePosition?: number | null;
  vetoOpenedAt?: number | null;
};

const MAPS = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_train',
];
const TEST_SERVER_TOKEN = process.env.TEST_SERVER_TOKEN || 'server123';

test.describe.serial('Operator-controlled execution queue', () => {
  test('keeps bracket order while execution order changes to 1,3,4,2', async ({ page, request }) => {
    const loginResponse = await request.post('/api/test/login-admin', {
      data: { steamId: '76561198000000001' },
    });
    expect(loginResponse.ok(), await loginResponse.text()).toBeTruthy();

    const unauthenticatedEvent = await request.post('/api/events', { data: {} });
    expect(unauthenticatedEvent.status()).toBe(401);

    const authenticatedEvent = await request.post('/api/events', {
      headers: { 'x-matchzy-token': TEST_SERVER_TOKEN },
      data: {},
    });
    expect(authenticatedEvent.status()).toBe(400);

    await request.delete('/api/tournament');

    const stamp = Date.now().toString();
    const teamIds: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const id = `operator-${stamp}-${index + 1}`;
      const response = await request.post('/api/teams', {
        data: {
          id,
          name: `Operator Team ${index + 1}`,
          players: Array.from({ length: 5 }, (_, playerIndex) => ({
            steamId: `7656119${String(index * 10 + playerIndex).padStart(10, '0')}`,
            name: `Player ${index + 1}-${playerIndex + 1}`,
          })),
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      teamIds.push(id);
    }

    const createResponse = await request.post('/api/tournament', {
      data: {
        name: `Operator Queue ${stamp}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamIds,
        settings: { controlMode: 'assisted', seedingMethod: 'random' },
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBeTruthy();

    const startResponse = await request.post('/api/tournament/start');
    expect(startResponse.ok(), await startResponse.text()).toBeTruthy();

    const readMatches = async (): Promise<OperatorMatch[]> => {
      const response = await request.get('/api/matches');
      expect(response.ok(), await response.text()).toBeTruthy();
      const body = await response.json();
      expect(body.controlMode).toBe('assisted');
      return (body.matches as OperatorMatch[]).filter(
        (match) => match.round === 1 && match.status !== 'completed'
      );
    };

    await expect
      .poll(
        async () =>
          (await readMatches()).filter((match) => match.queuePosition != null).length,
        { timeout: 10_000, intervals: [100, 250, 500] }
      )
      .toBe(4);

    const initial = (await readMatches()).sort(
      (a, b) => (a.queuePosition ?? 999) - (b.queuePosition ?? 999)
    );
    expect(initial).toHaveLength(4);
    expect(initial.map((match) => match.queuePosition)).toEqual([1, 2, 3, 4]);
    expect(initial.every((match) => !match.serverId)).toBe(true);

    const [match1, match2, match3, match4] = initial;

    const closedVeto = await request.get(`/api/veto/${match3.slug}`);
    expect(closedVeto.status()).toBe(423);

    const postponeResponse = await request.post(`/api/matches/${match2.slug}/operator-action`, {
      data: { action: 'postpone' },
    });
    expect(postponeResponse.ok(), await postponeResponse.text()).toBeTruthy();

    const reorderResponse = await request.patch('/api/matches/operator-queue', {
      data: { slugs: [match1.slug, match3.slug, match4.slug] },
    });
    expect(reorderResponse.ok(), await reorderResponse.text()).toBeTruthy();

    const resumeResponse = await request.post(`/api/matches/${match2.slug}/operator-action`, {
      data: { action: 'resume' },
    });
    expect(resumeResponse.ok(), await resumeResponse.text()).toBeTruthy();

    const reordered = (await readMatches()).sort(
      (a, b) => (a.queuePosition ?? 999) - (b.queuePosition ?? 999)
    );
    expect(reordered.map((match) => match.slug)).toEqual([
      match1.slug,
      match3.slug,
      match4.slug,
      match2.slug,
    ]);
    expect(reordered.map((match) => match.queuePosition)).toEqual([1, 2, 3, 4]);

    const openVetoResponse = await request.post(`/api/matches/${match3.slug}/operator-action`, {
      data: { action: 'open_veto' },
    });
    expect(openVetoResponse.ok(), await openVetoResponse.text()).toBeTruthy();

    const openVeto = await request.get(`/api/veto/${match3.slug}`);
    expect(openVeto.ok(), await openVeto.text()).toBeTruthy();

    const browserLogin = await page.request.post('/api/test/login-admin', {
      data: { steamId: '76561198000000001' },
    });
    expect(browserLogin.ok(), await browserLogin.text()).toBeTruthy();
    await page.goto(`${process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:13071'}/matches`);
    await expect(page.getByTestId('operator-control-room')).toBeVisible();
    await expect(page.getByTestId('control-mode-select')).toContainText('Assisted');
    await expect(page.getByTestId(`operator-match-${match3.slug}`)).toContainText('Operator Team');

    const automaticResponse = await request.put('/api/tournament', {
      data: { settings: { controlMode: 'automatic' } },
    });
    expect(automaticResponse.ok(), await automaticResponse.text()).toBeTruthy();

    const automaticAction = await request.post(`/api/matches/${match1.slug}/operator-action`, {
      data: { action: 'hold' },
    });
    expect(automaticAction.status()).toBe(409);

    const automaticReorder = await request.patch('/api/matches/operator-queue', {
      data: { slugs: reordered.map((match) => match.slug) },
    });
    expect(automaticReorder.status()).toBe(409);

    await page.reload();
    await expect(page.getByTestId('control-mode-select')).toContainText('Automatic');
    await expect(page.getByTestId('operator-queue')).toHaveCount(0);
  });
});
