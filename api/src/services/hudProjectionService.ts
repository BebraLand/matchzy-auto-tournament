import { createHash } from 'crypto';
import { db } from '../config/database';
import { getMapResults } from './matchMapResultService';
import type { PlayerRecord } from './playerService';
import type { VetoState } from '../types/veto.types';
import type { MatchConfig } from '../types/match.types';
import type {
  HudCurrentResponseV1,
  HudMapProjection,
  HudMatchFormat,
  HudMatchProjection,
  HudMatchStatus,
  HudPlayerProjection,
  HudProjectionV1,
  HudTeamProjection,
  HudVetoActionProjection,
} from '../types/hudProjection.types';

const BROADCAST_MATCH_SETTING = 'jts_hud_broadcast_match_slug';

type MatchRow = {
  id: number;
  slug: string;
  tournament_id: number;
  round: number;
  match_number: number;
  bracket?: string | null;
  team1_id?: string | null;
  team2_id?: string | null;
  winner_id?: string | null;
  status: string;
  operator_state?: string | null;
  veto_opened_at?: number | null;
  veto_state?: string | null;
  config?: string | null;
  current_map?: string | null;
  map_number?: number | null;
  created_at?: number | null;
  loaded_at?: number | null;
  completed_at?: number | null;
};

type TournamentRow = {
  id: number;
  name: string;
  type: string;
  format: string;
  status: string;
  settings?: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  tag?: string | null;
  country_code?: string | null;
  logo_url?: string | null;
  players: string;
};

type RosterPlayer = { steamId: string; name: string; avatar?: string; elo?: number };

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function absoluteUrl(value: string | null | undefined, publicBaseUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, `${publicBaseUrl.replace(/\/$/, '')}/`).toString();
  } catch {
    return null;
  }
}

function getRoundLabel(match: MatchRow): string {
  const bracket = match.bracket?.toUpperCase();
  if (bracket === 'GF') return 'Grand Final';
  if (bracket === 'GF_RESET') return 'Grand Final Reset';
  if (bracket === 'WB') return `Winners Bracket Round ${match.round}`;
  if (bracket === 'LB') return `Lower Bracket Round ${match.round}`;
  return match.round > 0 ? `Round ${match.round}` : 'Manual Match';
}

function getFormat(
  match: MatchRow,
  tournament: TournamentRow,
  veto: VetoState | null
): HudMatchFormat {
  if (veto?.format) return veto.format;
  const config = parseJson<Partial<MatchConfig>>(match.config, {});
  if (config.num_maps === 5) return 'bo5';
  if (config.num_maps === 3) return 'bo3';
  if (config.num_maps === 1) return 'bo1';
  return tournament.format === 'bo5' || tournament.format === 'bo3' ? tournament.format : 'bo1';
}

function getStatus(match: MatchRow, veto: VetoState | null): HudMatchStatus {
  if (match.operator_state === 'held') return 'held';
  if (match.operator_state === 'postponed') return 'postponed';
  if (match.status === 'completed') return 'completed';
  if (match.status === 'live') return 'live';
  if (match.status === 'loaded') return 'prepared';
  if (veto?.status === 'in_progress' || match.veto_opened_at) return 'veto';
  return 'queued';
}

function teamIdForVetoValue(value: string | undefined, match: MatchRow): string | null {
  if (!value) return null;
  if (value === 'team1' || value === match.team1_id) return match.team1_id || null;
  if (value === 'team2' || value === match.team2_id) return match.team2_id || null;
  return null;
}

class HudProjectionService {
  async getBroadcastMatchSlug(): Promise<string | null> {
    return db.getAppSettingAsync(BROADCAST_MATCH_SETTING);
  }

  async setBroadcastMatch(slug: string | null): Promise<string | null> {
    if (!slug) {
      await db.setAppSettingAsync(BROADCAST_MATCH_SETTING, null);
      return null;
    }
    const match = await db.queryOneAsync<MatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
    if (!match) throw new Error(`Match '${slug}' not found`);
    if (!match.team1_id || !match.team2_id) {
      throw new Error('Broadcast match must have two assigned teams');
    }
    if (match.operator_state === 'held' || match.operator_state === 'postponed') {
      throw new Error('Held or postponed match cannot be selected for broadcast');
    }
    await db.setAppSettingAsync(BROADCAST_MATCH_SETTING, slug);
    return slug;
  }

