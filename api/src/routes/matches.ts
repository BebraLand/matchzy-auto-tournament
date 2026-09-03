import express, { Router, Request, Response } from 'express';
import { matchService } from '../services/matchService';
import { matchAllocationService } from '../services/matchAllocationService';
import { loadMatchOnServer } from '../services/matchLoadingService';
import { CreateMatchInput, MatchConfig, MatchListItem, MatchPlayer } from '../types/match.types';
import { TournamentResponse } from '../types/tournament.types';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { db } from '../config/database';
import { matchConfigFetchTracker } from '../services/matchConfigFetchTracker';
import type { DbMatchRow, DbTournamentRow } from '../types/database.types';
import { getBaseUrl, getWebhookBaseUrl } from '../utils/urlHelper';
import { emitMatchUpdate, emitBracketUpdate, emitHudProjectionInvalidated } from '../services/socketService';
import { generateMatchConfig } from '../services/matchConfigBuilder';
import { enrichMatch } from '../utils/matchEnrichment';
import { matchLiveStatsService } from '../services/matchLiveStatsService';
import { normalizeConfigPlayers } from '../utils/playerTransform';
import { teamService } from '../services/teamService';
import { playerService } from '../services/playerService';
import { getMapResults } from '../services/matchMapResultService';
import { serverAllocationTracker } from '../services/serverAllocationTracker';
import { operatorControlService } from '../services/operatorControlService';
import { matchExecutionLockService } from '../services/matchExecutionLockService';
import {
  applyAdminMatchAccess,
  canViewMatchServerConfig,
  getMatchServerAccess,
} from '../services/matchConfigAccessService';
import { hudProjectionService } from '../services/hudProjectionService';
import { matchRulingService } from '../services/matchRulingService';
import { getVerifiedPlayerSteamId } from '../utils/signedPlayerCookie';
import { rconService } from '../services/rconService';
import { validateServerToken } from '../middleware/serverAuth';

const router = Router();

// Live reallocation uses a short-lived in-memory checkpoint. The payload is
// downloaded by the target MatchZy server immediately after it is captured.
const liveReallocationStates = new Map<string, { payload: Buffer; receivedAt: number }>();

function stripMatchServerAccess(match: MatchListItem): MatchListItem {
  const safeMatch = { ...match };
  delete safeMatch.serverId;
  delete safeMatch.serverName;
  delete safeMatch.serverHost;
  delete safeMatch.serverPort;

  if (safeMatch.config) {
    const config = { ...safeMatch.config };
    delete config.admins;
    delete config.__preferredServerId;
    safeMatch.config = config;
  }

  return safeMatch;
}

/**
 * Helper: build a rich MatchListItem (teams, maps, results, players) for a single match row.
 * This mirrors the shape used by GET /api/matches so team pages and history views
 * get full details, not just raw config.
 */
