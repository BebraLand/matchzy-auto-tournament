import { db } from '../config/database';
import type { DbMatchRow } from '../types/database.types';
import { log } from '../utils/logger';
import { emitBracketUpdate, emitMatchUpdate, emitHudProjectionInvalidated } from './socketService';
import { serverAllocationTracker } from './serverAllocationTracker';
import { matchAllocationService } from './matchAllocationService';
import { matchLiveStatsService } from './matchLiveStatsService';
import {
  advanceLoserToLosersBracket,
  advanceWinnerToNextMatch,
  checkTournamentCompletion,
  propagateMatchBySlotSources,
  reconcileDoubleElimination8Bracket,
} from '../utils/matchProgression';

export type MatchRulingKind = 'technical_win' | 'void';
export type TechnicalWinnerSide = 'team1' | 'team2';

export interface ApplyMatchRulingInput {
  matchSlug: string;
  kind: MatchRulingKind;
  reason: string;
  adminSteamId: string | null;
  winnerSide?: TechnicalWinnerSide;
}

export interface AppliedMatchRuling {
  match: DbMatchRow;
  warnings: string[];
}

class MatchRulingService {
  async apply(input: ApplyMatchRulingInput): Promise<AppliedMatchRuling> {
    const reason = input.reason.trim();
    if (!reason) {
      throw new Error('A ruling reason is required');
    }

    const match = await this.getMatchOrThrow(input.matchSlug);
    if (match.status === 'completed' || match.status === 'cancelled') {
      throw new Error(`A ${match.status} match cannot receive another ruling`);
    }

    if (input.kind === 'technical_win') {
      if (input.winnerSide !== 'team1' && input.winnerSide !== 'team2') {
        throw new Error('Technical win requires a winning team');
      }
      return this.applyTechnicalWin(match, input, reason);
    }

    return this.applyVoid(match, input, reason);
  }

  private async applyTechnicalWin(
    match: DbMatchRow,
    input: ApplyMatchRulingInput,
    reason: string
  ): Promise<AppliedMatchRuling> {
    const winnerId = input.winnerSide === 'team1' ? match.team1_id : match.team2_id;
    if (!winnerId) {
      throw new Error('The selected technical winner is not assigned to this match');
    }

    await this.resetAssignedServer(match);
    const completedAt = Math.floor(Date.now() / 1000);

    await db.updateAsync(
      'matches',
      {
        status: 'completed',
        winner_id: winnerId,
        completed_at: completedAt,
        operator_state: 'queued',
        queue_position: null,
        server_id: null,
        loaded_at: null,
        current_map: null,
      },
      'id = ?',
      [match.id]
    );

    await this.recordRuling({
      match,
      kind: 'technical_win',
      winnerId,
      reason,
      adminSteamId: input.adminSteamId,
      createdAt: completedAt,
    });

    await this.progressBracket(match);
    matchLiveStatsService.clear(match.slug);
    this.releaseServerAndAllocate(match.server_id);
    await this.emitFinalState(match.slug, 'technical_win');

    const updated = await this.getMatchOrThrow(match.slug);
    log.warn('Technical win recorded by tournament operator', {
      matchSlug: match.slug,
      winnerId,
      adminSteamId: input.adminSteamId,
      reason,
    });
    return { match: updated, warnings: [] };
  }

  private async applyVoid(
    match: DbMatchRow,
    input: ApplyMatchRulingInput,
    reason: string
  ): Promise<AppliedMatchRuling> {
    if (match.status === 'live') {
      throw new Error('A live match cannot be voided. Pause it, then record a technical win or order a replay.');
    }

    await this.resetAssignedServer(match);
    const completedAt = Math.floor(Date.now() / 1000);
    await db.updateAsync(
      'matches',
      {
        status: 'cancelled',
        completed_at: completedAt,
        operator_state: 'queued',
        queue_position: null,
        server_id: null,
        loaded_at: null,
        current_map: null,
      },
      'id = ?',
      [match.id]
    );

    await this.recordRuling({
      match,
      kind: 'void',
      winnerId: null,
      reason,
      adminSteamId: input.adminSteamId,
      createdAt: completedAt,
    });

    matchLiveStatsService.clear(match.slug);
    this.releaseServerAndAllocate(match.server_id);
    await checkTournamentCompletion(match.tournament_id ?? 1);
    await this.emitFinalState(match.slug, 'void');

    const updated = await this.getMatchOrThrow(match.slug);
    log.warn('Match voided by tournament operator; execution continues with the next queued match', {
      matchSlug: match.slug,
      adminSteamId: input.adminSteamId,
      reason,
    });
    return { match: updated, warnings: [] };
  }