  private async resolveCurrentMatch(): Promise<MatchRow | null> {
    const selected = await this.getBroadcastMatchSlug();
    if (selected) {
      const match = await db.queryOneAsync<MatchRow>(
        `SELECT * FROM matches
         WHERE slug = ? AND COALESCE(operator_state, 'queued') NOT IN ('held', 'postponed')`,
        [selected]
      );
      if (match) return match;
      return null;
    }

    return (
      (await db.queryOneAsync<MatchRow>(
        `SELECT * FROM matches
       WHERE status IN ('live', 'loaded')
         AND COALESCE(operator_state, 'queued') NOT IN ('held', 'postponed')
       ORDER BY CASE status WHEN 'live' THEN 0 ELSE 1 END, loaded_at DESC NULLS LAST, id DESC
       LIMIT 1`
      )) ?? null
    );
  }

  private async projectTeam(
    teamId: string,
    publicBaseUrl: string,
    playerRecords: Map<string, PlayerRecord>
  ): Promise<HudTeamProjection> {
    const team = await db.queryOneAsync<TeamRow>('SELECT * FROM teams WHERE id = ?', [teamId]);
    if (!team) throw new Error(`Team '${teamId}' not found`);
    const roster = parseJson<RosterPlayer[]>(team.players, []);
    const players: HudPlayerProjection[] = roster.map((entry) => {
      const profile = playerRecords.get(entry.steamId);
      return {
        id: entry.steamId,
        steamId: entry.steamId,
        nickname: profile?.name || entry.name,
        firstName: profile?.first_name || null,
        lastName: profile?.last_name || null,
        avatarUrl: absoluteUrl(profile?.avatar_url || entry.avatar, publicBaseUrl),
        photoUrl: absoluteUrl(profile?.photo_url, publicBaseUrl),
        countryCode: profile?.country_code || null,
        teamId: team.id,
      };
    });

    return {
      id: team.id,
      name: team.name,
      tag: team.tag || team.name.slice(0, 4).toUpperCase(),
      countryCode: team.country_code || null,
      logoUrl: absoluteUrl(team.logo_url, publicBaseUrl),
      players,
    };
  }

  private async getPlayerRecords(teamIds: string[]): Promise<Map<string, PlayerRecord>> {
    const teams = await db.queryAsync<TeamRow>(
      `SELECT * FROM teams WHERE id IN (${teamIds.map(() => '?').join(',')})`,
      teamIds
    );
    const steamIds = Array.from(
      new Set(
        teams.flatMap((team) => parseJson<RosterPlayer[]>(team.players, []).map((p) => p.steamId))
      )
    );
    if (steamIds.length === 0) return new Map();
    const players = await db.queryAsync<PlayerRecord>(
      `SELECT * FROM players WHERE id IN (${steamIds.map(() => '?').join(',')})`,
      steamIds
    );
    return new Map(players.map((player) => [player.id, player]));
  }

  private projectVeto(veto: VetoState | null, match: MatchRow): HudVetoActionProjection[] {
    if (!veto) return [];
    const actions: HudVetoActionProjection[] = veto.actions.map((action) => ({
      step: action.step,
      teamId: teamIdForVetoValue(action.team, match),
      type: action.action === 'side_pick' ? 'side' : action.action === 'pick' ? 'pick' : 'ban',
      mapName: action.mapName || 'unknown',
      side: action.side === 'CT' || action.side === 'T' ? action.side : null,
    }));

    const pickedNames = new Set(
      actions.filter((action) => action.type === 'pick').map((action) => action.mapName)
    );
    for (const picked of veto.pickedMaps) {
      if (!pickedNames.has(picked.mapName)) {
        actions.push({
          step: actions.length + 1,
          teamId: null,
          type: 'decider',
          mapName: picked.mapName,
          side: picked.sideTeam1 || null,
        });
      }
    }
    return actions.sort((a, b) => a.step - b.step);
  }

  private async projectMaps(
    match: MatchRow,
    veto: VetoState | null,
    config: Partial<MatchConfig>
  ): Promise<HudMapProjection[]> {
    const results = await getMapResults(match.slug);
    const resultByNumber = new Map(results.map((result) => [result.mapNumber + 1, result]));
    const pickActions = new Map(
      (veto?.actions || [])
        .filter((action) => action.action === 'pick' && action.mapName)
        .map((action) => [action.mapName as string, action.team])
    );
    const mapNames =
      veto?.pickedMaps?.map((picked) => picked.mapName) ||
      config.maplist ||
      results.map((result) => result.mapName || `map-${result.mapNumber + 1}`);

    return mapNames.map((name, index) => {
      const number = index + 1;
      const picked = veto?.pickedMaps.find((entry) => entry.mapName === name);
      const result = resultByNumber.get(number);
      let winnerTeamId: string | null = null;
      if (result?.winnerTeam === 'team1') winnerTeamId = match.team1_id || null;
      if (result?.winnerTeam === 'team2') winnerTeamId = match.team2_id || null;
      return {
        number,
        name,
        pickedByTeamId: teamIdForVetoValue(pickActions.get(name), match),
        startingSideTeam1: picked?.sideTeam1 || null,
        score: result ? { team1: result.team1Score, team2: result.team2Score } : null,
        winnerTeamId,
        completedAt: result ? new Date(result.completedAt * 1000).toISOString() : null,
      };
    });
  }

