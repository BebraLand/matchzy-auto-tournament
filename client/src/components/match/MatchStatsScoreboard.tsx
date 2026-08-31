import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getMapDisplayName } from '../../constants/maps';
import { getPlayerPageUrl } from '../../utils/playerLinks';
import { PlayerAvatar } from '../player/PlayerAvatar';
import type { MatchMapResult, MatchPlayerStatsLine, PlayerStats } from '../../types';

type StatsPlayer = Omit<MatchPlayerStatsLine, 'headshotKills'> & {
  headshotKills: number;
  avatar?: string;
};

interface MatchStatsScoreboardProps {
  team1Name: string;
  team2Name: string;
  team1Players: Array<PlayerStats | MatchPlayerStatsLine>;
  team2Players: Array<PlayerStats | MatchPlayerStatsLine>;
  maps?: string[];
  mapResults?: MatchMapResult[];
  liveMapNumber?: number | null;
  livePlayerStats?: {
    team1: MatchPlayerStatsLine[];
    team2: MatchPlayerStatsLine[];
  } | null;
  highlightPlayerId?: string;
  playerAvatars?: Record<string, string | undefined>;
}

function normalizePlayer(player: PlayerStats | MatchPlayerStatsLine): StatsPlayer {
  const source = player as PlayerStats & Partial<MatchPlayerStatsLine>;
  return {
    name: source.name,
    steamId: source.steamId,
    kills: source.kills ?? 0,
    deaths: source.deaths ?? 0,
    assists: source.assists ?? 0,
    flashAssists: source.flashAssists ?? 0,
    enemiesFlashed: source.enemiesFlashed ?? 0,
    headshotKills: source.headshotKills ?? source.headshots ?? 0,
    damage: source.damage ?? 0,
    utilityDamage: source.utilityDamage ?? 0,
    kast: source.kast ?? 0,
    mvps: source.mvps ?? 0,
    score: source.score ?? 0,
    roundsPlayed: source.roundsPlayed ?? 0,
    avatar: (source as PlayerStats & { avatar?: string }).avatar,
  };
}

function emptyPlayer(player: PlayerStats | MatchPlayerStatsLine): StatsPlayer {
  return {
    ...normalizePlayer(player),
    kills: 0,
    deaths: 0,
    assists: 0,
    flashAssists: 0,
    enemiesFlashed: 0,
    headshotKills: 0,
    damage: 0,
    utilityDamage: 0,
    kast: 0,
    mvps: 0,
    score: 0,
    roundsPlayed: 0,
  };
}

function aggregatePlayers(
  results: MatchMapResult[],
  side: 'team1' | 'team2',
  livePlayers: MatchPlayerStatsLine[] = []
): StatsPlayer[] {
  const totals = new Map<string, StatsPlayer>();

  for (const result of results) {
    for (const player of result.playerStats?.[side] ?? []) {
      const current = totals.get(player.steamId.toLowerCase()) ?? emptyPlayer(player);
      const previousRounds = current.roundsPlayed;
      current.name = player.name || current.name;
      current.kills += player.kills;
      current.deaths += player.deaths;
      current.assists += player.assists;
      current.flashAssists += player.flashAssists;
      current.enemiesFlashed += player.enemiesFlashed;
      current.headshotKills += player.headshotKills;
      current.damage += player.damage;
      current.utilityDamage += player.utilityDamage;
      current.mvps += player.mvps;
      current.score += player.score;
      current.roundsPlayed += player.roundsPlayed;
      current.kast = current.roundsPlayed > 0
        ? (current.kast * previousRounds + player.kast * player.roundsPlayed) / current.roundsPlayed
        : 0;
      totals.set(player.steamId.toLowerCase(), current);
    }
  }

  for (const player of livePlayers) {
    const current = totals.get(player.steamId.toLowerCase()) ?? emptyPlayer(player);
    const previousRounds = current.roundsPlayed;
    current.name = player.name || current.name;
    current.kills += player.kills;
    current.deaths += player.deaths;
    current.assists += player.assists;
    current.flashAssists += player.flashAssists;
    current.enemiesFlashed += player.enemiesFlashed;
    current.headshotKills += player.headshotKills;
    current.damage += player.damage;
    current.utilityDamage += player.utilityDamage;
    current.mvps += player.mvps;
    current.score += player.score;
    current.roundsPlayed += player.roundsPlayed;
    current.kast = current.roundsPlayed > 0
      ? (current.kast * previousRounds + player.kast * player.roundsPlayed) / current.roundsPlayed
      : 0;
    totals.set(player.steamId.toLowerCase(), current);
  }

  return [...totals.values()];
}

