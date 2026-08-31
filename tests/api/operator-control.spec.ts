import { expect, test } from '@playwright/test';
import { io as createSocket } from 'socket.io-client';
import { db } from '../../api/src/config/database';
import { matchExecutionLockService } from '../../api/src/services/matchExecutionLockService';
import { recordMapResult } from '../../api/src/services/matchMapResultService';
import { matchAllocationService } from '../../api/src/services/matchAllocationService';
import { serverAllocationTracker } from '../../api/src/services/serverAllocationTracker';
import { tournamentService } from '../../api/src/services/tournamentService';
import type { ServerResponse } from '../../api/src/types/server.types';

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
  team1?: { id: string; name: string } | null;
  team2?: { id: string; name: string } | null;
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

  test('releases the allocation tracker after a failed match load', async () => {
    const stamp = Date.now();
    const matchSlug = `allocation-cleanup-${stamp}`;
    const serverId = `allocation-cleanup-server-${stamp}`;
    const now = Math.floor(stamp / 1000);

    await db.insertAsync('servers', {
      id: serverId,
      name: 'Allocation cleanup test server',
      host: '127.0.0.1',
      port: 1,
      password: 'test-only-invalid-rcon',
      enabled: 1,
      created_at: now,
      updated_at: now,
    });
    await db.insertAsync('matches', {
      slug: matchSlug,
      tournament_id: null,
      round: 0,
      match_number: 1,
      config: JSON.stringify({ matchid: matchSlug, maplist: ['de_cache'] }),
      status: 'ready',
      operator_state: 'queued',
      created_at: now,
    });

    const candidate: ServerResponse = {
      id: serverId,
      name: 'Allocation cleanup test server',
      host: '127.0.0.1',
      port: 1,
      password: 'test-only-invalid-rcon',
      enabled: true,
      matchzyConfig: null,
      created_at: now,
      updated_at: now,
    };
    const service = matchAllocationService as unknown as {
      getAvailableServers: () => Promise<ServerResponse[]>;
      allocateSingleMatch: (
        slug: string,
        baseUrl: string
      ) => Promise<{ success: boolean; error?: string }>;
    };
    const originalGetAvailableServers = service.getAvailableServers.bind(matchAllocationService);
    service.getAvailableServers = async () => [candidate];

    try {
      const result = await service.allocateSingleMatch(matchSlug, 'http://127.0.0.1:1');
      expect(result.success).toBe(false);
      expect(serverAllocationTracker.getState(serverId)?.state).toBe('idle');
      const storedMatch = await db.queryOneAsync<{ server_id: string | null }>(
        'SELECT server_id FROM matches WHERE slug = ?',
        [matchSlug]
      );
      expect(storedMatch?.server_id).toBeNull();
    } finally {
      service.getAvailableServers = originalGetAvailableServers;
      await db.deleteAsync('matches', 'slug = ?', [matchSlug]);
      await db.deleteAsync('servers', 'id = ?', [serverId]);
    }
  });

  test('clears stale server allocations when a tournament is deleted', async () => {
    const serverId = `deleted-tournament-server-${Date.now()}`;
    serverAllocationTracker.markAllocated(serverId, 'deleted-active-match');

    await tournamentService.deleteTournament();

    expect(serverAllocationTracker.getState(serverId)).toBeNull();
  });

  test('does not release an allocation owned by another match', () => {
    const serverId = `allocation-owner-server-${Date.now()}`;
    serverAllocationTracker.markAllocated(serverId, 'new-successful-match');

    expect(serverAllocationTracker.markIdleIfOwned(serverId, 'old-failed-match')).toBe(false);
    expect(serverAllocationTracker.getState(serverId)).toMatchObject({
      state: 'allocated',
      matchSlug: 'new-successful-match',
    });
    expect(serverAllocationTracker.markIdleIfOwned(serverId, 'new-successful-match')).toBe(true);
    expect(serverAllocationTracker.getState(serverId)?.state).toBe('idle');
  });

  test('rejects completed matches as manual HUD broadcasts', async ({ request }) => {
    const slug = `completed-hud-broadcast-${Date.now()}`;
    await request.post('/api/test/login-admin', {
      data: { steamId: '76561198000000001' },
    });
    await db.insertAsync('matches', {
      slug,
      round: 0,
      match_number: 1,
      config: JSON.stringify({
        team1: { name: 'Completed Team 1' },
        team2: { name: 'Completed Team 2' },
      }),
      status: 'completed',
      completed_at: Math.floor(Date.now() / 1000),
    });

    try {
      const response = await request.put('/api/integrations/jts-hud/broadcast-match', {
        data: { slug },
      });
      expect(response.status()).toBe(409);
      expect((await response.json()).error).toContain('cannot be selected');
    } finally {
      await db.deleteAsync('matches', 'slug = ?', [slug]);
      await request.put('/api/integrations/jts-hud/broadcast-match', { data: { slug: null } });
    }
  });

  test('keeps bracket order while execution order changes to 1,3,4,2', async ({
    browser,
    page,
    request,
  }) => {
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

    // Regression: CS2 reports GamePhase=postgame after every completed map.
    // MatchZy Enhanced exposes that in match reports, but it is only the
    // inter-map state of a BO3, not a completed series.
    const bo3GuardSlug = `bo3-series-guard-${Date.now()}`;
    const createBo3Guard = await request.post('/api/matches', {
      data: {
        slug: bo3GuardSlug,
        config: {
          matchid: bo3GuardSlug,
          num_maps: 3,
          maplist: ['de_nuke', 'de_dust2', 'de_anubis'],
          team1: { name: 'Guard Team 1', players: {} },
          team2: { name: 'Guard Team 2', players: {} },
        },
      },
    });
    expect(createBo3Guard.ok(), await createBo3Guard.text()).toBeTruthy();

    // Exact MatchZy Enhanced payload captured from production match r1m1 / #36:
    // Map 0 ends 3-0, while the BO3 series is only 1-0. This must advance to
    // the next map, not mark the match or tournament completed.
    const productionMapResult = await request.post('/api/events', {
      headers: { 'x-matchzy-token': TEST_SERVER_TOKEN },
      data: {
        event: 'map_result',
        matchid: bo3GuardSlug,
        map_number: 0,
        winner: { side: '2', team: 'team1' },
        team1: { series_score: 1, score: 3, score_ct: 0, score_t: 0, players: [] },
        team2: { series_score: 0, score: 0, score_ct: 0, score_t: 0, players: [] },
      },
    });
    expect(productionMapResult.ok(), await productionMapResult.text()).toBeTruthy();
    const afterProductionMapResult = await request.get(`/api/matches/${bo3GuardSlug}`);
    expect(afterProductionMapResult.ok(), await afterProductionMapResult.text()).toBeTruthy();
    expect((await afterProductionMapResult.json()).match.status).not.toBe('completed');

    const interMapPostgameReport = await request.post('/api/events/report', {
      headers: { 'x-matchzy-token': TEST_SERVER_TOKEN },
      data: {
        serverId: `test-server-${bo3GuardSlug}`,
        matchSlug: bo3GuardSlug,
        report: {
          match: {
            phase: 'postgame',
            map: { index: 0, total: 3 },
            score: { team1: 3, team2: 0, series: { team1: 1, team2: 0 } },
          },
        },
      },
    });
    expect(interMapPostgameReport.ok(), await interMapPostgameReport.text()).toBeTruthy();
    const afterInterMapPostgame = await request.get(`/api/matches/${bo3GuardSlug}`);
    expect(afterInterMapPostgame.ok(), await afterInterMapPostgame.text()).toBeTruthy();
    expect((await afterInterMapPostgame.json()).match.status).not.toBe('completed');

    await request.delete(`/api/matches/${bo3GuardSlug}`);
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

    const broadcastPlayerId = `7656119${String(0).padStart(10, '0')}`;
    const updateBroadcastPlayer = await request.put(`/api/players/${broadcastPlayerId}`, {
      data: {
        name: 'aurum',
        firstName: 'Aurimas',
        lastName: 'Operator',
        countryCode: 'LT',
      },
    });
    expect(updateBroadcastPlayer.ok(), await updateBroadcastPlayer.text()).toBeTruthy();

    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=';
    const uploadPlayerPhoto = await request.post(`/api/players/${broadcastPlayerId}/photo`, {
      data: { imageData: tinyPng },
    });
    expect(uploadPlayerPhoto.ok(), await uploadPlayerPhoto.text()).toBeTruthy();

    const firstTeam = await request.get(`/api/teams/${teamIds[0]}`);
    const firstTeamBody = await firstTeam.json();
    const updateBroadcastTeam = await request.put(`/api/teams/${teamIds[0]}`, {
      data: {
        name: firstTeamBody.team.name,
        tag: 'AUR',
        countryCode: 'LT',
        players: firstTeamBody.team.players,
      },
    });
    expect(updateBroadcastTeam.ok(), await updateBroadcastTeam.text()).toBeTruthy();
    const uploadTeamLogo = await request.post(`/api/teams/${teamIds[0]}/logo`, {
      data: { imageData: tinyPng },
    });
    expect(uploadTeamLogo.ok(), await uploadTeamLogo.text()).toBeTruthy();

    const createResponse = await request.post('/api/tournament', {
      data: {
        name: `Operator Queue ${stamp}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamIds,
        settings: {
          controlMode: 'assisted',
          autoPrepareNextMatch: false,
          seedingMethod: 'random',
        },
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
        async () => (await readMatches()).filter((match) => match.queuePosition != null).length,
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
    const profileMatch = initial.find(
      (match) => match.team1?.id === teamIds[0] || match.team2?.id === teamIds[0]
    );
    expect(profileMatch).toBeTruthy();

    const match1PlayerId = `7656119${String(0).padStart(10, '0')}`;
    const match2PlayerId = `7656119${String(20).padStart(10, '0')}`;
    const playerIdForTeam = (teamId: string): string => {
      const teamIndex = teamIds.indexOf(teamId);
      if (teamIndex < 0) throw new Error(`Unknown operator test team: ${teamId}`);
      return `7656119${String(teamIndex * 10).padStart(10, '0')}`;
    };

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

    // Reproduce the production Open Veto report with the player page already
    // open. The 423 waiting state must become an interactive veto without F5.
    const match3PlayerId = playerIdForTeam(match3.team1!.id);
    const match3PlayerLogin = await page.request.post('/api/test/login-player', {
      data: { steamId: match3PlayerId },
    });
    expect(match3PlayerLogin.ok(), await match3PlayerLogin.text()).toBeTruthy();
    await page.goto(
      `${process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:13071'}/player/${match3PlayerId}`
    );
    await expect(
      page.getByText('Veto is waiting for the tournament operator to open it.', { exact: false })
    ).toBeVisible();
    await page.evaluate(() => {
      (window as typeof window & { __operatorRealtimeMarker?: string }).__operatorRealtimeMarker =
        'page-was-not-reloaded';
    });

    const closedMatchStatus = await page.request.get('/api/players/me/match-status');
    expect(closedMatchStatus.ok(), await closedMatchStatus.text()).toBeTruthy();
    expect((await closedMatchStatus.json()).status).toBe('none');

    const openVetoResponse = await request.post(`/api/matches/${match3.slug}/operator-action`, {
      data: { action: 'open_veto' },
    });
    expect(openVetoResponse.ok(), await openVetoResponse.text()).toBeTruthy();

    await expect(
      page.getByText('Veto is waiting for the tournament operator to open it.', { exact: false })
    ).toHaveCount(0);
    await expect(page.getByText('Cache', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __operatorRealtimeMarker?: string }).__operatorRealtimeMarker
      )
    ).toBe('page-was-not-reloaded');

    const match3ApiPlayerLogin = await request.post('/api/test/login-player', {
      data: { steamId: match3PlayerId },
    });
    expect(match3ApiPlayerLogin.ok(), await match3ApiPlayerLogin.text()).toBeTruthy();
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
    const currentBroadcastVeto = await request.get('/api/integrations/jts-hud/broadcast-veto');
    expect(currentBroadcastVeto.ok(), await currentBroadcastVeto.text()).toBeTruthy();
    expect((await currentBroadcastVeto.json()).veto.matchSlug).toBe(match3.slug);

    // The OBS browser source is public and read-only. It must render the same
    // authoritative veto state as the player page, then receive player actions
    // through Socket.IO without a page reload.
    const broadcastContext = await browser.newContext();
    const broadcastPage = await broadcastContext.newPage();
    await broadcastPage.goto(
      `${process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:13071'}/broadcast/veto`
    );
    await expect(broadcastPage.getByTestId('broadcast-veto-show')).toBeVisible();
    await expect(broadcastPage.getByTestId('broadcast-veto-map-de_cache')).toBeVisible();
    await expect(broadcastPage.getByRole('button')).toHaveCount(0);
    await broadcastPage.evaluate(() => {
      (window as typeof window & { __broadcastVetoRealtimeMarker?: string }).__broadcastVetoRealtimeMarker =
        'obs-page-was-not-reloaded';
    });

    // Drop the Socket.IO connection before the first action. The overlay must
    // recover from its own reconnect with an authoritative GET, not by reloading
    // the browser source or relying on the missed event being replayed.
    await broadcastContext.setOffline(true);
    await broadcastPage.waitForTimeout(250);

    // Keep Operator Control Room open while the players finish veto. The match
    // must transition to READY and expose Prepare without an operator reload.
    const pageAdminLogin = await page.request.post('/api/test/login-admin', {
      data: { steamId: '76561198000000001' },
    });
    expect(pageAdminLogin.ok(), await pageAdminLogin.text()).toBeTruthy();
    await page.goto(`${process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:13071'}/matches`);
    const operatorMatch3 = page.getByTestId(`operator-match-${match3.slug}`);
    await expect(operatorMatch3).toBeVisible();
    await expect(operatorMatch3.getByRole('button', { name: 'Prepare' })).toHaveCount(0);

    let vetoState = openVetoBody.veto as {
      status: string;
      currentTurn: 'team1' | 'team2';
      currentAction: 'ban' | 'pick' | 'side_pick';
      availableMaps: string[];
    };
    let broadcastReceivedFirstAction = false;
    while (vetoState.status !== 'completed') {
      const actingTeamId =
        vetoState.currentTurn === 'team1' ? match3.team1!.id : match3.team2!.id;
      const actingPlayerLogin = await request.post('/api/test/login-player', {
        data: { steamId: playerIdForTeam(actingTeamId) },
      });
      expect(actingPlayerLogin.ok(), await actingPlayerLogin.text()).toBeTruthy();

      const actionResponse = await request.post(`/api/veto/${match3.slug}/action`, {
        data:
          vetoState.currentAction === 'side_pick'
            ? { side: 'CT', teamSlug: actingTeamId }
            : { mapName: vetoState.availableMaps[0], teamSlug: actingTeamId },
      });
      expect(actionResponse.ok(), await actionResponse.text()).toBeTruthy();
      vetoState = (await actionResponse.json()).veto;
      if (!broadcastReceivedFirstAction) {
        await broadcastContext.setOffline(false);
        await expect(broadcastPage.getByText('BAN', { exact: true })).toBeVisible();
        expect(
          await broadcastPage.evaluate(
            () =>
              (window as typeof window & { __broadcastVetoRealtimeMarker?: string })
                .__broadcastVetoRealtimeMarker
          )
        ).toBe('obs-page-was-not-reloaded');
        broadcastReceivedFirstAction = true;
      }
    }

    await expect(operatorMatch3).toContainText('Prepare');

    const unauthenticatedProjection = await request.get('/api/integrations/jts-hud/v1/current');
    expect(unauthenticatedProjection.status()).toBe(401);

    const tokenResponse = await request.post('/api/integrations/jts-hud/token', { data: {} });
    expect(tokenResponse.ok(), await tokenResponse.text()).toBeTruthy();
    const hudToken = (await tokenResponse.json()).token as string;
    expect(hudToken).toMatch(/^mat_hud_/);

    const selectBroadcast = await request.put('/api/integrations/jts-hud/broadcast-match', {
      data: { slug: match3.slug },
    });
    expect(selectBroadcast.ok(), await selectBroadcast.text()).toBeTruthy();

    const projectionResponse = await request.get('/api/integrations/jts-hud/v1/current', {
      headers: { Authorization: `Bearer ${hudToken}` },
    });
    expect(projectionResponse.ok(), await projectionResponse.text()).toBeTruthy();
    const projection = await projectionResponse.json();
    expect(projection.contract).toBe('bebraland-mat-hud');
    expect(projection.version).toBe(1);
    expect(projection.match.slug).toBe(match3.slug);
    expect(projection.match.status).toBe('veto');
    expect(projection.match.seriesScore).toEqual({ team1: 0, team2: 0 });
    expect(projection.match.veto.status).toBe('completed');

    await recordMapResult({
      matchSlug: profileMatch!.slug,
      mapNumber: 0,
      mapName: 'de_ancient',
      team1Score: 13,
      team2Score: 8,
      winnerTeam: 'team1',
    });
    await db.updateAsync('matches', { current_map: 'de_ancient', map_number: 0 }, 'slug = ?', [
      profileMatch!.slug,
    ]);
    const profileProjectionResponse = await request.get(
      `/api/integrations/jts-hud/v1/matches/${profileMatch!.slug}`,
      { headers: { Authorization: `Bearer ${hudToken}` } }
    );
    expect(profileProjectionResponse.ok(), await profileProjectionResponse.text()).toBeTruthy();
    const profileProjection = await profileProjectionResponse.json();
    expect(profileProjection.match.currentMap).toBe('de_ancient');
    expect(profileProjection.match.currentMapNumber).toBe(1);
    expect(profileProjection.match.maps[0]).toEqual(
      expect.objectContaining({
        number: 1,
        name: 'de_ancient',
        score: { team1: 13, team2: 8 },
        winnerTeamId: profileMatch!.team1!.id,
      })
    );
    expect(profileProjection.match.seriesScore).toEqual({ team1: 1, team2: 0 });
    expect([profileProjection.match.team1, profileProjection.match.team2]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: teamIds[0],
          tag: 'AUR',
          countryCode: 'LT',
          logoUrl: expect.stringContaining(`/broadcast-assets/teams/${teamIds[0]}.png`),
          players: expect.arrayContaining([
            expect.objectContaining({
              steamId: broadcastPlayerId,
              nickname: 'aurum',
              firstName: 'Aurimas',
              lastName: 'Operator',
              countryCode: 'LT',
              photoUrl: expect.stringContaining(
                `/broadcast-assets/players/${broadcastPlayerId}.png`
              ),
            }),
          ]),
        }),
      ])
    );

    const holdSelectedBroadcast = await request.post(
      `/api/matches/${match3.slug}/operator-action`,
      { data: { action: 'hold' } }
    );
    expect(holdSelectedBroadcast.ok(), await holdSelectedBroadcast.text()).toBeTruthy();
    const parkedBroadcastProjection = await request.get('/api/integrations/jts-hud/v1/current', {
      headers: { Authorization: `Bearer ${hudToken}` },
    });
    expect(parkedBroadcastProjection.ok(), await parkedBroadcastProjection.text()).toBeTruthy();
    expect((await parkedBroadcastProjection.json()).match).toBeNull();
    const resumeSelectedBroadcast = await request.post(
      `/api/matches/${match3.slug}/operator-action`,
      { data: { action: 'resume' } }
    );
    expect(resumeSelectedBroadcast.ok(), await resumeSelectedBroadcast.text()).toBeTruthy();

    const hudSocket = createSocket(
      `${process.env.API_BASE_URL || 'http://127.0.0.1:13070'}/jts-hud`,
      {
        auth: { token: hudToken },
        transports: ['websocket'],
      }
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('HUD socket connection timed out')), 5000);
      hudSocket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      hudSocket.once('connect_error', reject);
    });
    const disconnectedAfterRotation = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Old HUD socket was not disconnected')),
        5000
      );
      hudSocket.once('disconnect', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    const rotateTokenResponse = await request.post('/api/integrations/jts-hud/token', { data: {} });
    expect(rotateTokenResponse.ok(), await rotateTokenResponse.text()).toBeTruthy();
    await disconnectedAfterRotation;
    hudSocket.close();

    const oldTokenProjection = await request.get('/api/integrations/jts-hud/v1/current', {
      headers: { Authorization: `Bearer ${hudToken}` },
    });
    expect(oldTokenProjection.status()).toBe(401);

    const browserLogin = await page.request.post('/api/test/login-admin', {
      data: { steamId: '76561198000000001' },
    });
    expect(browserLogin.ok(), await browserLogin.text()).toBeTruthy();
    await page.goto(`${process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:13071'}/matches`);
    await expect(page.getByTestId('operator-control-room')).toBeVisible();
    await expect(page.getByTestId('hud-integration-panel')).toBeVisible();
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

    const deleteTournamentWithBroadcastOpen = await request.delete('/api/tournament');
    expect(
      deleteTournamentWithBroadcastOpen.ok(),
      await deleteTournamentWithBroadcastOpen.text()
    ).toBeTruthy();
    await expect(broadcastPage.getByTestId('broadcast-veto-standby')).toBeVisible();
    expect(
      await broadcastPage.evaluate(() =>
        (window as typeof window & { __broadcastVetoRealtimeMarker?: string })
          .__broadcastVetoRealtimeMarker
      )
    ).toBe('obs-page-was-not-reloaded');
    await broadcastContext.close();
  });
});