  async getProjectionForMatch(
    slug: string,
    publicBaseUrl: string
  ): Promise<HudProjectionV1 | null> {
    const match = await db.queryOneAsync<MatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
    if (!match || !match.team1_id || !match.team2_id) return null;
    const tournament = await db.queryOneAsync<TournamentRow>(
      'SELECT * FROM tournament WHERE id = ?',
      [match.tournament_id]
    );
    if (!tournament) return null;

    const veto = parseJson<VetoState | null>(match.veto_state, null);
    const config = parseJson<Partial<MatchConfig>>(match.config, {});
    const playerRecords = await this.getPlayerRecords([match.team1_id, match.team2_id]);
    const [team1, team2, maps] = await Promise.all([
      this.projectTeam(match.team1_id, publicBaseUrl, playerRecords),
      this.projectTeam(match.team2_id, publicBaseUrl, playerRecords),
      this.projectMaps(match, veto, config),
    ]);
    const seriesScore = maps.reduce(
      (score, map) => {
        if (map.winnerTeamId === team1.id) score.team1 += 1;
        if (map.winnerTeamId === team2.id) score.team2 += 1;
        return score;
      },
      { team1: 0, team2: 0 }
    );
    const tournamentSettings = parseJson<Record<string, unknown>>(tournament.settings, {});

    const projectedMatch: HudMatchProjection = {
      id: String(match.id),
      numericId: match.id,
      slug: match.slug,
      round: match.round,
      roundLabel: getRoundLabel(match),
      bracket: match.bracket || null,
      format: getFormat(match, tournament, veto),
      status: getStatus(match, veto),
      operatorState:
        match.operator_state === 'held' ||
        match.operator_state === 'postponed' ||
        match.operator_state === 'queued'
          ? match.operator_state
          : null,
      currentMap: match.current_map || null,
      currentMapNumber: typeof match.map_number === 'number' ? match.map_number + 1 : null,
      team1,
      team2,
      seriesScore,
      veto: {
        status: veto?.status || (match.veto_opened_at ? 'in_progress' : 'not_started'),
        actions: this.projectVeto(veto, match),
      },
      maps,
      simulation: Boolean(config.simulation || tournamentSettings.simulation),
      confirmedWinnerTeamId: match.status === 'completed' ? match.winner_id || null : null,
    };

    const core = {
      contract: 'bebraland-mat-hud' as const,
      version: 1 as const,
      tournament: {
        id: String(tournament.id),
        name: tournament.name,
        type: tournament.type,
        status: tournament.status,
      },
      match: projectedMatch,
    };
    const revision = createHash('sha256').update(JSON.stringify(core)).digest('hex').slice(0, 16);
    return { ...core, revision, generatedAt: new Date().toISOString() };
  }

  async getCurrentProjection(publicBaseUrl: string): Promise<HudCurrentResponseV1> {
    const match = await this.resolveCurrentMatch();
    if (!match) {
      return {
        contract: 'bebraland-mat-hud',
        version: 1,
        revision: 'empty',
        generatedAt: new Date().toISOString(),
        tournament: null,
        match: null,
      };
    }
    const projection = await this.getProjectionForMatch(match.slug, publicBaseUrl);
    if (!projection) {
      return {
        contract: 'bebraland-mat-hud',
        version: 1,
        revision: 'empty',
        generatedAt: new Date().toISOString(),
        tournament: null,
        match: null,
      };
    }
    return projection;
  }

  async getTournamentMatches(tournamentId: number): Promise<Array<Record<string, unknown>>> {
    const rows = await db.queryAsync<MatchRow>(
      `SELECT * FROM matches WHERE tournament_id = ? ORDER BY round, match_number, id`,
      [tournamentId]
    );
    return rows.map((match) => ({
      id: String(match.id),
      slug: match.slug,
      round: match.round,
      roundLabel: getRoundLabel(match),
      bracket: match.bracket || null,
      team1Id: match.team1_id || null,
      team2Id: match.team2_id || null,
      status: getStatus(match, parseJson<VetoState | null>(match.veto_state, null)),
      operatorState: match.operator_state || null,
    }));
  }
}

export const hudProjectionService = new HudProjectionService();
