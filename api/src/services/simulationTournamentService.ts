import { teamService } from './teamService';
import { tournamentService } from './tournamentService';
import { matchLiveStatsService } from './matchLiveStatsService';
import { db } from '../config/database';
import { log } from '../utils/logger';
import type { TournamentResponse, TournamentType } from '../types/tournament.types';

const SUPPORTED_TEAM_COUNTS = new Set([4, 6, 8]);
const DEFAULT_MAPS = ['de_dust2', 'de_cache', 'de_inferno'];
const PLAYERS_PER_TEAM = 5;

function simulationTeamId(runId: string, index: number): string {
  return `simulation-${runId}-team-${index + 1}`;
}

function simulationSteamId(runId: string, teamIndex: number, playerIndex: number): string {
  const suffix = `${runId}${String(teamIndex).padStart(2, '0')}${String(playerIndex).padStart(2, '0')}`
    .slice(-10)
    .padStart(10, '0');
  return `7656119${suffix}`;
}

/**
 * Creates an explicitly marked tournament for one-operator MatchZy testing.
 *
 * The tournament uses normal MAT bracket rows and allocations. The only special
 * contract is settings.simulation=true, which makes MatchZy spawn roster-mapped
 * bots when a match is prepared. This lets the Operator Room exercise the same
 * veto, warmup, Go Live, reporting and map-transition paths as a real event.
 */
class SimulationTournamentService {
  async create(teamCount: number): Promise<TournamentResponse> {
    if (!SUPPORTED_TEAM_COUNTS.has(teamCount)) {
      throw new Error('Simulation supports 4, 6, or 8 teams.');
    }

    const activeMatches = await db.queryAsync<{ slug: string }>(
      "SELECT slug FROM matches WHERE status IN ('loaded', 'live') LIMIT 1"
    );
    if (activeMatches.length > 0) {
      throw new Error(
        `Cannot replace the current tournament while match '${activeMatches[0].slug}' is loaded or live. Finish or cancel it first.`
      );
    }

    const previousTournament = await tournamentService.getTournament();
    const maps =
      previousTournament?.maps && previousTournament.maps.length >= 3
        ? previousTournament.maps.slice(0, 3)
        : DEFAULT_MAPS;
    const runId = String(Date.now()).slice(-10);
    const teamIds: string[] = [];

    // There is only one active tournament in MAT. Remove its bracket with the
    // canonical service so stale telemetry and allocation state cannot leak into
    // reusable bracket slugs. Existing non-simulation teams are deliberately kept.
    if (previousTournament) {
      await tournamentService.deleteTournament();
    } else {
      matchLiveStatsService.clearAll();
    }

    for (let teamIndex = 0; teamIndex < teamCount; teamIndex++) {
      const teamNumber = teamIndex + 1;
      const id = simulationTeamId(runId, teamIndex);
      teamIds.push(id);
      await teamService.createTeam({
        id,
        name: `SIM Team ${teamNumber}`,
        tag: `S${teamNumber}`,
        players: Array.from({ length: PLAYERS_PER_TEAM }, (_, playerIndex) => ({
          steamId: simulationSteamId(runId, teamIndex, playerIndex),
          name: `SIM ${teamNumber}-${playerIndex + 1}`,
        })),
      });
    }

    // The existing elimination generator intentionally accepts powers of two only.
    // Six teams therefore use MAT's ordinary round-robin generator rather than
    // inventing an untested bye model just for simulation.
    const type: TournamentType = teamCount === 6 ? 'round_robin' : 'single_elimination';
    const tournament = await tournamentService.createTournament({
      name: `SIMULATION ${teamCount} Teams`,
      type,
      format: 'bo3',
      maps,
      teamIds,
      maxRounds: 5,
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

    log.success('[SIMULATION] Created bot tournament', {
      teamCount,
      tournamentType: type,
      teamIds,
    });
    return tournament;
  }
}

export const simulationTournamentService = new SimulationTournamentService();
