import { db } from '../config/database';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';
import type { TournamentControlMode } from '../types/tournament.types';

export type MatchOperatorState = 'queued' | 'postponed' | 'held';

const QUEUEABLE_STATUSES = ['pending', 'ready'] as const;

class OperatorControlService {
  async getControlMode(): Promise<TournamentControlMode> {
    const tournament = await db.queryOneAsync<Pick<DbTournamentRow, 'settings'>>(
      'SELECT settings FROM tournament WHERE id = ?',
      [1]
    );

    if (!tournament?.settings) return 'automatic';

    try {
      const settings = JSON.parse(tournament.settings) as { controlMode?: unknown };
      if (
        settings.controlMode === 'manual' ||
        settings.controlMode === 'assisted' ||
        settings.controlMode === 'automatic'
      ) {
        return settings.controlMode;
      }
    } catch {
      // Invalid legacy settings must retain upstream automatic behaviour.
    }

    return 'automatic';
  }

  async usesOperatorQueue(): Promise<boolean> {
    return (await this.getControlMode()) !== 'automatic';
  }

  async isPlayerReadyEnabled(): Promise<boolean> {
    const tournament = await db.queryOneAsync<Pick<DbTournamentRow, 'settings'>>(
      'SELECT settings FROM tournament WHERE id = ?',
      [1]
    );

    if (!tournament?.settings) return true;

    try {
      const settings = JSON.parse(tournament.settings) as { playerReadyEnabled?: unknown };
      return settings.playerReadyEnabled !== false;
    } catch {
      return true;
    }
  }

  async isVetoOpen(match: DbMatchRow): Promise<boolean> {
    // Parking a match freezes its execution surface without destroying veto
    // progress. Direct veto URLs and player-facing polling must remain closed
    // until the operator explicitly resumes the match.
    if (match.operator_state === 'postponed' || match.operator_state === 'held') return false;
    if (match.round === 0 || match.tournament_id == null) return true;
    if ((await this.getControlMode()) === 'automatic') return true;
    return typeof match.veto_opened_at === 'number' && match.veto_opened_at > 0;
  }

  /**
   * Append newly playable matches to the persisted execution queue without
   * changing bracket order. Future-round placeholders are intentionally skipped
   * until both teams are known.
   */
  async ensureQueuePositions(): Promise<void> {
    // Reconcile the entire queue in one statement. Existing operator order is
    // preserved, newly playable matches are appended in bracket order, and
    // non-runnable matches lose their queue position atomically. This avoids a
    // public GET observing or compacting a half-written reorder.
    await db.execAsync(
      `WITH ranked_queue AS (
         SELECT id,
                ROW_NUMBER() OVER (
                  ORDER BY
                    CASE WHEN queue_position IS NULL THEN 1 ELSE 0 END,
                    queue_position NULLS LAST,
                    round,
                    match_number,
                    id
                )::INTEGER AS desired_position
         FROM matches
         WHERE tournament_id = 1
           AND team1_id IS NOT NULL
           AND team2_id IS NOT NULL
           AND status IN ('pending', 'ready')
           AND COALESCE(operator_state, 'queued') = 'queued'
       ), desired AS (
         SELECT match_row.id, ranked_queue.desired_position
         FROM matches AS match_row
         LEFT JOIN ranked_queue ON ranked_queue.id = match_row.id
         WHERE match_row.tournament_id = 1
       )
       UPDATE matches AS match_row
       SET queue_position = desired.desired_position
       FROM desired
       WHERE match_row.id = desired.id
         AND match_row.queue_position IS DISTINCT FROM desired.desired_position`
    );
  }

  async getQueue(): Promise<DbMatchRow[]> {
    await this.ensureQueuePositions();
    return db.queryAsync<DbMatchRow>(
      `SELECT * FROM matches
       WHERE tournament_id = 1
         AND team1_id IS NOT NULL
         AND team2_id IS NOT NULL
         AND status IN ('pending', 'ready', 'loaded', 'live')
       ORDER BY
         CASE COALESCE(operator_state, 'queued')
           WHEN 'queued' THEN 0
           WHEN 'held' THEN 1
           WHEN 'postponed' THEN 2
           ELSE 3
         END,
         queue_position NULLS LAST,
         round,
         match_number,
         id`,
      []
    );
  }

  async reorderQueue(slugs: string[]): Promise<void> {
    if (slugs.length === 0 || new Set(slugs).size !== slugs.length) {
      throw new Error('Queue order must contain unique match slugs');
    }

    await this.ensureQueuePositions();
    const queued = await db.queryAsync<DbMatchRow>(
      `SELECT * FROM matches
       WHERE tournament_id = 1
         AND status IN ('pending', 'ready')
         AND COALESCE(operator_state, 'queued') = 'queued'
         AND team1_id IS NOT NULL
         AND team2_id IS NOT NULL`,
      []
    );
    const currentSlugs = queued.map((match) => match.slug);

    if (
      currentSlugs.length !== slugs.length ||
      currentSlugs.some((slug) => !slugs.includes(slug))
    ) {
      throw new Error('Queue changed while it was being reordered. Refresh and try again.');
    }

    const cases = slugs.map(() => 'WHEN ? THEN ?').join(' ');
    const placeholders = slugs.map(() => '?').join(', ');
    const params: unknown[] = slugs.flatMap((slug, index) => [slug, index + 1]);
    params.push(...slugs);

    // A single UPDATE prevents readers from seeing duplicate or partial queue
    // positions while an operator reorder is in progress.
    await db.queryAsync<never>(
      `UPDATE matches
       SET queue_position = CASE slug ${cases} ELSE queue_position END
       WHERE tournament_id = 1
         AND slug IN (${placeholders})
         AND status IN ('pending', 'ready')
         AND COALESCE(operator_state, 'queued') = 'queued'`,
      params
    );
  }