async function getMatchDetailsBySlug(slug: string): Promise<MatchListItem | null> {
  // Fetch match with team and server info
  const row = await db.queryOneAsync<
    DbMatchRow & {
      team1_id?: string;
      team1_name?: string;
      team1_tag?: string;
      team2_id?: string;
      team2_name?: string;
      team2_tag?: string;
      winner_id?: string;
      winner_name?: string;
      winner_tag?: string;
      demo_file_path?: string;
      server_name?: string | null;
      server_host?: string | null;
      server_port?: number | null;
    }
  >(
    `
      SELECT
        m.*,
        t1.id as team1_id, t1.name as team1_name, t1.tag as team1_tag,
        t2.id as team2_id, t2.name as team2_name, t2.tag as team2_tag,
        w.id as winner_id, w.name as winner_name, w.tag as winner_tag,
        s.name as server_name,
        s.host as server_host,
        s.port as server_port
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      LEFT JOIN teams w ON m.winner_id = w.id
      LEFT JOIN servers s ON m.server_id = s.id
      WHERE m.slug = ?
      LIMIT 1
    `,
    [slug]
  );

  if (!row) {
    return null;
  }

  // Determine if this is a shuffle tournament (enables ELO enrichment)
  const tournamentType = await db.queryOneAsync<{ type: string }>(
    'SELECT type FROM tournament WHERE id = ?',
    [row.tournament_id || 1]
  );
  const isShuffleTournament = tournamentType?.type === 'shuffle';

  // For bracket-managed matches (round >= 1) rebuild the config on demand so
  // team rosters and settings always reflect the latest DB state instead of a
  // stale snapshot from when the match was first generated. Manual matches
  // (round = 0) keep their stored config as-is.
  let config: MatchConfig | Record<string, unknown>;
  if (typeof row.round === 'number' && row.round >= 1 && row.tournament_id) {
    const t = await db.queryOneAsync<DbTournamentRow>(
      'SELECT * FROM tournament WHERE id = ?',
      [row.tournament_id]
    );

    if (t) {
      const tournament: TournamentResponse = {
        id: t.id,
        name: t.name,
        type: t.type as TournamentResponse['type'],
        format: t.format as TournamentResponse['format'],
        status: t.status as TournamentResponse['status'],
        maps: JSON.parse(t.maps),
        teamIds: JSON.parse(t.team_ids),
        settings: t.settings ? JSON.parse(t.settings) : {},
        created_at: t.created_at,
        updated_at: t.updated_at ?? t.created_at,
        started_at: t.started_at,
        completed_at: t.completed_at,
        teams: [],
        mapSequence: t.map_sequence ? JSON.parse(t.map_sequence) : undefined,
        teamSize:
          t.team_size === null || typeof t.team_size === 'undefined' ? undefined : t.team_size,
        maxRounds:
          t.max_rounds === null || typeof t.max_rounds === 'undefined'
            ? undefined
            : t.max_rounds,
        overtimeMode: (t.overtime_mode as 'enabled' | 'disabled' | null) || undefined,
        overtimeSegments:
          t.overtime_segments === null || typeof t.overtime_segments === 'undefined'
            ? undefined
            : t.overtime_segments,
        eloTemplateId: t.elo_template_id ?? undefined,
      };

      config = await generateMatchConfig(
        tournament,
        row.team1_id ?? undefined,
        row.team2_id ?? undefined,
        row.slug
      );
    } else {
      config = row.config ? JSON.parse(row.config as string) : {};
    }
  } else {
    config = row.config ? JSON.parse(row.config as string) : {};
  }
  const vetoState = row.veto_state ? JSON.parse(row.veto_state as string) : null;

  // Normalize players from config
  const normalizedTeam1Players = config.team1
    ? normalizeConfigPlayers(config.team1.players)
    : [];
  const normalizedTeam2Players = config.team2
    ? normalizeConfigPlayers(config.team2.players)
    : [];

  // Enrich players with avatars from team records if team IDs are available
  let enrichedTeam1Players = normalizedTeam1Players;
  let enrichedTeam2Players = normalizedTeam2Players;

  if (config.team1?.id && row.team1_id) {
    try {
      const team1Data = await teamService.getTeamById(config.team1.id);
      if (team1Data?.players) {
        const avatarMap = new Map(
          team1Data.players.map((p) => [p.steamId.toLowerCase(), p.avatar])
        );
        enrichedTeam1Players = normalizedTeam1Players.map((p) => ({
          ...p,
          avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
        }));
      }
    } catch (error) {
      log.debug(
        `Failed to enrich team1 players with avatars: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (config.team2?.id && row.team2_id) {
    try {
      const team2Data = await teamService.getTeamById(config.team2.id);
      if (team2Data?.players) {
        const avatarMap = new Map(
          team2Data.players.map((p) => [p.steamId.toLowerCase(), p.avatar])
        );
        enrichedTeam2Players = normalizedTeam2Players.map((p) => ({
          ...p,
          avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
        }));
      }
    } catch (error) {
      log.debug(
        `Failed to enrich team2 players with avatars: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // Manual matches: no team rows in DB, enrich avatars from players table
  if (!row.team1_id && !row.team2_id) {
    const allSteamIds = [
      ...normalizedTeam1Players.map((p) => p.steamid),
      ...normalizedTeam2Players.map((p) => p.steamid),
    ];
    if (allSteamIds.length > 0) {
      try {
        const placeholders = allSteamIds.map(() => '?').join(', ');
        const rows = await db.queryAsync<{ id: string; avatar_url: string | null }>(
          `SELECT id, avatar_url FROM players WHERE id IN (${placeholders})`,
          allSteamIds
        );
        const avatarMap = new Map(
          rows.map((r) => [r.id.toLowerCase(), r.avatar_url ?? undefined])
        );
        enrichedTeam1Players = normalizedTeam1Players.map((p) => ({
          ...p,
          avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
        }));
        enrichedTeam2Players = normalizedTeam2Players.map((p) => ({
          ...p,
          avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
        }));
      } catch (error) {
        log.debug(
          `Failed to enrich manual-match players with avatars: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  // Transform config to include properly formatted team players with avatars
  const transformedConfig = {
    ...config,
    team1: config.team1
      ? {
          ...config.team1,
          players: enrichedTeam1Players,
        }
      : undefined,
    team2: config.team2
      ? {
          ...config.team2,
          players: enrichedTeam2Players,
        }
      : undefined,
  };

  const match: MatchListItem = {
    id: row.id,
    slug: row.slug,
    round: row.round,
    matchNumber: row.match_number,
    team1:
      row.team1_id && row.team1_name
        ? {
            id: row.team1_id,
            name: row.team1_name,
            tag: row.team1_tag,
          }
        : undefined,
    team2:
      row.team2_id && row.team2_name
        ? {
            id: row.team2_id,
            name: row.team2_name,
            tag: row.team2_tag,
          }
        : undefined,
    winner:
      row.winner_id && row.winner_name
        ? {
            id: row.winner_id,
            name: row.winner_name,
            tag: row.winner_tag,
          }
        : undefined,
    status: row.status,
    serverId: row.server_id,
    serverName: row.server_name || undefined,
    serverHost: row.server_host || undefined,
    serverPort: row.server_port || undefined,
    config: transformedConfig,
    demoFilePath: row.demo_file_path,
    createdAt: row.created_at ?? 0,
    loadedAt: row.loaded_at,
    completedAt: row.completed_at,
    vetoCompleted: vetoState?.status === 'completed',
    currentMap: row.current_map ?? undefined,
    mapNumber: typeof row.map_number === 'number' ? row.map_number : undefined,
    maps: undefined,
    operatorState: row.operator_state ?? 'queued',
    queuePosition: row.queue_position,
    vetoOpenedAt: row.veto_opened_at,
    postponedAt: row.postponed_at,
  };

  const mapResults = await getMapResults(row.slug);
  if (mapResults.length > 0) {
    match.mapResults = mapResults;
  }

  if (Array.isArray(vetoState?.pickedMaps) && vetoState.pickedMaps.length > 0) {
    const orderedPickedMaps = [...vetoState.pickedMaps].sort(
      (a: { mapNumber?: number }, b: { mapNumber?: number }) => (a.mapNumber || 0) - (b.mapNumber || 0)
    );
    const pickedMapNames = orderedPickedMaps
      .map((m: { mapName?: string | null }) => m.mapName)
      .filter((name): name is string => Boolean(name));
    if (pickedMapNames.length > 0) {
      match.maps = pickedMapNames;
    }
  }

  if (!match.maps && mapResults.length > 0) {
    const resultsMaps = mapResults
      .map((result) => result.mapName)
      .filter((name): name is string => Boolean(name));
    if (resultsMaps.length > 0) {
      match.maps = resultsMaps;
    }
  }

  // Enrich match with player stats and scores from events
  await enrichMatch(match, row.slug);

  // For shuffle tournaments, enrich players with ELO
  if (
    isShuffleTournament &&
    (enrichedTeam1Players.length > 0 || enrichedTeam2Players.length > 0)
  ) {
    try {
      const allSteamIds = [
        ...enrichedTeam1Players.map((p) => p.steamid),
        ...enrichedTeam2Players.map((p) => p.steamid),
      ];

      if (allSteamIds.length > 0) {
        const players = await playerService.getPlayersByIds(allSteamIds);
        const eloMap = new Map(players.map((p) => [p.id.toLowerCase(), p.current_elo]));

        // Add ELO to team1 players
        enrichedTeam1Players = enrichedTeam1Players.map((p) => ({
          ...p,
          elo: eloMap.get(p.steamid.toLowerCase()),
        }));

        // Add ELO to team2 players
        enrichedTeam2Players = enrichedTeam2Players.map((p) => ({
          ...p,
          elo: eloMap.get(p.steamid.toLowerCase()),
        }));

        // Update config with enriched players
        if (transformedConfig.team1) {
          transformedConfig.team1.players = enrichedTeam1Players;
        }
        if (transformedConfig.team2) {
          transformedConfig.team2.players = enrichedTeam2Players;
        }
        match.config = transformedConfig;
      }
    } catch (error) {
      log.debug(
        `Failed to enrich players with ELO: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return match;
}

/**
 * GET /api/matches/:slug.json
 * Protected endpoint for MatchZy to fetch match configuration
 * Returns a FRESH, on-demand config assembled from DB (reads veto_state)
 * Requires bearer token authentication from game server (kept commented for local dev)
 */
router.get('/:slug.json', async (req: Request, res: Response) => {
  try {
    // // Optional bearer token auth — enable when you wire SERVER_TOKEN on the game server
    // const authHeader = req.headers.authorization;
    // const expectedToken = process.env.SERVER_TOKEN;
    // if (!expectedToken) {
    //   return res.status(500).json({
    //     success: false,
    //     error: 'SERVER_TOKEN environment variable is not configured',
    //   });
    // }
    // if (!authHeader?.startsWith('Bearer ')) {
    //     return res.status(401).json({
    //       success: false,
    //       error: 'Missing or invalid authorization header. Expected: Bearer <token>',
    //     });
    // }
    // const token = authHeader.substring(7);
    // if (token !== expectedToken) {
    //   return res.status(403).json({ success: false, error: 'Invalid bearer token' });
    // }

    const { slug } = req.params;

    // 1) Load the match row
    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      slug,
    ]);
    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match configuration '${slug}' not found`,
      });
    }

    // The game server fetching this config is the only reliable proof that
    // MatchZy accepted the load command - see matchConfigFetchTracker.
    matchConfigFetchTracker.record(slug);

    // Manual / non-bracket matches:
    // We treat any match with round = 0 as a manually created match. For these,
    // we return the stored config from the `matches.config` column instead of
    // generating a fresh tournament-backed config. This allows admins to create
    // ad hoc matches that are independent from the tournament bracket.
    if (match.round === 0) {
      let storedConfig: Partial<MatchConfig> = {};
      try {
        storedConfig = match.config ? (JSON.parse(match.config) as Partial<MatchConfig>) : {};
      } catch (e) {
        console.error('Failed to parse stored match config for manual match', e);
        storedConfig = {};
      }

      const matchzyConfig = { ...storedConfig };
      delete matchzyConfig.__preferredServerId;

      const normalizePlayers = (value: unknown): MatchPlayer => {
        if (!value) return {};

        // Case 1: already a map of steamId -> name
        if (typeof value === 'object' && !Array.isArray(value)) {
          const result: MatchPlayer = {};
          for (const [steamId, name] of Object.entries(value as Record<string, unknown>)) {
            if (typeof name === 'string') {
              result[steamId] = name;
            }
          }
          return result;
        }

        // Case 2: array of { steamid/name } objects from the manual match modal
        if (Array.isArray(value)) {
          const result: MatchPlayer = {};
          for (const entry of value as Array<unknown>) {
            if (!entry || typeof entry !== 'object') continue;
            const steamid =
              (entry as { steamid?: string; steamId?: string }).steamid ||
              (entry as { steamid?: string; steamId?: string }).steamId;
            const name = (entry as { name?: string }).name;
            if (steamid && name) {
              result[steamid] = name;
            }
          }
          return result;
        }

        // Fallback: unknown shape
        return {};
      };

      // Ensure required fields for MatchZy are present.
      const safeConfig: MatchConfig = {
        ...matchzyConfig,
        matchid: match.id,
        players_per_team:
          typeof storedConfig.players_per_team === 'number' && storedConfig.players_per_team > 0
            ? storedConfig.players_per_team
            : 5,
        num_maps:
          typeof storedConfig.num_maps === 'number' && storedConfig.num_maps > 0
            ? storedConfig.num_maps
            : Array.isArray(storedConfig.maplist) && storedConfig.maplist.length > 0
            ? storedConfig.maplist.length
            : 1,
        maplist: storedConfig.maplist ?? null,
        skip_veto: true,
        spectators: {
          players: normalizePlayers(storedConfig.spectators?.players),
        },
        team1:
          storedConfig.team1 && storedConfig.team1.name
            ? {
                ...storedConfig.team1,
                players: normalizePlayers(
                  (storedConfig.team1 as { players?: unknown } | undefined)?.players
                ),
              }
            : {
                name: 'Team 1',
                players: {},
              },
        team2:
          storedConfig.team2 && storedConfig.team2.name
            ? {
                ...storedConfig.team2,
                players: normalizePlayers(
                  (storedConfig.team2 as { players?: unknown } | undefined)?.players
                ),
              }
            : {
                name: 'Team 2',
                players: {},
              },
      };

      // Resolve current admin access at serving time as well as creation time,
      // so newly assigned admins can observe existing manual matches. Team
      // roster membership still wins over spectator access.
      try {
        await applyAdminMatchAccess(safeConfig);
      } catch (error) {
        log.warn('Failed to attach admin access to manual match config response', error as Error);
      }

      return res.json(safeConfig);
    }

    // 2) Load the tournament row for bracket-managed matches
    const t = await db.queryOneAsync<DbTournamentRow>('SELECT * FROM tournament WHERE id = ?', [
      match.tournament_id ?? 1,
    ]);
    if (!t) {
      return res.status(500).json({
        success: false,
        error: 'Tournament not found',
      });
    }

    // 3) Hydrate a Tournament-like object for config generation
    const tournament: TournamentResponse = {
      id: t.id,
      name: t.name,
      type: t.type as TournamentResponse['type'],
      format: t.format as TournamentResponse['format'],
      status: t.status as TournamentResponse['status'],
      maps: JSON.parse(t.maps),
      teamIds: JSON.parse(t.team_ids),
      settings: t.settings ? JSON.parse(t.settings) : {},
      created_at: t.created_at,
      updated_at: t.updated_at ?? t.created_at,
      started_at: t.started_at,
      completed_at: t.completed_at,
      teams: [], // Not needed for config generation
      // Carry shuffle / round-limit fields so matchConfigBuilder can honor them.
      mapSequence: t.map_sequence ? JSON.parse(t.map_sequence) : undefined,
      teamSize:
        t.team_size === null || typeof t.team_size === 'undefined' ? undefined : t.team_size,
      maxRounds:
        t.max_rounds === null || typeof t.max_rounds === 'undefined'
          ? undefined
          : t.max_rounds,
      overtimeMode: (t.overtime_mode as 'enabled' | 'disabled' | null) || undefined,
      overtimeSegments:
        t.overtime_segments === null || typeof t.overtime_segments === 'undefined'
          ? undefined
          : t.overtime_segments,
      eloTemplateId: t.elo_template_id ?? undefined,
    };

    // 4) Generate a fresh config (reads veto_state internally)
    const fresh = await generateMatchConfig(
      tournament,
      match.team1_id ?? undefined,
      match.team2_id ?? undefined,
      slug
    );

    // Return raw MatchZy config
    return res.json(fresh);
  } catch (error) {
    console.error('Error fetching match config:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch match configuration',
    });
  }
});

/**
 * DELETE /api/matches/:slug
 * Delete a match by slug (admin only).
 *
 * IMPORTANT: For safety, this endpoint only allows deleting **manual**
 * matches (round = 0). Bracket/tournament matches are tightly coupled to
 * the tournament structure (next_match_id, standings, history, etc.) and
 * must be reset via the dedicated tournament reset/regeneration flows
 * instead of being deleted piecemeal.
 */
router.delete('/:slug', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      slug,
    ]);
    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found',
      });
    }

    // Guardrail: only allow deleting manual (non‑bracket) matches.
    // Bracket matches always have round >= 1 and are managed by the
    // tournament/bracket flows; deleting them directly could corrupt
    // progression or historical stats.
    if (match.round !== 0) {
      return res.status(400).json({
        success: false,
        error:
          'Deleting bracket/tournament matches is not supported. Use the tournament reset/regeneration tools instead.',
      });
    }

    await matchService.deleteMatch(slug);
    if ((await hudProjectionService.getBroadcastMatchSlug()) === slug) {
      await hudProjectionService.setBroadcastMatch(null);
      emitHudProjectionInvalidated('broadcast-match-deleted');
    }
    emitMatchUpdate({ slug, deleted: true });
    log.success(`Match deleted via API: ${slug}`);

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete match',
    });
  }
});

/**
 * POST /api/matches/bulk-delete
 * Bulk delete **manual** matches by slug array (admin only).
 *
 * This reuses the same guardrails as the single-delete endpoint:
 * - Only matches with round = 0 are eligible.
 */
router.post('/bulk-delete', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slugs } = req.body as { slugs?: string[] };

    if (!Array.isArray(slugs) || slugs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Request body must include a non-empty slugs array',
      });
    }

    let deleted = 0;
    const skipped: { slug: string; reason: string }[] = [];
    const failed: { slug: string; error: string }[] = [];

    for (const slug of slugs) {
      try {
        const match = await db.queryOneAsync<DbMatchRow>(
          'SELECT * FROM matches WHERE slug = ?',
          [slug]
        );
        if (!match) {
          skipped.push({ slug, reason: 'not_found' });
          continue;
        }
        if (match.round !== 0) {
          skipped.push({ slug, reason: 'not_manual_round_0' });
          continue;
        }

        await matchService.deleteMatch(slug);
        if ((await hudProjectionService.getBroadcastMatchSlug()) === slug) {
          await hudProjectionService.setBroadcastMatch(null);
          emitHudProjectionInvalidated('broadcast-match-deleted');
        }
        emitMatchUpdate({ slug, deleted: true });
        deleted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete match';
        failed.push({ slug, error: message });
        log.error('Error bulk deleting match', { error, slug });
      }
    }

    // After bulk deletion, trigger immediate allocation if any servers were freed
    if (deleted > 0) {
      log.info(`Bulk deleted ${deleted} match(es), triggering immediate allocation`);
      setImmediate(() => {
        void matchAllocationService.tryImmediateAllocation();
      });
    }

    const statusCode = failed.length > 0 ? 207 : 200;
    return res.status(statusCode).json({
      success: failed.length === 0,
      deleted,
      skipped,
      failed,
    });
  } catch (error) {
    console.error('Error bulk deleting matches:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to bulk delete matches',
    });
  }
});

/**
 * GET /api/matches
 * List all matches (public - used by team pages)
 * Returns tournament matches with team information
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const serverAccess = await getMatchServerAccess(req);
    const publicView = req.query.public === 'true' || !serverAccess.isAdmin;
    const controlMode = await operatorControlService.getControlMode();
    const playerReadyEnabled = await operatorControlService.isPlayerReadyEnabled();
    const autoPrepareNextMatch = await operatorControlService.isAutoPrepareNextMatchEnabled();
    const autoStartNextMap = await operatorControlService.isAutoStartNextMapEnabled();
    if (controlMode !== 'automatic') {
      await operatorControlService.ensureQueuePositions();
    }

    const serverId = req.query.serverId as string | undefined;
    // Fetch matches with tournament and server information
    let query = `
      SELECT 
        m.*,
        t1.id as team1_id, t1.name as team1_name, t1.tag as team1_tag,
        t2.id as team2_id, t2.name as team2_name, t2.tag as team2_tag,
        w.id as winner_id, w.name as winner_name, w.tag as winner_tag,
        s.name as server_name,
        s.host as server_host,
        s.port as server_port
      FROM matches m
      LEFT JOIN teams t1 ON m.team1_id = t1.id
      LEFT JOIN teams t2 ON m.team2_id = t2.id
      LEFT JOIN teams w ON m.winner_id = w.id
      LEFT JOIN servers s ON m.server_id = s.id
    `;

    const params: unknown[] = [];
    const filters: string[] = [];
    if (serverId) {
      filters.push('m.server_id = ?');
      params.push(serverId);
    }

    // Public match pages intentionally expose only a rolling seven-day window.
    // Use completion time for finished matches and creation time for active ones.
    if (publicView) {
      filters.push('COALESCE(m.completed_at, m.created_at) >= ?');
      params.push(Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60);
    }

    if (filters.length > 0) {
      query += ` WHERE ${filters.join(' AND ')}`;
    }

    query += ' ORDER BY m.created_at DESC';

    // This query includes JOIN columns that extend DbMatchRow
    const rows = await db.queryAsync<
      DbMatchRow & {
        team1_name?: string;
        team1_tag?: string;
        team2_name?: string;
        team2_tag?: string;
        winner_name?: string;
        winner_tag?: string;
        demo_file_path?: string;
        server_name?: string | null;
        server_host?: string | null;
        server_port?: number | null;
      }
    >(query, params);

    // Get tournament type once (optimization to avoid N+1 queries)
    const tournamentType = await db.queryOneAsync<{ type: string }>(
      'SELECT type FROM tournament WHERE id = ?',
      [rows[0]?.tournament_id || 1]
    );
    const isShuffleTournament = tournamentType?.type === 'shuffle';

    // Transform players from dictionary to array for frontend
    const matches: MatchListItem[] = await Promise.all(
      rows.map(async (row) => {
        // For bracket-managed matches (round >= 1) rebuild config on demand so
        // admin views always see the latest team composition and settings. Manual
        // matches (round = 0) keep their stored config.
        let config: MatchConfig | Record<string, unknown>;
        if (typeof row.round === 'number' && row.round >= 1 && row.tournament_id) {
          const tournamentRow = await db.queryOneAsync<DbTournamentRow>(
            'SELECT * FROM tournament WHERE id = ?',
            [row.tournament_id]
          );
          if (tournamentRow) {
            const t = tournamentRow;
            const tournament: TournamentResponse = {
              id: t.id,
              name: t.name,
              type: t.type as TournamentResponse['type'],
              format: t.format as TournamentResponse['format'],
              status: t.status as TournamentResponse['status'],
              maps: JSON.parse(t.maps),
              teamIds: JSON.parse(t.team_ids),
              settings: t.settings ? JSON.parse(t.settings) : {},
              created_at: t.created_at,
              updated_at: t.updated_at ?? t.created_at,
              started_at: t.started_at,
              completed_at: t.completed_at,
              teams: [],
              mapSequence: t.map_sequence ? JSON.parse(t.map_sequence) : undefined,
              teamSize:
                t.team_size === null || typeof t.team_size === 'undefined'
                  ? undefined
                  : t.team_size,
              maxRounds:
                t.max_rounds === null || typeof t.max_rounds === 'undefined'
                  ? undefined
                  : t.max_rounds,
              overtimeMode: (t.overtime_mode as 'enabled' | 'disabled' | null) || undefined,
              overtimeSegments:
                t.overtime_segments === null || typeof t.overtime_segments === 'undefined'
                  ? undefined
                  : t.overtime_segments,
              eloTemplateId: t.elo_template_id ?? undefined,
            };

            config = await generateMatchConfig(
              tournament,
              row.team1_id ?? undefined,
              row.team2_id ?? undefined,
              row.slug
            );
          } else {
            config = row.config ? JSON.parse(row.config as string) : {};
          }
        } else {
          config = row.config ? JSON.parse(row.config as string) : {};
        }

        const vetoState = row.veto_state ? JSON.parse(row.veto_state as string) : null;

        // Normalize players and enrich with avatars from team data
        const normalizedTeam1Players = config.team1
          ? normalizeConfigPlayers(config.team1.players)
          : [];
        const normalizedTeam2Players = config.team2
          ? normalizeConfigPlayers(config.team2.players)
          : [];

        // Enrich players with avatars from team records if team IDs are available
        let enrichedTeam1Players = normalizedTeam1Players;
        let enrichedTeam2Players = normalizedTeam2Players;

        if (config.team1?.id && row.team1_id) {
          try {
            const team1Data = await teamService.getTeamById(config.team1.id);
            if (team1Data?.players) {
              const avatarMap = new Map(
                team1Data.players.map((p) => [p.steamId.toLowerCase(), p.avatar])
              );
              enrichedTeam1Players = normalizedTeam1Players.map((p) => ({
                ...p,
                avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
              }));
            }
          } catch (error) {
            log.debug(
              `Failed to enrich team1 players with avatars: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        if (config.team2?.id && row.team2_id) {
          try {
            const team2Data = await teamService.getTeamById(config.team2.id);
            if (team2Data?.players) {
              const avatarMap = new Map(
                team2Data.players.map((p) => [p.steamId.toLowerCase(), p.avatar])
              );
              enrichedTeam2Players = normalizedTeam2Players.map((p) => ({
                ...p,
                avatar: p.avatar || avatarMap.get(p.steamid.toLowerCase()),
              }));
            }
          } catch (error) {
            log.debug(
              `Failed to enrich team2 players with avatars: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        // Transform config to include properly formatted team players with avatars
        const transformedConfig = {
          ...config,
          team1: config.team1
            ? {
                ...config.team1,
                players: enrichedTeam1Players,
              }
            : undefined,
          team2: config.team2
            ? {
                ...config.team2,
                players: enrichedTeam2Players,
              }
            : undefined,
        };

        const match: MatchListItem = {
          id: row.id,
          slug: row.slug,
          round: row.round,
          matchNumber: row.match_number,
          team1:
            row.team1_id && row.team1_name
              ? {
                  id: row.team1_id,
                  name: row.team1_name,
                  tag: row.team1_tag,
                }
              : undefined,
          team2:
            row.team2_id && row.team2_name
              ? {
                  id: row.team2_id,
                  name: row.team2_name,
                  tag: row.team2_tag,
                }
              : undefined,
          winner:
            row.winner_id && row.winner_name
              ? {
                  id: row.winner_id,
                  name: row.winner_name,
                  tag: row.winner_tag,
                }
              : undefined,
          status: row.status,
          serverId: row.server_id,
          serverName: row.server_name || undefined,
          serverHost: row.server_host || undefined,
          serverPort: row.server_port || undefined,
          config: transformedConfig,
          demoFilePath: row.demo_file_path,
          createdAt: row.created_at ?? 0,
          loadedAt: row.loaded_at,
          completedAt: row.completed_at,
          vetoCompleted: vetoState?.status === 'completed',
          currentMap: row.current_map ?? undefined,
          mapNumber: typeof row.map_number === 'number' ? row.map_number : undefined,
          matchPhase: (() => {
            const phase = matchLiveStatsService.getStats(row.slug)?.status;
            return phase === 'postgame' ? 'post_match' : phase;
          })(),
          maps: undefined,
          operatorState: row.operator_state ?? 'queued',
          queuePosition: row.queue_position,
          vetoOpenedAt: row.veto_opened_at,
          postponedAt: row.postponed_at,
        };

        const mapResults = await getMapResults(row.slug);
        if (mapResults.length > 0) {
          match.mapResults = mapResults;
        }

        if (Array.isArray(vetoState?.pickedMaps) && vetoState.pickedMaps.length > 0) {
          const orderedPickedMaps = [...vetoState.pickedMaps].sort(
            (a: { mapNumber?: number }, b: { mapNumber?: number }) =>
              (a.mapNumber || 0) - (b.mapNumber || 0)
          );
          const pickedMapNames = orderedPickedMaps
            .map((m: { mapName?: string | null }) => m.mapName)
            .filter((name): name is string => Boolean(name));
          if (pickedMapNames.length > 0) {
            match.maps = pickedMapNames;
          }
        }

        if (!match.maps && mapResults.length > 0) {
          const resultsMaps = mapResults
            .map((result) => result.mapName)
            .filter((name): name is string => Boolean(name));
          if (resultsMaps.length > 0) {
            match.maps = resultsMaps;
          }
        }

        // Enrich match with player stats and scores from persisted events
        await enrichMatch(match, row.slug);

        // For COMPLETED matches, if we still don't have any non‑zero score, fall
        // back to the final map result so the admin never sees "0‑0" after a
        // full game has been played (especially for BO1/manual matches).
        if (
          row.status === 'completed' &&
          (!Number.isFinite(match.team1Score as number) || !Number.isFinite(match.team2Score as number) ||
            ((match.team1Score as number) === 0 && (match.team2Score as number) === 0)) &&
          mapResults.length > 0
        ) {
          match.team1Score = mapResults.reduce(
            (wins, result) => wins + (result.team1Score > result.team2Score ? 1 : 0),
            0
          );
          match.team2Score = mapResults.reduce(
            (wins, result) => wins + (result.team2Score > result.team1Score ? 1 : 0),
            0
          );
        }

        // For matches that are still in progress, optionally overlay in‑memory
        // live stats so the admin "Matches" page reflects the most recent
        // score. As with the bracket view, prefer a positive series score when
        // available (e.g. 1‑0 in a BO3); otherwise fall back to current map
        // rounds (e.g. 8‑5) so we don't show 0‑0 while rounds are being played.
        if (row.status !== 'completed') {
          const liveStats = matchLiveStatsService.getStats(row.slug);
          if (liveStats) {
            const liveTeam1 =
              typeof liveStats.team1SeriesScore === 'number' && liveStats.team1SeriesScore > 0
                ? liveStats.team1SeriesScore
                : liveStats.team1Score;
            const liveTeam2 =
              typeof liveStats.team2SeriesScore === 'number' && liveStats.team2SeriesScore > 0
                ? liveStats.team2SeriesScore
                : liveStats.team2Score;

            if (typeof liveTeam1 === 'number' && Number.isFinite(liveTeam1)) {
              match.team1Score = liveTeam1;
            }
            if (typeof liveTeam2 === 'number' && Number.isFinite(liveTeam2)) {
              match.team2Score = liveTeam2;
            }
          }
        }

        // For shuffle tournaments, enrich players with ELO
        if (
          isShuffleTournament &&
          (enrichedTeam1Players.length > 0 || enrichedTeam2Players.length > 0)
        ) {
          try {
            const allSteamIds = [
              ...enrichedTeam1Players.map((p) => p.steamid),
              ...enrichedTeam2Players.map((p) => p.steamid),
            ];

            if (allSteamIds.length > 0) {
              const players = await playerService.getPlayersByIds(allSteamIds);
              const eloMap = new Map(players.map((p) => [p.id.toLowerCase(), p.current_elo]));

              // Add ELO to team1 players
              enrichedTeam1Players = enrichedTeam1Players.map((p) => ({
                ...p,
                elo: eloMap.get(p.steamid.toLowerCase()),
              }));

              // Add ELO to team2 players
              enrichedTeam2Players = enrichedTeam2Players.map((p) => ({
                ...p,
                elo: eloMap.get(p.steamid.toLowerCase()),
              }));

              // Update config with enriched players
              if (transformedConfig.team1) {
                transformedConfig.team1.players = enrichedTeam1Players;
              }
              if (transformedConfig.team2) {
                transformedConfig.team2.players = enrichedTeam2Players;
              }
              match.config = transformedConfig;
            }
          } catch (error) {
            log.debug(
              `Failed to enrich players with ELO: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        return match;
      })
    );

    // Calculate queue positions for matches without servers
    // Queue positions should match the display order (by round, then match_number)
    // Include all matches that are waiting for allocation (pending, ready, or any status without a server)
    // Exclude completed, cancelled, live, and loaded matches
    if (controlMode === 'automatic') {
      const queueableStatuses = ['pending', 'ready'];
      const waitingMatches = matches
        .filter((m) => !m.serverId && queueableStatuses.includes(m.status))
        .sort((a, b) => {
          if (a.round !== b.round) return a.round - b.round;
          if (a.matchNumber !== b.matchNumber) return a.matchNumber - b.matchNumber;
          return a.id - b.id;
        });

      const queuePositionMap = new Map<number, number>();
      waitingMatches.forEach((match, index) => {
        queuePositionMap.set(match.id, index + 1);
      });

      matches.forEach((match) => {
        match.queuePosition = queuePositionMap.get(match.id) ?? null;
      });
    }

    // Get tournament status
    const tournamentStatus = await db.queryOneAsync<{ status: string }>(
      'SELECT status FROM tournament WHERE id = 1'
    );

    const responseMatches = matches.map((match) =>
      canViewMatchServerConfig(match.config, serverAccess, match.status)
        ? match
        : stripMatchServerAccess(match)
    );

    return res.json({
      success: true,
      count: responseMatches.length,
      tournamentStatus: tournamentStatus?.status || 'setup',
      controlMode,
      playerReadyEnabled,
      autoPrepareNextMatch,
      autoStartNextMap,
      matches: responseMatches,
    });
  } catch (error) {
    console.error('Error fetching matches:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch matches',
    });
  }
});

/**
 * PATCH /api/matches/operator-queue
 * Persist a complete execution order independently from the tournament bracket.
 */
router.patch('/operator-queue', requireAuth, async (req: Request, res: Response) => {
  return matchExecutionLockService.runControlTransitionExclusive(async () => {
    try {
      if (!(await operatorControlService.usesOperatorQueue())) {
        return res.status(409).json({
          success: false,
          error: 'Execution queue controls are disabled in Automatic mode.',
        });
      }
      const slugs = Array.isArray(req.body?.slugs) ? req.body.slugs.map(String) : [];
      await operatorControlService.reorderQueue(slugs);
      emitBracketUpdate({ action: 'operator_queue_reordered', matchSlugs: slugs });
      return res.json({ success: true, slugs });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reorder match queue';
      return res.status(message.includes('changed') ? 409 : 400).json({
        success: false,
        error: message,
      });
    }
  });
});

/**
 * POST /api/matches/:slug/operator-action
 * Explicit operator transitions used by Assisted and Full Manual modes.
 */
router.post('/:slug/operator-action', requireAuth, async (req: Request, res: Response) => {
  return matchExecutionLockService.runControlTransitionExclusive(async () => {
    try {
      if (!(await operatorControlService.usesOperatorQueue())) {
        return res.status(409).json({
          success: false,
          error: 'Operator actions are disabled in Automatic mode.',
        });
      }
      const { slug } = req.params;
      const action = String(req.body?.action ?? '');
      let match = await operatorControlService.getMatchOrThrow(slug);

    if (action === 'set_next') {
      await operatorControlService.setNext(slug);
    } else if (action === 'hold') {
      match = await matchExecutionLockService.runExclusive(slug, () =>
        operatorControlService.hold(slug)
      );
    } else if (action === 'resume') {
      match = await matchExecutionLockService.runExclusive(slug, () =>
        operatorControlService.resume(slug)
      );
    } else if (action === 'open_veto') {
      match = await operatorControlService.openVeto(slug);
    } else if (action === 'postpone') {
      match = await matchExecutionLockService.runExclusive(slug, async () => {
        // Re-read inside the same lock used by allocation. The route-level
        // snapshot may have become stale while another Prepare was finishing.
        const current = await operatorControlService.getMatchOrThrow(slug);
        if (current.status === 'live') {
          throw new Error(
            'A live match cannot be postponed. Use emergency live-match controls.'
          );
        }

        const releasedServerId = current.server_id;
        if (releasedServerId) {
          try {
            const { rconService } = await import('../services/rconService');
            await rconService.sendCommand(releasedServerId, 'css_restart');
          } catch (error) {
            const resetError = new Error(
              'The match is loaded and its server could not be reset. It was not postponed, so MAT does not lose track of the active server.'
            ) as Error & { statusCode?: number; details?: string };
            resetError.statusCode = 502;
            resetError.details = error instanceof Error ? error.message : String(error);
            throw resetError;
          }
        }

        const postponed = await operatorControlService.postpone(slug);
        matchAllocationService.stopPollingForServer(slug);
        if (releasedServerId) {
          serverAllocationTracker.markIdle(releasedServerId);
        }
        return postponed;
      });
    } else if (action === 'prepare') {
      if (match.operator_state === 'postponed' || match.operator_state === 'held') {
        return res.status(409).json({
          success: false,
          error: 'Resume the match before preparing a server.',
        });
      }
      await operatorControlService.ensureQueuePositions();
      match = await operatorControlService.getMatchOrThrow(slug);
      if (match.queue_position !== 1) {
        return res.status(409).json({
          success: false,
          error: 'Set this match as Next before preparing its server.',
        });
      }

      const allocation = await matchAllocationService.allocateSingleMatch(
        slug,
        await getWebhookBaseUrl(req),
        {
          operatorApproved: true,
          preferredServerId:
            typeof req.body?.serverId === 'string' ? req.body.serverId : undefined,
        }
      );
      if (!allocation.success) {
        return res.status(409).json({ success: false, error: allocation.error });
      }
    } else if (action === 'start_next_map') {
      if (match.status !== 'live' || !match.server_id) {
        return res.status(409).json({
          success: false,
          error: 'Only a live match with a prepared server can start its next map.',
        });
      }
      const latestMapResult = await db.queryOneAsync<{ demo_file_path?: string | null }>(
        `SELECT demo_file_path
         FROM match_map_results
         WHERE match_slug = ?
         ORDER BY map_number DESC
         LIMIT 1`,
        [slug]
      );
      if (!latestMapResult?.demo_file_path?.trim()) {
        return res.status(409).json({
          success: false,
          error: 'Wait for the current map demo to finish uploading before starting the next map.',
        });
      }
      const result = await rconService.sendCommand(match.server_id, 'css_nextmap');
      if (!result.success) {
        const rconError = new Error(result.error ?? 'Server rejected the next-map command.') as Error & {
          statusCode?: number;
        };
        rconError.statusCode = 502;
        throw rconError;
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Unknown operator action',
      });
    }

      // A one-server broadcast follows the veto that the operator just opened.
      // This intentionally replaces an older selection, so one fixed OBS URL
      // always follows the current broadcast match like JTs-Hud does.
      const selectedBroadcastMatch = await hudProjectionService.getBroadcastMatchSlug();
      if (action === 'open_veto') {
        await hudProjectionService.setBroadcastMatch(slug);
        emitHudProjectionInvalidated('broadcast-match-auto-selected');
      } else if (
        (action === 'hold' || action === 'postpone') &&
        selectedBroadcastMatch === slug
      ) {
        await hudProjectionService.setBroadcastMatch(null);
        emitHudProjectionInvalidated('broadcast-match-cleared');
      }

      const updatedMatch = await getMatchDetailsBySlug(slug);
      emitMatchUpdate(updatedMatch ?? { slug });
      emitBracketUpdate({ action: `operator_${action}`, matchSlug: slug });
      return res.json({ success: true, action, match: updatedMatch });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operator action failed';
      const typedError = error as Error & { statusCode?: number; details?: string };
      const status =
        typedError.statusCode ??
        (message.includes('not found') ? 404 : message.includes('live') ? 409 : 400);
      return res.status(status).json({
        success: false,
        error: message,
        ...(typedError.details ? { details: typedError.details } : {}),
      });
    }
  });
});

/**
 * POST /api/matches/:slug/ruling
 * Apply a terminal tournament-operator decision. Unlike emergency force-cancel,
 * technical wins progress the bracket through the normal winner/loser wiring.
 */
router.post('/:slug/ruling', requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params;
  return matchExecutionLockService.runExclusive(slug, async () => {
    try {
      const kind = req.body?.kind;
      const winnerSide = req.body?.winnerSide;
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';

      if (kind !== 'technical_win' && kind !== 'void') {
        return res.status(400).json({ success: false, error: 'Unknown ruling kind' });
      }
      if (kind === 'technical_win' && winnerSide !== 'team1' && winnerSide !== 'team2') {
        return res.status(400).json({ success: false, error: 'Technical win requires team1 or team2' });
      }

      const sessionSteamId = (req as Request & { user?: { steamId?: string } }).user?.steamId;
      const adminSteamId = sessionSteamId ?? getVerifiedPlayerSteamId(req.headers.cookie) ?? null;
      const result = await matchRulingService.apply({
        matchSlug: slug,
        kind,
        winnerSide,
        reason,
        adminSteamId,
      });

      return res.json({
        success: true,
        ruling: kind,
        match: await getMatchDetailsBySlug(result.match.slug),
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply match ruling';
      return res.status(message.includes('not found') ? 404 : 409).json({ success: false, error: message });
    }
  });
});

/**
 * GET /api/matches/:slug
 * Get match details (public - used by team pages)
 */
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const match = await getMatchDetailsBySlug(slug);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${slug}' not found`,
      });
    }

    const serverAccess = await getMatchServerAccess(req);

    return res.json({
      success: true,
      match: canViewMatchServerConfig(match.config, serverAccess, match.status)
        ? match
        : stripMatchServerAccess(match),
    });
  } catch (error) {
    console.error('Error fetching match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch match',
    });
  }
});