  private async progressBracket(match: DbMatchRow): Promise<void> {
    const tournament = await db.queryOneAsync<{ type: string; team_ids: string | null }>(
      'SELECT type, team_ids FROM tournament WHERE id = ?',
      [match.tournament_id ?? 1]
    );
    if (!tournament || match.round === 0) return;

    const wiring = await db.queryOneAsync<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM matches
       WHERE tournament_id = ?
         AND (team1_from_match_id IS NOT NULL OR team2_from_match_id IS NOT NULL)`,
      [match.tournament_id ?? 1]
    );

    if (Number(wiring?.count ?? 0) > 0) {
      await propagateMatchBySlotSources(match.id);
    } else {
      const finalized = await this.getMatchOrThrow(match.slug);
      const winnerId = finalized.winner_id;
      if (!winnerId) {
        throw new Error('Technical result was saved without a winner');
      }

      let teamCount = 0;
      try {
        const teamIds = JSON.parse(tournament.team_ids ?? '[]');
        teamCount = Array.isArray(teamIds) ? teamIds.length : 0;
      } catch {
        // Fall through to the generic progression path for malformed legacy settings.
      }

      if (tournament.type === 'double_elimination' && teamCount === 8) {
        await reconcileDoubleElimination8Bracket();
      } else {
        await advanceWinnerToNextMatch(finalized, winnerId);
        if (tournament.type === 'double_elimination') {
          await advanceLoserToLosersBracket(finalized, winnerId);
        }
      }
    }

    await checkTournamentCompletion(match.tournament_id ?? 1);
  }

  private async resetAssignedServer(match: DbMatchRow): Promise<void> {
    if (!match.server_id) return;

    try {
      const { rconService } = await import('./rconService');
      const response = await rconService.sendCommand(match.server_id, 'css_restart');
      if (!response.success) {
        throw new Error(response.error ?? 'The assigned server did not confirm its reset.');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `The assigned server could not be reset, so MAT kept the match unchanged to prevent double-booking. Resolve the server first, then retry the ruling. (${detail})`
      );
    }
  }

  private releaseServerAndAllocate(serverId: string | null | undefined): void {
    if (!serverId) return;
    serverAllocationTracker.markIdle(serverId);
    setImmediate(() => {
      void matchAllocationService.tryImmediateAllocation();
    });
  }

  private async emitFinalState(matchSlug: string, action: string): Promise<void> {
    const updated = await this.getMatchOrThrow(matchSlug);
    emitMatchUpdate({
      id: updated.id,
      slug: updated.slug,
      status: updated.status,
      winnerId: updated.winner_id ?? null,
    });
    emitBracketUpdate({ action: `match_${action}`, matchSlug });
    emitHudProjectionInvalidated(`match-${action}`);
  }

  private async recordRuling(input: {
    match: DbMatchRow;
    kind: MatchRulingKind;
    winnerId: string | null;
    reason: string;
    adminSteamId: string | null;
    createdAt: number;
  }): Promise<void> {
    await db.insertAsync('match_rulings', {
      match_slug: input.match.slug,
      ruling_type: input.kind,
      winner_id: input.winnerId,
      reason: input.reason,
      admin_steam_id: input.adminSteamId,
      created_at: input.createdAt,
    });
  }

  private async getMatchOrThrow(slug: string): Promise<DbMatchRow> {
    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
    if (!match) throw new Error(`Match '${slug}' not found`);
    return match;
  }
}

export const matchRulingService = new MatchRulingService();
