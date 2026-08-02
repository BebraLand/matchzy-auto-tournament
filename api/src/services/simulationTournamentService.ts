import { db } from '../config/database';
import { log } from '../utils/logger';
import { teamService } from './teamService';
import { tournamentService } from './tournamentService';
import type { TournamentResponse } from '../types/tournament.types';

const MIN_TEAM_COUNT = 2;
const MAX_TEAM_COUNT = 8;
const MIN_PLAYERS_PER_TEAM = 1;
const MAX_PLAYERS_PER_TEAM = 5;
const DEFAULT_MAPS = ['de_dust2', 'de_cache', 'de_inferno'];
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
  async create(teamCount: number, playersPerTeam: number): Promise<TournamentResponse> {
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
    const maps = current?.maps?.length >= 3 ? current.maps.slice(0, 3) : DEFAULT_MAPS;

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

      const tournament = await tournamentService.createTournament({
        name: `Simulation ${teamCount} Teams (${playersPerTeam}v${playersPerTeam})`,
        type: 'single_elimination',
        format: 'bo3',
        maps,
        teamIds,
        maxRounds: 24,
        overtimeMode: 'disabled',
        overtimeSegments: 0,
        settings: {
          controlMode: 'assisted',
          checkInRequired: false,
          autoAdvance: false,
          seedingMethod: 'manual',
          simulation: true,
          simulationTimescale: 1,
        },
      });

      log.success('[SIMULATION] Created isolated bot tournament', {
        teamCount,
        playersPerTeam,
        teamIds,
      });
      return tournament;
    } catch (error) {
      for (const id of teamIds) {
        try {
          await teamService.deleteTeam(id);
        } catch {
          // Best-effort cleanup; preserve the original creation error.
        }
      }
      throw error;
    }
  }
}

export const simulationTournamentService = new SimulationTournamentService();