/**
 * POST /api/matches
 * Create a new match configuration (authenticated)
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const input: CreateMatchInput = req.body;

    if (!input.slug || !input.config) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: slug, config',
      });
    }

    // Validate config structure
    if (!input.config.team1 || !input.config.team2) {
      return res.status(400).json({
        success: false,
        error: 'Match config must include team1 and team2',
      });
    }

    const baseUrl = getBaseUrl(req);
    const webhookBaseUrl = await getWebhookBaseUrl(req);
    const match = await matchService.createMatch(input, baseUrl);

    // Fire-and-forget allocation so match creation returns quickly. A selected
    // server is treated as a preference and is never silently replaced.
    setImmediate(async () => {
      try {
        const allocation = await matchAllocationService.allocateSingleMatch(
          match.slug,
          webhookBaseUrl,
          input.serverId ? { preferredServerId: input.serverId } : undefined
        );
        if (!allocation.success) {
          log.warn(`Allocation failed for manual match ${match.slug}: ${allocation.error}`);
          matchAllocationService.startPollingForServer(
            match.slug,
            webhookBaseUrl,
            input.serverId
          );
        }
      } catch (allocError) {
        log.warn(`Allocation threw for manual match ${match.slug}`, allocError as Error);
        matchAllocationService.startPollingForServer(match.slug, webhookBaseUrl, input.serverId);
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Match created successfully',
      match,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create match';
    const statusCode = message.includes('already exists') || message.includes('not available')
      ? 409
      : message.includes('not found')
      ? 404
      : 400;

    console.error('Error creating match:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/matches/:slug/load
 * Load match on server via RCON (authenticated)
 * Automatically configures webhook unless ?skipWebhook=true
 */
