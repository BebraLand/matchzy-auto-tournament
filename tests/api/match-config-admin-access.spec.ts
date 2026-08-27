import { expect, test } from '@playwright/test';
import { playerService } from '../../api/src/services/playerService';
import { applyAdminMatchAccess } from '../../api/src/services/matchConfigAccessService';
import type { MatchConfig } from '../../api/src/types/match.types';

test.describe.serial('Match config admin access', () => {
  const playingAdminId = '76561198000910001';
  const observingAdminId = '76561198000910002';
  const explicitSpectatorId = '76561198000910003';
  const persistentSpectatorId = '76561198000910005';

  test.beforeEach(async () => {
    await Promise.all([
      playerService.deletePlayer(playingAdminId),
      playerService.deletePlayer(observingAdminId),
      playerService.deletePlayer(explicitSpectatorId),
      playerService.deletePlayer(persistentSpectatorId),
    ]);

    await playerService.createPlayer({ id: playingAdminId, name: 'Playing Admin', isAdmin: true });
    await playerService.createPlayer({ id: observingAdminId, name: 'Observing Admin', isAdmin: true });
    await playerService.createPlayer({ id: explicitSpectatorId, name: 'Guest Caster' });
    await playerService.createPlayer({ id: persistentSpectatorId, name: 'Persistent Caster', isSpectator: true });
  });

  test.afterEach(async () => {
    await Promise.all([
      playerService.deletePlayer(playingAdminId),
      playerService.deletePlayer(observingAdminId),
      playerService.deletePlayer(explicitSpectatorId),
      playerService.deletePlayer(persistentSpectatorId),
    ]);
  });

  test('adds non-playing admins as spectators without duplicating rostered admins', async () => {
    const config: MatchConfig = {
      matchid: 910001,
      skip_veto: true,
      players_per_team: 1,
      num_maps: 1,
      maplist: ['de_cache'],
      team1: {
        name: 'Admin Players',
        players: { [playingAdminId]: 'Playing Admin' },
      },
      team2: {
        name: 'Opponents',
        players: { '76561198000910004': 'Opponent' },
      },
      spectators: {
        players: {
          [explicitSpectatorId]: 'Guest Caster',
          [playingAdminId]: 'Stale duplicate role',
        },
      },
    };

    await applyAdminMatchAccess(config);

    expect(config.admins).toEqual(expect.arrayContaining([playingAdminId, observingAdminId]));
    expect(config.spectators?.players).toEqual(expect.objectContaining({
      [explicitSpectatorId]: 'Guest Caster',
      [observingAdminId]: 'Observing Admin',
      [persistentSpectatorId]: 'Persistent Caster',
    }));
    expect(config.spectators?.players).not.toHaveProperty(playingAdminId);
  });

  test('recognizes a playing admin in a manual-match player array', async () => {
    const config = {
      matchid: 910002,
      skip_veto: true,
      players_per_team: 1,
      num_maps: 1,
      maplist: ['de_cache'],
      team1: {
        name: 'Admin Players',
        players: [{ steamid: playingAdminId, name: 'Playing Admin' }],
      },
      team2: {
        name: 'Opponents',
        players: [{ steamId: '76561198000910004', name: 'Opponent' }],
      },
      spectators: { players: {} },
    } as unknown as MatchConfig;

    await applyAdminMatchAccess(config);

    expect(config.spectators?.players).toEqual(expect.objectContaining({
      [observingAdminId]: 'Observing Admin',
    }));
    expect(config.spectators?.players).not.toHaveProperty(playingAdminId);
  });

  test('does not persist computed admin spectators in a stored manual config', async () => {
    const config: MatchConfig = {
      matchid: 910003,
      skip_veto: true,
      players_per_team: 1,
      num_maps: 1,
      maplist: ['de_cache'],
      team1: { name: 'Team 1', players: {} },
      team2: { name: 'Team 2', players: {} },
      spectators: {
        players: { [explicitSpectatorId]: 'Guest Caster' },
      },
    };

    await applyAdminMatchAccess(config, { addAdminSpectators: false });

    expect(config.admins).toEqual(expect.arrayContaining([playingAdminId, observingAdminId]));
    expect(config.spectators?.players).toEqual({
      [explicitSpectatorId]: 'Guest Caster',
    });
  });
});
