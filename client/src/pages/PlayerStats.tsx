import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  FormControl,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import { EmptyState } from '../components/shared/EmptyState';
import { PlayerAvatar } from '../components/player/PlayerAvatar';
import { PlayerName } from '../components/player/PlayerName';
import { api } from '../utils/api';

interface PlayerStatRow {
  id: string;
  name: string;
  avatar?: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  kills: number;
  deaths: number;
  assists: number;
  kdRatio: number | null;
  kdaRatio: number | null;
  plusMinus: number;
  adr: number;
  kast: number;
  headshots: number;
  headshotPercent: number;
  flashAssists: number;
  enemiesFlashed: number;
  utilityDamage: number;
  mvps: number;
  score: number;
  totalDamage: number;
  roundsPlayed: number;
}

interface PlayerStatsResponse {
  success: boolean;
  stats: PlayerStatRow[];
  teams: Array<{ id: string; name: string }>;
  error?: string;
}

interface PublicPlayerOption {
  id: string;
  name: string;
  avatar?: string;
}

type SortKey = keyof PlayerStatRow;
type SortDirection = 'asc' | 'desc';

const columns: Array<{ key: SortKey; label: string; format?: (value: number) => string }> = [
  { key: 'matchesPlayed', label: 'matches' },
  { key: 'wins', label: 'wins' },
  { key: 'losses', label: 'losses' },
  { key: 'winRate', label: 'winRate', format: (value) => `${(value * 100).toFixed(1)}%` },
  { key: 'kills', label: 'kills' },
  { key: 'deaths', label: 'deaths' },
  { key: 'assists', label: 'assists' },
  { key: 'kdRatio', label: 'kd', format: (value) => value.toFixed(2) },
  { key: 'kdaRatio', label: 'kda', format: (value) => value.toFixed(2) },
  { key: 'plusMinus', label: 'plusMinus' },
  { key: 'adr', label: 'adr', format: (value) => value.toFixed(1) },
  { key: 'kast', label: 'kast', format: (value) => `${value.toFixed(1)}%` },
  { key: 'headshots', label: 'headshots' },
  { key: 'headshotPercent', label: 'headshotPercent', format: (value) => `${value.toFixed(1)}%` },
  { key: 'totalDamage', label: 'damage' },
  { key: 'utilityDamage', label: 'utilityDamage' },
  { key: 'flashAssists', label: 'flashAssists' },
  { key: 'enemiesFlashed', label: 'enemiesFlashed' },
  { key: 'mvps', label: 'mvps' },
  { key: 'score', label: 'score' },
];

function formatValue(value: number | null, format?: (value: number) => string): string {
  if (value === null) return '—';
  return format ? format(value) : value.toLocaleString();
}

function getSortValue(row: PlayerStatRow, key: SortKey): number | string | null {
  if (key === 'name') return row.name;
  return row[key] as number | null;
}