router.post('/:slug/load', requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params;
  return matchExecutionLockService.runExclusive(slug, async () => {
    try {
      const skipWebhook = req.query.skipWebhook === 'true';
      const match = await matchService.getMatchBySlug(slug, getBaseUrl(req));

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${slug}' not found`,
      });
    }

    const baseUrl = await getWebhookBaseUrl(req);

    // For manual matches (round = 0), double‑check that the selected server is
    // still truly available at load time. The admin UI already filters
    // "busy"/non‑allocatable servers out of the dropdown, but there is still a
    // race window where a server can become allocated between the time the
    // modal is opened and the match is created. If that happens, we try to
    // transparently re‑allocate the match to a different idle server instead
    // of letting it hang forever.
    let serverIdToUse = match.serverId;
    if (typeof match.round === 'number' && match.round === 0 && match.serverId) {
      const busy = await db.queryOneAsync<{ count: number }>(
        `SELECT COUNT(*) as count
           FROM matches
          WHERE server_id = ?
            AND slug != ?
            AND status IN ('ready', 'loaded', 'live')`,
        [match.serverId, slug]
      );

      if (busy && busy.count > 0) {
        log.warn(
          `Manual match ${slug} requested busy server ${match.serverId}; attempting re‑allocation`
        );

        const availableServers = await matchAllocationService.getAvailableServers();
        const fallback = availableServers.find((s) => s.id !== match.serverId);

        if (fallback) {
          await db.updateAsync('matches', { server_id: fallback.id }, 'id = ?', [match.id]);
          serverIdToUse = fallback.id;
          log.success(
            `Re‑allocated manual match ${slug} from busy server ${match.serverId} to ${fallback.id}`
          );
        } else {
          return res.status(409).json({
            success: false,
            error:
              'Selected server is now busy with another match and no alternative idle servers are available. Please try again in a moment or free up a server.',
          });
        }
      }
    }

    // Use centralized match loading service
    const result = await loadMatchOnServer(slug, serverIdToUse, {
      skipWebhook,
      baseUrl,
      resetBeforeLoad: true,
    });

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.webhookConfigured
          ? 'Match loaded and webhook configured'
          : 'Match loaded (webhook skipped)',
        webhookConfigured: result.webhookConfigured,
        demoUploadConfigured: result.demoUploadConfigured,
        match: await matchService.getMatchBySlug(slug, getBaseUrl(req)),
        rconResponses: result.rconResponses,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to load match',
        webhookConfigured: result.webhookConfigured,
        demoUploadConfigured: result.demoUploadConfigured,
        rconResponses: result.rconResponses,
      });
    }
    } catch (error) {
      console.error('Error loading match:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load match on server',
      });
    }
  });
});