function formatAdr(player: StatsPlayer): string {
  return player.roundsPlayed > 0 ? (player.damage / player.roundsPlayed).toFixed(1) : '—';
}

function formatRatio(numerator: number, denominator: number): string {
  if (denominator > 0) return (numerator / denominator).toFixed(2);
  return numerator > 0 ? '∞' : '—';
}

function formatHeadshotPercent(player: StatsPlayer): string {
  return player.kills > 0 ? `${((player.headshotKills / player.kills) * 100).toFixed(1)}%` : '—';
}

function renderRows(
  players: StatsPlayer[],
  accent: 'primary' | 'error',
  highlightPlayerId?: string,
  showAdvancedStats = false
) {
  return [...players]
    .sort((a, b) => b.score - a.score || b.kills - a.kills)
    .map((player) => (
      <TableRow
        key={player.steamId}
        hover
        selected={highlightPlayerId?.toLowerCase() === player.steamId.toLowerCase()}
      >
        <TableCell sx={{ minWidth: 150 }}>
          <Box display="flex" alignItems="center" gap={1}>
            <PlayerAvatar
              id={player.steamId}
              name={player.name}
              avatarUrl={player.avatar}
              size={26}
            />
            <Typography
              component="a"
              href={getPlayerPageUrl(player.steamId)}
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
              fontWeight={600}
              color={`${accent}.main`}
              sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              {player.name}
            </Typography>
          </Box>
        </TableCell>
        <TableCell align="right">{player.kills}</TableCell>
        <TableCell align="right">{player.deaths}</TableCell>
        <TableCell align="right">{player.assists}</TableCell>
        {showAdvancedStats && (
          <>
            <TableCell align="right">{formatRatio(player.kills, player.deaths)}</TableCell>
            <TableCell align="right">{formatRatio(player.kills + player.assists, player.deaths)}</TableCell>
            <TableCell align="right">{player.enemiesFlashed}</TableCell>
          </>
        )}
        <TableCell align="right">{player.kills - player.deaths}</TableCell>
        <TableCell align="right">{formatAdr(player)}</TableCell>
        <TableCell align="right">{player.kast > 0 ? `${player.kast.toFixed(1)}%` : '—'}</TableCell>
        <TableCell align="right">{player.headshotKills}</TableCell>
        {showAdvancedStats && <TableCell align="right">{formatHeadshotPercent(player)}</TableCell>}
        <TableCell align="right">{player.damage}</TableCell>
        <TableCell align="right">{player.utilityDamage}</TableCell>
        <TableCell align="right">{player.mvps}</TableCell>
        <TableCell align="right">{player.score}</TableCell>
      </TableRow>
    ));
}

