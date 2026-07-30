import { expect, test } from '@playwright/test';
import { matchExecutionLockService } from '../../api/src/services/matchExecutionLockService';

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
  'de_cache',
];
const TEST_SERVER_TOKEN = process.env.TEST_SERVER_TOKEN || 'server123';

test.describe.serial('Operator-controlled execution queue', () => {
  test.setTimeout(60_000);

  test('serializes execution-changing operations for the same match', async () => {
    let activeOperations = 0;
    let maximumConcurrentOperations = 0;
    const order: string[] = [];

    const operation = (name: string, delayMs: number) =>
      matchExecutionLockService.runExclusive('race-test-match', async () => {
        activeOperations += 1;
        maximumConcurrentOperations = Math.max(maximumConcurrentOperations, activeOperations);
        order.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        order.push(`${name}:end`);
        activeOperations -= 1;
      });

    await Promise.all([operation('prepare', 20), operation('postpone', 1)]);

    expect(maximumConcurrentOperations).toBe(1);
    expect(order).toEqual(['prepare:start', 'prepare:end', 'postpone:start', 'postpone:end']);
  });

  test('keeps bracket order while execution order changes to 1,3,4,2', async ({ page, request }) => {
    const loginResponse = await request.post('/api/test/login-admin', {
      data: { steamId: '76561198000000001' },
    });
    expect(loginResponse.ok(), await loginResponse.text()).toBeTruthy();

    const uploadedMapId = `de_operator_preview_${Date.now()}`;
    const createUploadedMap = await request.post('/api/maps', {
      data: { id: uploadedMapId, displayName: 'Operator Preview Test' },
    });
    expect(createUploadedMap.ok(), await createUploadedMap.text()).toBeTruthy();

    const uploadPreview = await request.post(`/api/maps/${uploadedMapId}/upload-image`, {
      data: {
        imageType: 'image/png',
        imageData:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
      },
    });
    expect(uploadPreview.ok(), await uploadPreview.text()).toBeTruthy();
    const uploadedPreviewBody = await uploadPreview.json();
    expect(uploadedPreviewBody.imageUrl).toBe(`/map-images/${uploadedMapId}.png`);

    const servedPreview = await request.get(uploadedPreviewBody.imageUrl);
    expect(servedPreview.ok(), await servedPreview.text()).toBeTruthy();
    expect(servedPreview.headers()['content-type']).toContain('image/png');

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

    const match1PlayerId = `7656119${String(0).padStart(10, '0')}`;
    const match2PlayerId = `7656119${String(20).padStart(10, '0')}`;

    const closedVeto = await request.get(`/api/veto/${match3.slug}`);
    expect(closedVeto.status()).toBe(423);

    // Hold is a non-destructive freeze: players must no longer see or act on
    // veto while the match is parked, but Resume must restore the same veto.
    const openMatch1Veto = await request.post(`/api/matches/${match1.slug}/operator-action`, {
      data: { action: 'open_veto' },
    });
    expect(openMatch1Veto.ok(), await openMatch1Veto.text()).toBeTruthy();

    const match1BeforeHold = await request.get(`/api/players/${match1PlayerId}/current-match`);
    expect(match1BeforeHold.ok(), await match1BeforeHold.text()).toBeTruthy();
    expect((await match1BeforeHold.json()).match?.slug).toBe(match1.slug);

    const holdResponse = await request.post(`/api/matches/${match1.slug}/operator-action`, {
      data: { action: 'hold' },
    });
    expect(holdResponse.ok(), await holdResponse.text()).toBeTruthy();

    const vetoWhileHeld = await request.get(`/api/veto/${match1.slug}`);
    expect(vetoWhileHeld.status()).toBe(423);

    const match1WhileHeld = await request.get(`/api/players/${match1PlayerId}/current-match`);
    expect(match1WhileHeld.ok(), await match1WhileHeld.text()).toBeTruthy();
    expect((await match1WhileHeld.json()).hasMatch).toBe(false);

    const resumeHeldResponse = await request.post(`/api/matches/${match1.slug}/operator-action`, {
      data: { action: 'resume' },
    });
    expect(resumeHeldResponse.ok(), await resumeHeldResponse.text()).toBeTruthy();

    const vetoAfterHoldResume = await request.get(`/api/veto/${match1.slug}`);
    expect(vetoAfterHoldResume.ok(), await vetoAfterHoldResume.text()).toBeTruthy();

    const openMatch2Veto = await request.post(`/api/matches/${match2.slug}/operator-action`, {
      data: { action: 'open_veto' },
    });
    expect(openMatch2Veto.ok(), await openMatch2Veto.text()).toBeTruthy();

    const postponeResponse = await request.post(`/api/matches/${match2.slug}/operator-action`, {
      data: { action: 'postpone' },
    });
    expect(postponeResponse.ok(), await postponeResponse.text()).toBeTruthy();

    const vetoWhilePostponed = await request.get(`/api/veto/${match2.slug}`);
    expect(vetoWhilePostponed.status()).toBe(423);

    const match2WhilePostponed = await request.get(`/api/players/${match2PlayerId}/current-match`);
    expect(match2WhilePostponed.ok(), await match2WhilePostponed.text()).toBeTruthy();
    expect((await match2WhilePostponed.json()).hasMatch).toBe(false);

    const reorderResponse = await request.patch('/api/matches/operator-queue', {
      data: { slugs: [match1.slug, match3.slug, match4.slug] },
    });
    expect(reorderResponse.ok(), await reorderResponse.text()).toBeTruthy();

    const resumeResponse = await request.post(`/api/matches/${match2.slug}/operator-action`, {
      data: { action: 'resume' },
    });
    expect(resumeResponse.ok(), await resumeResponse.text()).toBeTruthy();

    const vetoAfterPostponeResume = await request.get(`/api/veto/${match2.slug}`);
    expect(vetoAfterPostponeResume.ok(), await vetoAfterPostponeResume.text()).toBeTruthy();

    const match2AfterResume = await request.get(`/api/players/${match2PlayerId}/current-match`);
    expect(match2AfterResume.ok(), await match2AfterResume.text()).toBeTruthy();
    expect((await match2AfterResume.json()).match?.slug).toBe(match2.slug);

    // Reproduce the production report in an already-open player profile. The
    // operator match:update must force a silent refetch, removing the stale veto
    // card without a manual browser reload.
    const playerLoginResponse = await page.request.post('/api/test/login-player', {
      data: { steamId: match2PlayerId },
    });
    expect(playerLoginResponse.ok(), await playerLoginResponse.text()).toBeTruthy();

    await page.goto(
      `${process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:13071'}/player/${match2PlayerId}`
    );
    await expect(page.getByText('Map Selection', { exact: false })).toBeVisible();

    const postponeWhileProfileOpen = await request.post(
      `/api/matches/${match2.slug}/operator-action`,
      { data: { action: 'postpone' } }
    );
    expect(postponeWhileProfileOpen.ok(), await postponeWhileProfileOpen.text()).toBeTruthy();
    await expect(page.getByText('Map Selection', { exact: false })).toHaveCount(0);

    const resumeAfterProfileCheck = await request.post(
      `/api/matches/${match2.slug}/operator-action`,
      { data: { action: 'resume' } }
    );
    expect(resumeAfterProfileCheck.ok(), await resumeAfterProfileCheck.text()).toBeTruthy();

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
    const openVetoBody = await openVeto.json();
    expect(openVetoBody.maps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'de_cache',
          displayName: 'Cache',
          imageUrl: expect.stringContaining('/de_cache.webp'),
        }),
      ])
    );

    const browserLogin = await page.request.post('/api/test/login-admin', {
      data: { steamId: '76561198000000001' },
    });
    expect(browserLogin.ok(), await browserLogin.text()).toBeTruthy();
    await page.goto(`${process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:13071'}/matches`);
    await expect(page.getByTestId('operator-control-room')).toBeVisible();
    await expect(page.getByTestId('control-mode-select')).toContainText('Assisted');
    await expect(page.getByTestId(`operator-match-${match3.slug}`)).toContainText('Operator Team');

    // Race the final Hold with switching to Automatic. Whichever request enters
    // the global control-transition lock first, Automatic must finish with no
    // invisible parked match left behind.
    const [holdBeforeAutomatic, automaticResponse] = await Promise.all([
      request.post(`/api/matches/${match1.slug}/operator-action`, {
        data: { action: 'hold' },
      }),
      request.put('/api/tournament', {
        data: { settings: { controlMode: 'automatic' } },
      }),
    ]);
    expect([200, 409]).toContain(holdBeforeAutomatic.status());
    expect(automaticResponse.ok(), await automaticResponse.text()).toBeTruthy();

    const automaticMatchesResponse = await request.get('/api/matches');
    expect(automaticMatchesResponse.ok(), await automaticMatchesResponse.text()).toBeTruthy();
    const automaticMatchesBody = await automaticMatchesResponse.json();
    const automaticallyResumedMatch = (automaticMatchesBody.matches as OperatorMatch[]).find(
      (match) => match.slug === match1.slug
    );
    expect(automaticallyResumedMatch?.operatorState).toBe('queued');
    expect(automaticallyResumedMatch?.queuePosition).not.toBeNull();

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