/**
 * POST /api/matches/:slug/restart
 * Restart a match - end it and reload it (authenticated)
 */
router.post('/:slug/restart', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const baseUrl = await getWebhookBaseUrl(req);

    const result = await matchAllocationService.restartMatch(slug, baseUrl);

    if (result.success) {
      log.success(`Match ${slug} restarted successfully`);

      // Emit match restart event
      const updatedMatch = await matchService.getMatchBySlug(slug, baseUrl);
      if (updatedMatch) {
        emitMatchUpdate(updatedMatch);
        emitBracketUpdate({ action: 'match_restarted', matchSlug: slug });
      }

      return res.json({
        success: true,
        message: result.message,
        match: updatedMatch,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.message,
      });
    }
  } catch (error) {
    log.error(`Error restarting match`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to restart match',
    });
  }
});

/**
 * POST /api/matches/:slug/reallocate
 * Reallocate a match to a different server (authenticated).
 *
 * Intended for pre-live recovery (e.g. the assigned server is out of date).
 * Allowed only when match status is 'ready' or 'loaded' (never during live play).
 */
router.post('/:slug/reallocate', requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params;
  return matchExecutionLockService.runExclusive(slug, async () => {
    try {
      const baseUrl = await getWebhookBaseUrl(req);

    const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      slug,
    ]);

    if (!match) {
      return res.status(404).json({
        success: false,
        error: `Match '${slug}' not found`,
      });
    }

    const status = match.status as string | null;
    if (status !== 'ready' && status !== 'loaded') {
      return res.status(400).json({
        success: false,
        error: `Match is in '${status}' status. Can only reallocate ready/loaded matches.`,
      });
    }

    const oldServerId = match.server_id;
    if (!oldServerId) {
      return res.status(409).json({
        success: false,
        error: 'Match has no server assigned. There is nothing to reallocate.',
      });
    }

    const requestedServerId =
      typeof req.body?.serverId === 'string' && req.body.serverId !== oldServerId
        ? req.body.serverId
        : undefined;
    const availableServers = await matchAllocationService.getAvailableServers();
    const fallback = requestedServerId
      ? availableServers.find((s) => s.id === requestedServerId)
      : availableServers.find((s) => s.id !== oldServerId);

    if (!fallback) {
      return res.status(409).json({
        success: false,
        error:
          requestedServerId
            ? 'Selected server is not available for reallocation.'
            : 'No alternative idle servers are available for reallocation. Please free up a server or update existing ones.',
      });
    }

    // Best-effort: ask the old server to restart so it returns to a clean state.
    try {
      const { rconService } = await import('../services/rconService');
      await rconService.sendCommand(oldServerId, 'css_restart');
    } catch (err) {
      log.warn(`Failed to restart old server during reallocation (continuing)`, {
        matchSlug: slug,
        serverId: oldServerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Free old server from allocation tracker immediately.
    serverAllocationTracker.markIdle(oldServerId);

    // Reserve the new server in the tracker so the allocator won't race us.
    serverAllocationTracker.markAllocated(fallback.id, slug);

    // Update match to point to the new server and reset it to a clean pre-load state.
    await db.updateAsync(
      'matches',
      {
        server_id: fallback.id,
        status: 'ready',
        loaded_at: null,
      },
      'slug = ?',
      [slug]
    );

    // Load on the new server.
    const load = await loadMatchOnServer(slug, fallback.id, {
      baseUrl,
      resetBeforeLoad: true,
    });

    if (!load.success) {
      // Roll back the tracker reservation. In operator-controlled modes, return
      // the match to the execution queue instead of leaving it in an assigned
      // but unloaded state that Control Room cannot prepare again.
      serverAllocationTracker.markIdle(fallback.id);
      if (await operatorControlService.usesOperatorQueue()) {
        await db.updateAsync(
          'matches',
          { server_id: null, status: 'ready', loaded_at: null },
          'slug = ?',
          [slug]
        );
        await operatorControlService.ensureQueuePositions();
      }
      return res.status(400).json({
        success: false,
        error: load.error || 'Failed to load match on the reallocated server',
        rconResponses: load.rconResponses,
      });
    }

    const updatedMatch = await matchService.getMatchBySlug(slug, baseUrl);
    if (updatedMatch) {
      emitMatchUpdate(updatedMatch);
      emitBracketUpdate({ action: 'match_reallocated', matchSlug: slug });
    }

    return res.json({
      success: true,
      message: `Match reallocated from ${oldServerId} to ${fallback.id}`,
      match: updatedMatch,
      rconResponses: load.rconResponses,
    });
    } catch (error) {
      log.error(`Error reallocating match`, error);
      return res.status(500).json({
        success: false,
        error: 'Failed to reallocate match',
      });
    }
  });
});

