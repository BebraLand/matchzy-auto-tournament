import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowDownward,
  ArrowUpward,
  FastForward,
  PauseCircleOutline,
  PlayArrow,
  PublishedWithChanges,
  RestartAlt,
  Tune,
} from '@mui/icons-material';
import type { Match } from '../../types';

export type TournamentControlMode = 'automatic' | 'assisted' | 'manual';
export type OperatorAction =
  | 'set_next'
  | 'open_veto'
  | 'prepare'
  | 'postpone'
  | 'hold'
  | 'resume'
  | 'go_live'
  | 'start_next_map';

interface OperatorControlRoomProps {
  matches: Match[];
  controlMode: TournamentControlMode;
  busyKey: string | null;
  connectionStatuses: Map<string, { totalConnected: number }>;
  onModeChange: (mode: TournamentControlMode) => Promise<void>;
  onAction: (match: Match, action: OperatorAction) => Promise<void>;
  onReorder: (slugs: string[]) => Promise<void>;
}

const MODE_COPY: Record<TournamentControlMode, string> = {
  automatic: 'Upstream behaviour: veto and server allocation continue automatically.',
  assisted: 'MAT builds the bracket and recommends the next match. Veto and server preparation wait for you.',
  manual: 'Every execution step waits for the operator. Bracket logic and results still remain automated.',
};

function teamName(match: Match, side: 'team1' | 'team2'): string {
  const team = side === 'team1' ? match.team1 : match.team2;
  const configTeam = side === 'team1' ? match.config?.team1 : match.config?.team2;
  return team?.name || configTeam?.name || 'TBD';
}

function operatorLabel(match: Match): string {
  if (match.status === 'live') return 'LIVE';
  if (match.status === 'loaded') return 'PREPARED';
  if (match.operatorState === 'postponed') return 'POSTPONED';
  if (match.operatorState === 'held') return 'HOLD';
  if (match.queuePosition === 1) return 'NEXT';
  return 'QUEUED';
}

function operatorColor(match: Match): 'error' | 'info' | 'warning' | 'success' | 'default' {
  if (match.status === 'live') return 'error';
  if (match.status === 'loaded') return 'info';
  if (match.operatorState === 'postponed' || match.operatorState === 'held') return 'warning';
  if (match.queuePosition === 1) return 'success';
  return 'default';
}

