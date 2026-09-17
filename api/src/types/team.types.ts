/**
 * Team-related types
 */

export interface Player {
  steamId: string;
  name: string;
  countryCode?: string;
  avatar?: string;
  elo?: number; // Optional ELO rating (defaults to 3000 if not specified)
}

export interface Team {
  id: string;
  name: string;
  tag?: string;
  country_code?: string;
  logo_url?: string;
  discord_role_id?: string;
  captain_steam_id?: string | null;
  players: string; // JSON string of Player[]
  created_at: number;
  updated_at: number;
}

export interface TeamResponse {
  id: string;
  name: string;
  tag?: string;
  countryCode?: string;
  logoUrl?: string;
  discordRoleId?: string;
  captainSteamId?: string | null;
  players: Player[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateTeamInput {
  id: string;
  name: string;
  tag?: string;
  countryCode?: string;
  logoUrl?: string | null;
  discordRoleId?: string;
  captainSteamId?: string | null;
  players: Player[];
}

export interface UpdateTeamInput {
  name?: string;
  tag?: string;
  countryCode?: string;
  logoUrl?: string | null;
  discordRoleId?: string;
  captainSteamId?: string | null;
  players?: Player[];
}