/**
 * POST /api/matches/:slug/live-reallocate
 * Capture the current MatchZy round checkpoint and move the live match.
 */
router.post('/:slug/live-reallocate', requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params;
  return matchExecutionLockService.runExclusive(slug, async () => {
    let oldServerId: string | undefined;
    let targetServerId: string | undefined;
    let migrationCommitted = false;
    try {
      const baseUrl = await getWebhookBaseUrl(req);
      const serverToken = process.env.SERVER_TOKEN || '';
      if (!serverToken) {
        return res.status(500).json({ success: false, error: 'SERVER_TOKEN is not configured' });
      }

      const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
      if (!match) {
        return res.status(404).json({ success: false, error: `Match '${slug}' not found` });
      }
      if (match.status !== 'live') {
        return res.status(400).json({
          success: false,
          error: `Match is in '${match.status}' status. Live reallocation is available only during live play.`,
        });
      }
      oldServerId = match.server_id;
      if (!oldServerId) {
        return res.status(409).json({ success: false, error: 'Live match has no source server assigned.' });
      }

      const requestedServerId =
        typeof req.body?.serverId === 'string' && req.body.serverId !== oldServerId
          ? req.body.serverId
          : undefined;
      const availableServers = await matchAllocationService.getAvailableServers();
      const target = requestedServerId
        ? availableServers.find((server) => server.id === requestedServerId)
        : availableServers.find((server) => server.id !== oldServerId);
      if (!target) {
        return res.status(409).json({
          success: false,
          error: requestedServerId
            ? 'Selected server is not available for live reallocation.'
            : 'No alternative idle servers are available for live reallocation.',
        });
      }
      targetServerId = target.id;
      serverAllocationTracker.markAllocated(targetServerId, slug);
      liveReallocationStates.delete(slug);

      const captureUrl = `${baseUrl}/api/matches/${encodeURIComponent(slug)}/live-reallocation-state`;
      const captureCommand =
        `matchzy_live_reallocate_capture "${captureUrl}" "X-MatchZy-Token" "${serverToken}"`;
      const capture = await rconService.sendCommand(oldServerId, captureCommand);
      if (!capture.success) {
        serverAllocationTracker.markIdle(targetServerId);
        return res.status(400).json({ success: false, error: capture.error || 'Failed to capture live match state.' });
      }

      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && !liveReallocationStates.has(slug)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!liveReallocationStates.has(slug)) {
        serverAllocationTracker.markIdle(targetServerId);
        return res.status(504).json({
          success: false,
          error: 'Source server did not upload a live match checkpoint in time. The source match remains paused.',
        });
      }

      await db.updateAsync(
        'matches',
        { server_id: targetServerId, status: 'ready', loaded_at: null },
        'slug = ?',
        [slug]
      );
      const load = await loadMatchOnServer(slug, targetServerId, {
        baseUrl,
        resetBeforeLoad: true,
      });
      if (!load.success) {
        await db.updateAsync('matches', { server_id: oldServerId, status: 'live' }, 'slug = ?', [slug]);
        await rconService.sendCommand(targetServerId, 'css_restart');
        serverAllocationTracker.markIdle(targetServerId);
        liveReallocationStates.delete(slug);
        return res.status(400).json({ success: false, error: load.error || 'Failed to prepare target server.' });
      }

      const stateUrl = `${baseUrl}/api/matches/${encodeURIComponent(slug)}/live-reallocation-state`;
      const restore = await rconService.sendCommand(
        targetServerId,
        `matchzy_loadbackup_url "${stateUrl}" "X-MatchZy-Token" "${serverToken}"`
      );
      if (!restore.success) {
        await db.updateAsync('matches', { server_id: oldServerId, status: 'live' }, 'slug = ?', [slug]);
        await rconService.sendCommand(targetServerId, 'css_restart');
        serverAllocationTracker.markIdle(targetServerId);
        liveReallocationStates.delete(slug);
        return res.status(400).json({ success: false, error: restore.error || 'Target server rejected the live checkpoint.' });
      }

      const targetAddress = `${target.host}:${target.port}`;
      const announce = await rconService.sendCommand(
        oldServerId,
        `matchzy_live_reallocate_redirect "${targetAddress}"`
      );
      if (!announce.success) {
        await db.updateAsync('matches', { server_id: oldServerId, status: 'live' }, 'slug = ?', [slug]);
        await rconService.sendCommand(targetServerId, 'css_restart');
        serverAllocationTracker.markIdle(targetServerId);
        liveReallocationStates.delete(slug);
        return res.status(502).json({
          success: false,
          error: announce.error || 'Source server could not announce the replacement server.',
        });
      }

      // Give players time to read the replacement address, then reset the
      // source server so it cannot keep the migrated match live.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const sourceReset = await rconService.sendCommand(oldServerId, 'css_restart');
      if (!sourceReset.success) {
        log.warn(`Live reallocation completed but source server reset failed`, {
          matchSlug: slug,
          serverId: oldServerId,
          error: sourceReset.error,
        });
      }
      serverAllocationTracker.markIdle(oldServerId);

      migrationCommitted = true;
      liveReallocationStates.delete(slug);

      const updatedMatch = await matchService.getMatchBySlug(slug, baseUrl);
      if (updatedMatch) {
        emitMatchUpdate(updatedMatch);
        emitBracketUpdate({ action: 'match_live_reallocated', matchSlug: slug, serverId: targetServerId });
      }
      return res.json({
        success: true,
        message: `Live match moved from ${oldServerId} to ${targetServerId}`,
        match: updatedMatch,
        playerRedirected: announce.success,
        sourceReset: sourceReset.success,
        manualConnectAddress: targetAddress,
      });
    } catch (error) {
      if (!migrationCommitted && oldServerId && targetServerId) {
        try {
          await db.updateAsync('matches', { server_id: oldServerId, status: 'live' }, 'slug = ?', [slug]);
          await rconService.sendCommand(targetServerId, 'css_restart');
        } catch (rollbackError) {
          log.error(`Error rolling back live reallocation`, rollbackError);
        }
      }
      if (targetServerId) serverAllocationTracker.markIdle(targetServerId);
      liveReallocationStates.delete(slug);
      log.error(`Error live-reallocating match`, error);
      return res.status(500).json({ success: false, error: 'Failed to live-reallocate match' });
    }
  });
});

