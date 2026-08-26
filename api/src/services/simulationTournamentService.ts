import { db } from '../config/database';
import { log } from '../utils/logger';
import { teamService } from './teamService';
import { tournamentService } from './tournamentService';


const MIN_TEAM_COUNT = 2;
const MAX_TEAM_COUNT = 16;
const MIN_PLAYERS_PER_TEAM = 1;
const MAX_PLAYERS_PER_TEAM = 5;

const COUNTRIES = ['LT', 'LV', 'EE', 'FI', 'SE', 'PL', 'DE', 'FR', 'NL', 'US'];
const TEAM_PREFIXES = ['Neon', 'Silent', 'Quantum', 'Iron', 'Polar', 'Rapid', 'Crimson', 'Nova'];
const TEAM_SUFFIXES = ['Wolves', 'Foxes', 'Orbit', 'Forge', 'Ravens', 'Pulse', 'Core', 'Drift'];
const FIRST_NAMES = [
  'Alex',
  'Mika',
  'Jonas',
  'Lukas',
  'Noah',
  'Erik',
  'Mantas',
  'Emil',
  'Dario',
  'Nils',
  'Oskar',
  'Tomas',
];
const LAST_NAMES = [
  'Vale',
  'Kern',
  'Nox',
  'Ryder',
  'Stone',
  'Voss',
  'Kite',
  'Ray',
  'Marlow',
  'Vega',
  'North',
  'Kovac',
];
const NICKNAMES = [
  'Blitz',
  'Ghost',
  'Maverick',
  'Pulse',
  'Rook',
  'Frost',
  'Zero',
  'Viper',
  'Sparks',
  'Drift',
  'Echo',
  'Orbit',
];


function hash(seed: string): number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function pick<T>(items: T[], seed: string, index: number): T {
  return items[hash(`${seed}:${index}`) % items.length];
}

function steamId(seed: string, teamIndex: number, playerIndex: number): string {
  const numeric = (hash(`${seed}:steam:${teamIndex}:${playerIndex}`) % 10_000_000_000)
    .toString()
    .padStart(10, '0');
  return `7656119${numeric}`;
}

function avatar(seed: string): string {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}

class SimulationTournamentService {
  async discardTeams(teamIds: string[]): Promise<void> {
    const requestedIds = teamIds.filter((id) => id.startsWith('simulation-'));
    const where = requestedIds.length
      ? `id IN (${requestedIds.map(() => '?').join(',')})`
      : "id LIKE 'simulation-%'";
    const params = requestedIds.length ? requestedIds : [];
    const teams = await db.queryAsync<{ id: string; players: string }>(
      `SELECT id, players FROM teams WHERE ${where}`,
      params
    );
    const playerIds = teams.flatMap((team) => {
      try {
        return (JSON.parse(team.players) as Array<{ steamId?: string }>)
          .map((player) => player.steamId)
          .filter((steamId): steamId is string => Boolean(steamId));
      } catch {
        return [];
      }
    });

    if (playerIds.length > 0) {
      await db.deleteAsync(
        'players',
        `id IN (${playerIds.map(() => '?').join(',')})`,
        playerIds
      );
    }
    if (teams.length > 0) {
      await db.deleteAsync('teams', where, params);
    }
  }

  async createTeams(
    teamCount: number,
    playersPerTeam: number,
  ): Promise<{ teamIds: string[] }> {
    if (!Number.isInteger(teamCount) || teamCount < MIN_TEAM_COUNT || teamCount > MAX_TEAM_COUNT) {
      throw new Error(`Simulation supports ${MIN_TEAM_COUNT}-${MAX_TEAM_COUNT} teams.`);
    }
    if (
      !Number.isInteger(playersPerTeam) ||
      playersPerTeam < MIN_PLAYERS_PER_TEAM ||
      playersPerTeam > MAX_PLAYERS_PER_TEAM
    ) {
      throw new Error(
        `Simulation supports ${MIN_PLAYERS_PER_TEAM}-${MAX_PLAYERS_PER_TEAM} players per team.`
      );
    }

    const current = await tournamentService.getTournament();
    const active = await db.queryOneAsync<{ slug: string }>(
      "SELECT slug FROM matches WHERE status IN ('loaded', 'live') LIMIT 1"
    );
    if (active) {
      throw new Error(`Cannot replace tournament while match '${active.slug}' is loaded or live.`);
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const teamIds: string[] = [];
    if (current && current.settings?.simulation !== true) {
      throw new Error('Refusing to replace a real tournament. Delete it or use an empty experimental VM.');
    }

    if (current) {
      await tournamentService.deleteTournament();
    }

    try {
      for (let teamIndex = 0; teamIndex < teamCount; teamIndex += 1) {
        const teamSeed = `${runId}:team:${teamIndex}`;
        const teamNumber = teamIndex + 1;
        const name = `${pick(TEAM_PREFIXES, runId, teamIndex)} ${pick(TEAM_SUFFIXES, runId, teamIndex + 20)}`;
        const tag = name
          .split(' ')
          .map((part) => part[0])
          .join('')
          .slice(0, 4)
          .toUpperCase();
        const id = `simulation-${runId}-team-${teamNumber}`;
        teamIds.push(id);

        await teamService.createTeam({
          id,
          name,
          tag,
          countryCode: pick(COUNTRIES, runId, teamIndex + 40),
          logoUrl: avatar(teamSeed),
          players: Array.from({ length: playersPerTeam }, (_, playerIndex) => {
            const playerSeed = `${teamSeed}:player:${playerIndex}`;
            const first = pick(FIRST_NAMES, runId, teamIndex * 10 + playerIndex);
            const last = pick(LAST_NAMES, runId, teamIndex * 10 + playerIndex + 100);
            const nickname = pick(NICKNAMES, runId, teamIndex * 10 + playerIndex + 200);
            return {
              steamId: steamId(runId, teamIndex, playerIndex),
              name: `${first} '${nickname}' ${last}`,
              countryCode: pick(COUNTRIES, runId, teamIndex * 10 + playerIndex + 300),
              avatar: avatar(playerSeed),
              elo: 1000 + (hash(playerSeed) % 2000),
            };
          }),
        });
      }

      log.success('[SIMULATION] Created isolated bot teams for draft', {
        teamCount,
        playersPerTeam,
        teamIds,
      });
      return { teamIds };
    } catch (error) {
      try {
        await this.discardTeams(teamIds);
      } catch (cleanupError) {
        log.error('[SIMULATION] Failed to clean up partially created teams', cleanupError);
      }
      throw error;
    }
  }
}

export const simulationTournamentService = new SimulationTournamentService();
