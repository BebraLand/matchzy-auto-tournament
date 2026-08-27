import React from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import type { Server, Team } from '../../types';
import { PlayerAvatar } from '../player/PlayerAvatar';
import type { PlayerDetail } from '../../types/api.types';

interface ManualMatchBasicsStepProps {
  submitAttempted: boolean;
  teams: Team[];
  team1Id: string;
  team2Id: string;
  onTeam1Change: (teamId: string) => void;
  onTeam2Change: (teamId: string) => void;
  loadingTeams: boolean;
  servers: Server[];
  serverId: string;
  onServerChange: (serverId: string) => void;
  loadingServers: boolean;
  serverAllocation?: Map<string, { allocatable: boolean }>;
  team1Mode: 'existing' | 'new';
  team2Mode: 'existing' | 'new';
  onTeam1ModeChange: (mode: 'existing' | 'new') => void;
  onTeam2ModeChange: (mode: 'existing' | 'new') => void;
  playersPerTeam: number;
  players: PlayerDetail[];
  // Steam IDs of players currently in non-completed matches (pending/ready/loaded/live).
  busyPlayerIds?: Set<string>;
  // Team IDs that currently have an active (non-completed) match.
  busyTeamIds?: Set<string>;
  team1NewPlayerIds: string[];
  onTeam1NewPlayerIdsChange: (ids: string[]) => void;
  team2NewPlayerIds: string[];
  onTeam2NewPlayerIdsChange: (ids: string[]) => void;
  team1NewName?: string;
  team2NewName?: string;
}