/** MatchZy source upload endpoint for the temporary live checkpoint. */
router.post(
  '/:slug/live-reallocation-state',
  validateServerToken,
  express.raw({ type: 'application/octet-stream', limit: '10mb' }),
  async (req: Request, res: Response) => {
    const { slug } = req.params;
    const match = await db.queryOneAsync<{ id: number }>('SELECT id FROM matches WHERE slug = ?', [slug]);
    if (!match) return res.status(404).json({ success: false, error: 'Match not found' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ success: false, error: 'Expected a non-empty binary checkpoint' });
    }
    try {
      const parsed = JSON.parse(req.body.toString('utf8')) as { matchid?: number | string };
      if (String(parsed.matchid) !== String(match.id)) {
        return res.status(400).json({ success: false, error: 'Checkpoint does not belong to this match' });
      }
    } catch {
      return res.status(400).json({ success: false, error: 'Checkpoint is not valid JSON' });
    }
    liveReallocationStates.set(slug, { payload: req.body, receivedAt: Date.now() });
    return res.status(200).json({ success: true, bytes: req.body.length });
  }
);

/** MatchZy target download endpoint for the temporary live checkpoint. */
router.get('/:slug/live-reallocation-state', validateServerToken, (req: Request, res: Response) => {
  const state = liveReallocationStates.get(req.params.slug);
  if (!state || Date.now() - state.receivedAt > 60000) {
    liveReallocationStates.delete(req.params.slug);
    return res.status(404).json({ success: false, error: 'Live checkpoint is no longer available' });
  }
  return res.type('application/json').send(state.payload);
});