export function MatchStatsScoreboard({
  team1Name,
  team2Name,
  team1Players,
  team2Players,
  maps = [],
  mapResults = [],
  liveMapNumber = null,
  livePlayerStats = null,
  highlightPlayerId,
  playerAvatars = {},
}: MatchStatsScoreboardProps) {
  const { t } = useTranslation();
  const [selectedMap, setSelectedMap] = useState<number | null>(null);
  const [showAdvancedStats, setShowAdvancedStats] = useState(false);

  const selectedResult = selectedMap === null
    ? null
    : mapResults.find((result) => result.mapNumber === selectedMap);
  const selectedLive = selectedMap !== null && selectedMap === liveMapNumber ? livePlayerStats : null;

  const withAvatar = (player: PlayerStats | MatchPlayerStatsLine): StatsPlayer => {
    const normalized = normalizePlayer(player);
    return {
      ...normalized,
      avatar: normalized.avatar ?? playerAvatars[normalized.steamId.toLowerCase()],
    };
  };

  const selectedTeam1 = selectedLive?.team1 ?? selectedResult?.playerStats?.team1;
  const selectedTeam2 = selectedLive?.team2 ?? selectedResult?.playerStats?.team2;
  const hasMapPlayerStats = mapResults.some(
    (result) => (result.playerStats?.team1.length ?? 0) > 0 || (result.playerStats?.team2.length ?? 0) > 0
  );
  const finishedMapResults = livePlayerStats && liveMapNumber !== null
    ? mapResults.filter((result) => result.mapNumber !== liveMapNumber)
    : mapResults;
  const seriesTeam1 = hasMapPlayerStats
    ? aggregatePlayers(
        finishedMapResults,
        'team1',
        livePlayerStats?.team1
      ).map(withAvatar)
    : team1Players.map(withAvatar);
  const seriesTeam2 = hasMapPlayerStats
    ? aggregatePlayers(
        finishedMapResults,
        'team2',
        livePlayerStats?.team2
      ).map(withAvatar)
    : team2Players.map(withAvatar);
  const displayTeam1 = selectedTeam1?.map(withAvatar) ?? seriesTeam1;
  const displayTeam2 = selectedTeam2?.map(withAvatar) ?? seriesTeam2;
  const hasStats = displayTeam1.length > 0 || displayTeam2.length > 0;
  const hasSelectedStats = (selectedTeam1?.length ?? 0) > 0 || (selectedTeam2?.length ?? 0) > 0;

  if (!hasStats && !mapResults.length) return null;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t('matchStats.title')}
        </Typography>
        <Button
          size="small"
          variant={showAdvancedStats ? 'contained' : 'outlined'}
          onClick={() => setShowAdvancedStats((visible) => !visible)}
        >
          {t(showAdvancedStats ? 'matchStats.hideAdvanced' : 'matchStats.showAdvanced')}
        </Button>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={2}>
        <Chip
          label={t('matchStats.allMaps')}
          color={selectedMap === null ? 'primary' : 'default'}
          variant={selectedMap === null ? 'filled' : 'outlined'}
          clickable
          onClick={() => setSelectedMap(null)}
        />
        {maps.map((map, index) => {
          const result = mapResults.find((item) => item.mapNumber === index);
          const hasMapStats = Boolean(result?.playerStats) || index === liveMapNumber;
          return (
            <Chip
              key={`${map}-${index}`}
              label={`${index + 1}. ${getMapDisplayName(map) || map}`}
              color={selectedMap === index ? 'primary' : 'default'}
              variant={selectedMap === index ? 'filled' : 'outlined'}
              clickable={hasMapStats}
              disabled={!hasMapStats}
              onClick={() => hasMapStats && setSelectedMap(index)}
            />
          );
        })}
      </Stack>

      {selectedMap !== null && !hasSelectedStats ? (
        <Typography color="text.secondary" variant="body2">
          {t('matchStats.unavailable')}
        </Typography>
      ) : (
        <Stack spacing={2}>
          <ScoreboardTable
            title={team1Name}
            players={displayTeam1}
            accent="primary"
            highlightPlayerId={highlightPlayerId}
            showAdvancedStats={showAdvancedStats}
          />
          <ScoreboardTable
            title={team2Name}
            players={displayTeam2}
            accent="error"
            highlightPlayerId={highlightPlayerId}
            showAdvancedStats={showAdvancedStats}
          />
        </Stack>
      )}
    </Box>
  );
}

function ScoreboardTable({
  title,
  players,
  accent,
  highlightPlayerId,
  showAdvancedStats,
}: {
  title: string;
  players: StatsPlayer[];
  accent: 'primary' | 'error';
  highlightPlayerId?: string;
  showAdvancedStats: boolean;
}) {
  return (
    <Box>
      <Typography variant="subtitle2" color={`${accent}.main`} fontWeight={700} mb={0.5}>
        {title}
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: showAdvancedStats ? 980 : 820 }}>
          <TableHead>
            <TableRow>
              {(showAdvancedStats
                ? ['Player', 'K', 'D', 'A', 'KDR', 'KDA', 'EF', '+/-', 'ADR', 'KAST', 'HS', 'HS%', 'DMG', 'UD', 'MVP', 'Score']
                : ['Player', 'K', 'D', 'A', '+/-', 'ADR', 'KAST', 'HS', 'DMG', 'UD', 'MVP', 'Score']
              ).map((label) => (
                <TableCell key={label} align={label === 'Player' ? 'left' : 'right'}>{label}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>{renderRows(players, accent, highlightPlayerId, showAdvancedStats)}</TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