export default function PlayerStats({ publicPage = false }: { publicPage?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState<PlayerStatRow[]>([]);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [players, setPlayers] = useState<PublicPlayerOption[]>([]);
  const [search, setSearch] = useState('');
  const [teamId, setTeamId] = useState('all');
  const [playerId, setPlayerId] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('kills');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = t('layout.pageTitle.playerStats');
  }, [t]);

  useEffect(() => {
    void api
      .get<{ success: boolean; players: PublicPlayerOption[] }>('/api/players/public-selection')
      .then((response) => setPlayers(response.players || []))
      .catch(() => setPlayers([]));
  }, []);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (fromDate) query.set('from', fromDate);
      if (toDate) query.set('to', toDate);
      if (teamId !== 'all') query.set('teamId', teamId);
      if (playerId !== 'all') query.set('playerId', playerId);

      const suffix = query.toString() ? `?${query.toString()}` : '';
      const response = await api.get<PlayerStatsResponse>(`/api/players/stats${suffix}`);
      setStats(response.stats || []);
      setTeams(response.teams || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('playerStatsPage.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [fromDate, playerId, t, teamId, toDate]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const filteredStats = useMemo(() => {
    const query = search.trim().toLowerCase();
    const visible = stats.filter(
      (row) => !query || row.name.toLowerCase().includes(query) || row.id.toLowerCase().includes(query)
    );

    return visible.sort((a, b) => {
      const left = getSortValue(a, sortKey);
      const right = getSortValue(b, sortKey);
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      const comparison =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right)
          : Number(left) - Number(right);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [search, sortDirection, sortKey, stats]);

  const resetFilters = () => {
    setSearch('');
    setTeamId('all');
    setPlayerId('all');
    setFromDate('');
    setToDate('');
  };

  const hasFilters = Boolean(search || teamId !== 'all' || playerId !== 'all' || fromDate || toDate);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const content = loading ? (
    <Box display="flex" justifyContent="center" py={8}>
      <CircularProgress />
    </Box>
  ) : (
    <>
      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}
      {filteredStats.length === 0 ? (
        <EmptyState
          icon={LeaderboardIcon}
          title={stats.length > 0 ? t('playerStatsPage.empty.filteredTitle') : t('playerStatsPage.empty.title')}
          description={t('playerStatsPage.empty.description')}
        />
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 1900 }} data-testid="player-stats-table">
            <TableHead>
              <TableRow>
                <TableCell sx={{ position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper' }}>
                  <TableSortLabel
                    active={sortKey === 'name'}
                    direction={sortKey === 'name' ? sortDirection : 'asc'}
                    onClick={() => handleSort('name')}
                  >
                    {t('playerStatsPage.columns.player')}
                  </TableSortLabel>
                </TableCell>
                {columns.map((column) => (
                  <TableCell key={column.key} align="right">
                    <TableSortLabel
                      active={sortKey === column.key}
                      direction={sortKey === column.key ? sortDirection : 'asc'}
                      onClick={() => handleSort(column.key)}
                    >
                      {t(`playerStatsPage.columns.${column.label}`)}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredStats.map((row, index) => (
                <TableRow
                  key={row.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/player/${row.id}`)}
                  data-testid={`player-stats-row-${row.id}`}
                >
                  <TableCell
                    sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', minWidth: 210 }}
                  >
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" color="text.secondary" sx={{ width: 24 }}>
                        {index + 1}
                      </Typography>
                      <PlayerAvatar id={row.id} name={row.name} avatarUrl={row.avatar} size={28} />
                      <PlayerName name={row.name} variant="body2" sx={{ fontWeight: 600 }} />
                    </Box>
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.key} align="right">
                      {formatValue(getSortValue(row, column.key) as number | null, column.format)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );

  return (
    <Box minHeight={publicPage ? '100vh' : undefined} bgcolor="background.default" data-testid="player-stats-page">
      {publicPage && <TopNavBar />}
      <Container maxWidth="xl" sx={{ py: 5 }}>
        <Box mb={4}>
          <Typography variant="h4" fontWeight={700}>{t('layout.pageTitle.playerStats')}</Typography>
          <Typography color="text.secondary" mt={1}>{t('playerStatsPage.subtitle')}</Typography>
        </Box>

        <Card variant="outlined" sx={{ mb: 4 }}>
          <CardContent>
            <Grid container spacing={2} alignItems="center">
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  fullWidth
                  label={t('playerStatsPage.filters.searchLabel')}
                  placeholder={t('playerStatsPage.filters.searchPlaceholder')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  slotProps={{
                    input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> },
                  }}
                  inputProps={{ 'data-testid': 'player-stats-search-input' }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <FormControl fullWidth>
                  <InputLabel>{t('playerStatsPage.filters.teamLabel')}</InputLabel>
                  <Select label={t('playerStatsPage.filters.teamLabel')} value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                    <MenuItem value="all">{t('playerStatsPage.filters.allTeams')}</MenuItem>
                    {teams.map((team) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <FormControl fullWidth>
                  <InputLabel>{t('playerStatsPage.filters.playerLabel')}</InputLabel>
                  <Select label={t('playerStatsPage.filters.playerLabel')} value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
                    <MenuItem value="all">{t('playerStatsPage.filters.allPlayers')}</MenuItem>
                    {[...players].sort((a, b) => a.name.localeCompare(b.name)).map((player) => (
                      <MenuItem key={player.id} value={player.id}>{player.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <TextField fullWidth type="date" label={t('playerStatsPage.filters.fromDate')} value={fromDate} onChange={(event) => setFromDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <TextField fullWidth type="date" label={t('playerStatsPage.filters.toDate')} value={toDate} onChange={(event) => setToDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" color="text.secondary">
                    {t('playerStatsPage.filters.results', { visible: filteredStats.length, total: stats.length })}
                  </Typography>
                  {hasFilters && <Button variant="outlined" startIcon={<RestartAltIcon />} onClick={resetFilters}>{t('playerStatsPage.filters.reset')}</Button>}
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {content}
      </Container>
    </Box>
  );
}