/**
 * PATCH /api/matches/:slug/status
 * Update match status (authenticated)
 */
router.patch('/:slug/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { status } = req.body;

    if (!status || !['pending', 'loaded', 'live', 'completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be: pending, loaded, live, or completed',
      });
    }

    await matchService.updateMatchStatus(slug, status);
    const match = await matchService.getMatchBySlug(slug, getBaseUrl(req));

    return res.json({
      success: true,
      message: 'Match status updated',
      match,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update status';
    const statusCode = message.includes('not found') ? 404 : 500;

    console.error('Error updating match status:', error);
    return res.status(statusCode).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/matches/:slug/force-cancel
 * Force cancel a match even if the server is unreachable (authenticated)
 * This will:
 * - Try to end the match on the server (best effort, doesn't fail if server is down)
 * - Mark the match as completed in database
 * - Free up the server allocation
 */
router.post('/:slug/force-cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    
    // Get the match
    const match = await db.queryOneAsync<DbMatchRow>(
      'SELECT * FROM matches WHERE slug = ?',
      [slug]
    );

    if (!match) {
      return res.status(404).json({
        success: false,
        error: 'Match not found',
      });
    }

    const serverId = match.server_id;
    const warnings: string[] = [];

    // Try to end the match on the server (best effort)
    if (serverId) {
      try {
        const { rconService } = await import('../services/rconService');
        await rconService.executeCommand(serverId, 'get5_endmatch');
        log.info(`Successfully sent end match command to server ${serverId} for match ${slug}`);
      } catch (rconError) {
        // Don't fail the whole operation if RCON fails - this is the whole point
        const errorMsg = rconError instanceof Error ? rconError.message : String(rconError);
        log.warn(`Failed to send end match command to server (continuing anyway): ${errorMsg}`);
        warnings.push(`Server unreachable (${errorMsg}) - match marked as cancelled anyway`);
      }
    }

    // Same settle-up the End Match control performs; shared so the two paths
    // cannot drift apart.
    const { settleEndedMatch } = await import('../services/matchTerminationService');
    await settleEndedMatch(match, 'force-cancel');

    return res.json({
      success: true,
      message: 'Match cancelled successfully',
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel match';
    log.error('Error force-cancelling match:', error);
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;
