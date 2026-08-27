import { db } from '../config/database';
import type { MatchConfig, MatchPlayer } from '../types/match.types';

function getRosterSteamIds(players: unknown): string[] {
  if (Array.isArray(players)) {
    return players.flatMap((player) => {
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