export function OperatorControlRoom({
  matches,
  controlMode,
  busyKey,
  connectionStatuses,
  onModeChange,
  onAction,
  onReorder,
}: OperatorControlRoomProps) {
  const queued = matches
    .filter(
      (match) =>
        (match.status === 'pending' || match.status === 'ready') &&
        (match.operatorState ?? 'queued') === 'queued'
    )
    .sort((a, b) => (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER));
  const active = matches.filter((match) => match.status === 'loaded' || match.status === 'live');
  const parked = matches.filter(
    (match) => match.operatorState === 'postponed' || match.operatorState === 'held'
  );
  const visible = [...active, ...queued, ...parked];

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= queued.length) return;
    const reordered = [...queued];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await onReorder(reordered.map((match) => match.slug));
  };

  if (matches.length === 0) return null;

  return (
    <Card data-testid="operator-control-room" sx={{ mb: 3, border: 1, borderColor: 'primary.dark' }}>
      <CardContent>
        <Stack spacing={2.5}>
          <Box display="flex" gap={2} justifyContent="space-between" alignItems="flex-start" flexWrap="wrap">
            <Box>
              <Box display="flex" gap={1} alignItems="center">
                <Tune color="primary" />
                <Typography variant="h6" fontWeight={800}>
                  Operator Control Room
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" mt={0.5}>
                Execution order is independent from bracket order. Moving Match 2 does not rewrite the bracket.
              </Typography>
            </Box>
            <FormControl size="small" sx={{ minWidth: 210 }}>
              <InputLabel id="control-mode-label">Control mode</InputLabel>
              <Select
                labelId="control-mode-label"
                data-testid="control-mode-select"
                value={controlMode}
                label="Control mode"
                disabled={busyKey === 'mode'}
                onChange={(event) => void onModeChange(event.target.value as TournamentControlMode)}
              >
                <MenuItem value="automatic">Automatic</MenuItem>
                <MenuItem value="assisted">Assisted</MenuItem>
                <MenuItem value="manual">Full Manual</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Alert severity={controlMode === 'automatic' ? 'warning' : 'info'}>{MODE_COPY[controlMode]}</Alert>

          {controlMode !== 'automatic' && (
            <Stack spacing={1} data-testid="operator-queue">
            {visible.map((match) => {
              const queuedIndex = queued.findIndex((candidate) => candidate.slug === match.slug);
              const busy = busyKey === match.slug;
              const parkedMatch =
                match.operatorState === 'postponed' || match.operatorState === 'held';
              const unstarted = match.status === 'pending' || match.status === 'ready';
              const expectedPlayers =
                match.config?.expected_players_total ?? (match.config?.players_per_team ?? 5) * 2;
              const connectedPlayers = connectionStatuses.get(match.slug)?.totalConnected ?? 0;
              const awaitingNextMap = match.status === 'live' && match.matchPhase === 'post_match';

              return (
                <Box
                  key={match.slug}
                  data-testid={`operator-match-${match.slug}`}
                  display="flex"
                  alignItems="center"
                  gap={1.5}
                  p={1.25}
                  border={1}
                  borderColor={match.queuePosition === 1 ? 'success.main' : 'divider'}
                  borderRadius={1.5}
                  sx={{ opacity: busy ? 0.65 : 1, bgcolor: 'background.default' }}
                >
                  <Box display="flex" flexDirection="column">
                    <Tooltip title="Move earlier">
                      <span>
                        <IconButton
                          size="small"
                          disabled={busy || queuedIndex <= 0}
                          onClick={() => void move(queuedIndex, -1)}
                        >
                          <ArrowUpward fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Move later">
                      <span>
                        <IconButton
                          size="small"
                          disabled={busy || queuedIndex < 0 || queuedIndex >= queued.length - 1}
                          onClick={() => void move(queuedIndex, 1)}
                        >
                          <ArrowDownward fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>

                  <Box minWidth={0} flex={1}>
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                      <Typography fontWeight={750} noWrap>
                        {teamName(match, 'team1')} vs {teamName(match, 'team2')}
                      </Typography>
                      <Chip size="small" color={operatorColor(match)} label={operatorLabel(match)} />
                      {match.queuePosition != null && (
                        <Chip size="small" variant="outlined" label={`Queue #${match.queuePosition}`} />
                      )}
                      {match.status === 'loaded' && (
                        <Chip
                          size="small"
                          color={connectedPlayers >= expectedPlayers ? 'success' : 'warning'}
                          label={`${connectedPlayers}/${expectedPlayers} connected`}
                        />
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      Round {match.round}, bracket match {match.matchNumber} · {match.slug}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={0.75} flexWrap="wrap" justifyContent="flex-end" useFlexGap>
                    {parkedMatch ? (
                      <Button
                        size="small"
                        startIcon={<RestartAlt />}
                        disabled={busy}
                        onClick={() => void onAction(match, 'resume')}
                      >
                        Resume
                      </Button>
                    ) : (
                      <>
                        {unstarted && match.queuePosition !== 1 && (
                          <Button
                            size="small"
                            startIcon={<FastForward />}
                            disabled={busy}
                            onClick={() => void onAction(match, 'set_next')}
                          >
                            Set Next
                          </Button>
                        )}
                        {unstarted && !match.vetoOpenedAt && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<PublishedWithChanges />}
                            disabled={busy}
                            onClick={() => void onAction(match, 'open_veto')}
                          >
                            Open Veto
                          </Button>
                        )}
                        {match.status === 'ready' && !match.serverId && (
                          <Button
                            size="small"
                            variant="contained"
                            disabled={busy || match.queuePosition !== 1}
                            onClick={() => void onAction(match, 'prepare')}
                          >
                            Prepare
                          </Button>
                        )}
                        {match.status === 'loaded' && match.serverId && (
                          <Button
                            size="small"
                            color="success"
                            variant="contained"
                            startIcon={<PlayArrow />}
                            disabled={busy}
                            onClick={() => void onAction(match, 'go_live')}
                          >
                            Go Live ({connectedPlayers}/{expectedPlayers})
                          </Button>
                        )}
                        {awaitingNextMap && (
                          <Button
                            size="small"
                            color="success"
                            variant="contained"
                            startIcon={<FastForward />}
                            disabled={busy}
                            onClick={() => void onAction(match, 'start_next_map')}
                          >
                            Start Next Map
                          </Button>
                        )}
                        {unstarted && (
                          <Tooltip
                            title="Temporarily remove this unstarted match from the execution queue. Resume returns it to the end and continues any saved veto."
                          >
                            <span>
                              <Button
                                size="small"
                                color="inherit"
                                startIcon={<PauseCircleOutline />}
                                disabled={busy}
                                onClick={() => void onAction(match, 'hold')}
                              >
                                Hold
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                        {match.status !== 'live' && (
                          <Tooltip
                            title="Defer this match. If it was prepared, MAT resets and releases its server. Resume returns it to the end and continues any saved veto."
                          >
                            <span>
                              <Button
                                size="small"
                                color="warning"
                                disabled={busy}
                                onClick={() => void onAction(match, 'postpone')}
                              >
                                Postpone
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                      </>
                    )}
                  </Stack>
                </Box>
              );
            })}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