  async setNext(slug: string): Promise<void> {
    await this.ensureQueuePositions();
    const queued = await db.queryAsync<DbMatchRow>(
      `SELECT * FROM matches
       WHERE tournament_id = 1
         AND status IN ('pending', 'ready')
         AND COALESCE(operator_state, 'queued') = 'queued'
         AND team1_id IS NOT NULL
         AND team2_id IS NOT NULL
       ORDER BY queue_position NULLS LAST, round, match_number, id`,
      []
    );

    if (!queued.some((match) => match.slug === slug)) {
      throw new Error('Only a queued, unstarted match can be selected as next');
    }

    await this.reorderQueue([slug, ...queued.filter((match) => match.slug !== slug).map((m) => m.slug)]);
  }

  async postpone(slug: string): Promise<DbMatchRow> {
    const match = await this.getMatchOrThrow(slug);
    if (match.status === 'live') {
      throw new Error('A live match cannot be postponed. Use the emergency live-match controls.');
    }
    if (match.status === 'completed' || match.status === 'cancelled') {
      throw new Error(`A ${match.status} match cannot be postponed`);
    }

    const nextStatus = match.status === 'loaded' ? 'ready' : match.status;
    await db.updateAsync(
      'matches',
      {
        operator_state: 'postponed',
        queue_position: null,
        postponed_at: Math.floor(Date.now() / 1000),
        server_id: null,
        loaded_at: nextStatus === 'ready' ? null : match.loaded_at,
        status: nextStatus,
      },
      'slug = ?',
      [slug]
    );
    await this.compactQueue();
    return this.getMatchOrThrow(slug);
  }

  async resume(slug: string): Promise<DbMatchRow> {
    const match = await this.getMatchOrThrow(slug);
    if (match.operator_state !== 'postponed' && match.operator_state !== 'held') {
      throw new Error('Match is not postponed or held');
    }
    if (match.status === 'completed' || match.status === 'cancelled' || match.status === 'live') {
      throw new Error(`A ${match.status} match cannot be returned to the queue`);
    }

    const max = await db.queryOneAsync<{ max: number | string | null }>(
      `SELECT MAX(queue_position) as max FROM matches
       WHERE tournament_id = 1
         AND status IN ('pending', 'ready')
         AND COALESCE(operator_state, 'queued') = 'queued'`,
      []
    );
    const queuePosition = Number(max?.max ?? 0) + 1;

    await db.updateAsync(
      'matches',
      {
        operator_state: 'queued',
        queue_position: queuePosition,
        postponed_at: null,
      },
      'slug = ?',
      [slug]
    );
    return this.getMatchOrThrow(slug);
  }

  /**
   * Automatic mode has no Operator Control Room, so it must not retain hidden
   * held/postponed matches. Resume every unstarted parked match before upstream
   * allocation and veto automation are allowed to take over again.
   */
  async resumeAllParked(): Promise<void> {
    await db.execAsync(
      `UPDATE matches
       SET operator_state = 'queued',
           queue_position = NULL,
           postponed_at = NULL
       WHERE tournament_id = 1
         AND status IN ('pending', 'ready')
         AND operator_state IN ('postponed', 'held')`
    );
    await this.ensureQueuePositions();
  }

  async hold(slug: string): Promise<DbMatchRow> {
    const match = await this.getMatchOrThrow(slug);
    if (!QUEUEABLE_STATUSES.includes(match.status as (typeof QUEUEABLE_STATUSES)[number])) {
      throw new Error('Only an unstarted match can be held');
    }
    await db.updateAsync(
      'matches',
      { operator_state: 'held', queue_position: null },
      'slug = ?',
      [slug]
    );
    await this.compactQueue();
    return this.getMatchOrThrow(slug);
  }

  async openVeto(slug: string): Promise<DbMatchRow> {
    const match = await this.getMatchOrThrow(slug);
    if (!match.team1_id || !match.team2_id) {
      throw new Error('Both teams must be known before veto can be opened');
    }
    if (match.operator_state === 'postponed' || match.operator_state === 'held') {
      throw new Error('Resume the match before opening veto');
    }
    if (!QUEUEABLE_STATUSES.includes(match.status as (typeof QUEUEABLE_STATUSES)[number])) {
      throw new Error('Veto can only be opened for an unstarted match');
    }

    await db.updateAsync(
      'matches',
      { veto_opened_at: Math.floor(Date.now() / 1000) },
      'slug = ?',
      [slug]
    );
    return this.getMatchOrThrow(slug);
  }

  async getMatchOrThrow(slug: string): Promise<DbMatchRow> {
    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
    if (!match) throw new Error(`Match '${slug}' not found`);
    return match;
  }

  private async compactQueue(): Promise<void> {
    await db.execAsync(
      `WITH ordered AS (
         SELECT id,
                ROW_NUMBER() OVER (
                  ORDER BY queue_position NULLS LAST, round, match_number, id
                )::INTEGER AS desired_position
         FROM matches
         WHERE tournament_id = 1
           AND status IN ('pending', 'ready')
           AND COALESCE(operator_state, 'queued') = 'queued'
           AND team1_id IS NOT NULL
           AND team2_id IS NOT NULL
       )
       UPDATE matches AS match_row
       SET queue_position = ordered.desired_position
       FROM ordered
       WHERE match_row.id = ordered.id
         AND match_row.queue_position IS DISTINCT FROM ordered.desired_position`
    );
  }
}

export const operatorControlService = new OperatorControlService();
