import { db } from '../config/database';
import type { MatchConfig, MatchPlayer } from '../types/match.types';
import type { Request } from 'express';
import { getVerifiedPlayerSteamId } from '../utils/signedPlayerCookie';

function getRosterSteamIds(players: unknown): string[] {
  if (Array.isArray(players)) {
    return players.flatMap((player) => {
      if (typeof player === 'string') return [player];
      if (!player || typeof player !== 'object') return [];
      const steamId = (player as { steamid?: unknown; steamId?: unknown }).steamid
        ?? (player as { steamid?: unknown; steamId?: unknown }).steamId;
      return typeof steamId === 'string' && steamId.length > 0 ? [steamId] : [];
    });
  }

  if (players && typeof players === 'object') {
    return Object.keys(players as Record<string, unknown>);
  }

  return [];
}

export interface MatchServerAccess {
  steamId: string | null;
  isAdmin: boolean;
}

export async function getMatchServerAccess(req: Request): Promise<MatchServerAccess> {
  const anyReq = req as Request & {
    user?: { steamId?: string };
    isAuthenticated?: () => boolean;
  };
  const sessionSteamId =
    anyReq.isAuthenticated?.() && anyReq.user?.steamId ? anyReq.user.steamId : null;
  const steamId = sessionSteamId || getVerifiedPlayerSteamId(req.headers.cookie);

  if (!steamId) {
    return { steamId: null, isAdmin: false };
  }

  const player = await db.queryOneAsync<{ is_admin?: number | boolean }>(
    'SELECT is_admin FROM players WHERE id = ?',
    [steamId]
  );

  return {
    steamId,
    isAdmin: player?.is_admin === 1 || player?.is_admin === true,
  };
}

export function canViewMatchServerConfig(
  config: unknown,
  access: MatchServerAccess,
  matchStatus?: string
): boolean {
  // A server address is only useful before/during a match. Never expose it
  // from completed or cancelled match responses, even to administrators.
  if (matchStatus === 'completed' || matchStatus === 'cancelled') return false;
  if (!access.steamId || !config || typeof config !== 'object') return false;

  const matchConfig = config as Record<string, unknown>;
  const team1 = matchConfig.team1 as { players?: unknown } | undefined;
  const team2 = matchConfig.team2 as { players?: unknown } | undefined;
  const spectators = matchConfig.spectators as { players?: unknown } | undefined;
  const allowedSteamIds = [
    ...getRosterSteamIds(team1?.players),
    ...getRosterSteamIds(team2?.players),
    ...getRosterSteamIds(spectators?.players),
    ...getRosterSteamIds(matchConfig.admins),
  ];

  return allowedSteamIds.some(
    (steamId) => steamId.trim().toLowerCase() === access.steamId!.trim().toLowerCase()
  );
}

/**
 * Attach global MatchZy admin rights and grant spectator access to configured
 * observers/casters and admins who are not participating in either team roster.
 *
 * A Steam ID must belong to exactly one MatchZy roster. Playing admins remain
 * team players; only non-playing privileged users are added to spectators.
 * Explicitly configured non-admin spectators are preserved.
 */
export async function applyAdminMatchAccess(
  config: MatchConfig,
  options: { addAdminSpectators?: boolean } = {}
): Promise<void> {
  const accessRows = await db.queryAsync<{ id: string; name: string; is_admin: number }>(
    'SELECT id, name, is_admin FROM players WHERE is_admin = 1 OR is_spectator = 1 ORDER BY id'
  );
  const accessPlayers = Array.isArray(accessRows) ? accessRows : [];
  const admins = accessPlayers.filter((player) => player.is_admin === 1);
  config.admins = admins.map((admin) => admin.id);

  // Stored manual configs must not own computed access spectators. They are
  // resolved when the MatchZy JSON is served so role changes take effect.
  if (options.addAdminSpectators === false) {
    return;
  }

  const rosterIds = new Set([
    ...getRosterSteamIds(config.team1?.players),
    ...getRosterSteamIds(config.team2?.players),
  ]);
  const spectatorPlayers: MatchPlayer = {
    ...(config.spectators?.players || {}),
  };

  // Team assignment is authoritative. Remove any stale or manually duplicated
  // spectator entry before adding non-playing admins.
  for (const steamId of rosterIds) {
    delete spectatorPlayers[steamId];
  }

  for (const player of accessPlayers) {
    if (!rosterIds.has(player.id)) {
      spectatorPlayers[player.id] = player.name;
    }
  }

  config.spectators = {
    ...(config.spectators || {}),
    players: spectatorPlayers,
  };
}