export const ManualMatchBasicsStep: React.FC<ManualMatchBasicsStepProps> = ({
  submitAttempted: _submitAttempted,
  teams,
  team1Id,
  team2Id,
  onTeam1Change,
  onTeam2Change,
  loadingTeams,
  servers,
  serverId,
  onServerChange,
  loadingServers,
  serverAllocation,
  team1Mode,
  team2Mode,
  onTeam1ModeChange,
  onTeam2ModeChange,
  playersPerTeam,
  players,
  busyPlayerIds,
  busyTeamIds,
  team1NewPlayerIds,
  onTeam1NewPlayerIdsChange,
  team2NewPlayerIds,
  onTeam2NewPlayerIdsChange,
  team1NewName,
  team2NewName,
}) => {
  const effectiveSlots = Number.isFinite(playersPerTeam) && playersPerTeam > 0 ? playersPerTeam : 5;

  const findPlayerById = (id: string): PlayerDetail | null =>
    players.find((p) => p.id === id) || null;

  const selectedServer = servers.find((server) => server.id === serverId) || null;

  const renderTeamSelector = (
    label: string,
    teamId: string,
    mode: 'existing' | 'new',
    otherTeamId: string,
    onTeamChange: (teamId: string) => void,
    onModeChange: (mode: 'existing' | 'new') => void
  ) => {
    const newTeamOption: Team = { id: '__new__', name: 'New team (this match only)' };
    const options = [
      newTeamOption,
      ...teams
        .filter((team) => team.id !== otherTeamId)
        .filter((team) => !busyTeamIds?.has(team.id)),
    ];
    const selectedTeam =
      mode === 'new'
        ? newTeamOption
        : options.find((team) => team.id === teamId) || null;

    return (
      <Autocomplete
        options={options}
        value={selectedTeam}
        onChange={(_event, newValue) => {
          if (!newValue) {
            onModeChange('existing');
            onTeamChange('');
          } else if (newValue.id === newTeamOption.id) {
            onModeChange('new');
            onTeamChange('');
          } else {
            onModeChange('existing');
            onTeamChange(newValue.id);
          }
        }}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        getOptionLabel={(option) =>
          option.id === newTeamOption.id ? option.name : `${option.name} (${option.id})`
        }
        filterOptions={(teamOptions, state) => {
          const query = state.inputValue.toLowerCase();
          if (!query) return teamOptions;
          return teamOptions.filter((team) =>
            `${team.name} ${team.id}`.toLowerCase().includes(query)
          );
        }}
        renderOption={(props, option) => (
          <Box component="li" {...props}>
            <Typography variant="body2">
              {option.id === newTeamOption.id ? option.name : `${option.name} (${option.id})`}
            </Typography>
          </Box>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder="Select a team or search by name…"
            helperText={
              teams.length === 0
                ? 'No existing teams – using a one-off team for this match.'
                : mode === 'new'
                ? 'Team for this match only. Players are defined below.'
                : `Optional – select ${label} from existing teams, or choose "New team" to define players only.`
            }
          />
        )}
        noOptionsText="No teams found"
        disabled={loadingTeams}
        fullWidth
      />
    );
  };

  const renderNewTeamSelectors = (
    labelPrefix: string,
    slotIds: string[],
    onChange: (ids: string[]) => void,
    teamName: string | undefined,
    otherTeamIds: string[]
  ) => {
    const slots = Array.from({ length: effectiveSlots });
    return (
      <Box sx={{ mt: 1 }}>
        <Typography variant="subtitle2" gutterBottom>
          {labelPrefix} players ({slotIds.filter((id) => !!id).length}/{effectiveSlots})
        </Typography>
        <Box display="flex" flexDirection="column" gap={1}>
          {slots.map((_, index) => {
            const currentId = slotIds[index] ?? '';
            const currentPlayer = currentId ? findPlayerById(currentId) : null;
          // Prevent selecting the same player twice in a team or across both teams.
          const blockedIds = new Set<string>([...slotIds, ...otherTeamIds]);
          if (currentId) {
            blockedIds.delete(currentId);
          }
          const availableOptions = players.filter((p) => {
            if (blockedIds.has(p.id)) return false;
            if (busyPlayerIds && busyPlayerIds.has(p.id)) return false;
            return true;
          });
            return (
              <Autocomplete
                key={index}
                options={availableOptions}
                value={currentPlayer}
                onChange={(_event, newValue) => {
                  const next = [...slotIds];
                  next[index] = newValue?.id ?? '';
                  onChange(next);
                }}
                getOptionLabel={(option) =>
                  option.name ? `${option.name} (${option.id})` : option.id
                }
                // Allow searching by both player name and Steam ID.
                filterOptions={(options, state) => {
                  const q = state.inputValue.toLowerCase();
                  if (!q) return options;
                  return options.filter((option) => {
                    const name = (option.name || '').toLowerCase();
                    const id = option.id.toLowerCase();
                    return name.includes(q) || id.includes(q);
                  });
                }}
                renderOption={(props, option) => (
                  <Box
                    component="li"
                    {...props}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <PlayerAvatar
                      id={option.id}
                      name={option.name || option.id}
                      avatarUrl={option.avatar}
                      size={24}
                      isAdmin={option.isAdmin}
                    />
                    <Box>
                      <Typography variant="body2">{option.name || option.id}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.id}
                      </Typography>
                    </Box>
                  </Box>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={`${labelPrefix} slot ${index + 1}`}
                    placeholder="Search by name or Steam ID…"
                  />
                )}
              />
            );
          })}
        </Box>
        {teamName && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Random team name: {teamName}
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <>
      {servers.length > 1 && (
        <Autocomplete
          options={servers}
          value={selectedServer}
          onChange={(_event, newValue) => onServerChange(newValue?.id ?? '')}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          getOptionLabel={(option) => `${option.name} (${option.id})`}
          getOptionDisabled={(option) => serverAllocation?.get(option.id)?.allocatable === false}
          filterOptions={(serverOptions, state) => {
            const query = state.inputValue.toLowerCase();
            if (!query) return serverOptions;
            return serverOptions.filter((server) =>
              `${server.name} ${server.id}`.toLowerCase().includes(query)
            );
          }}
          renderOption={(props, option) => (
            <Box component="li" {...props}>
              <Typography variant="body2">{`${option.name} (${option.id})`}</Typography>
            </Box>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Server"
              placeholder="Optional – select a server or search by name…"
              helperText="Leave empty to use any free server."
            />
          )}
          noOptionsText="No servers found"
          loading={loadingServers}
          fullWidth
        />
      )}

      {/* Team 1 */}
      {renderTeamSelector(
        'Team 1',
        team1Id,
        team1Mode,
        team2Id,
        onTeam1Change,
        onTeam1ModeChange
      )}
      {team1Mode === 'new' && (
        renderNewTeamSelectors(
          'Team 1',
          team1NewPlayerIds,
          onTeam1NewPlayerIdsChange,
          team1NewName,
          team2NewPlayerIds
        )
      )}

      {/* Team 2 */}
      {renderTeamSelector(
        'Team 2',
        team2Id,
        team2Mode,
        team1Id,
        onTeam2Change,
        onTeam2ModeChange
      )}
      {team2Mode === 'new' && (
        renderNewTeamSelectors(
          'Team 2',
          team2NewPlayerIds,
          onTeam2NewPlayerIdsChange,
          team2NewName,
          team1NewPlayerIds
        )
      )}
    </>
  );
};


