import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import SearchIcon from '@mui/icons-material/Search';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { io } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { EmptyState } from '../components/shared/EmptyState';
import { MatchCard } from '../components/shared/MatchCard';
import { StatusLegend } from '../components/shared/StatusLegend';
import { api } from '../utils/api';
import { getRoundLabel } from '../utils/matchUtils';
import { normalizeConfigPlayers } from '../utils/playerUtils';
import type { Match, MatchesResponse } from '../types';

const hasTeams = (match: Match) => {
  if (match.round === 0) {
    const team1 = (match.config?.team1 as { name?: string } | undefined)?.name;
    const team2 = (match.config?.team2 as { name?: string } | undefined)?.name;
    return Boolean(team1 && team1 !== 'TBD' && team2 && team2 !== 'TBD');
  }
  return Boolean(match.team1 && match.team2);
};

type StatusFilter = 'all' | 'live' | 'upcoming' | 'completed' | 'cancelled';

const getMatchTeamNames = (match: Match) =>
  [
    match.team1?.name,
    match.team2?.name,
    match.config?.team1?.name,
    match.config?.team2?.name,
  ].filter((name): name is string => Boolean(name));

const getMatchPlayerNames = (match: Match) =>
  [
    ...normalizeConfigPlayers(match.config?.team1?.players),
    ...normalizeConfigPlayers(match.config?.team2?.players),
  ].map((player) => player.name);

const getMatchDateKey = (match: Match) => {
  const timestamp = match.completedAt ?? match.createdAt;
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

export default function PublicMatches() {
  const { t } = useTranslation();
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [playerFilter, setPlayerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchMatches = useCallback(async () => {
    try {
      const response = await api.get<MatchesResponse>('/api/matches?public=true');
      setMatches((response.matches || []).filter(hasTeams));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('matchesPage.errors.loadMatches'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    document.title = t('layout.pageTitle.matches');
    void fetchMatches();

    const socket = io();
    const refresh = () => void fetchMatches();
    socket.on('match:update', refresh);
    socket.on('bracket:update', refresh);
    socket.on('veto:update', refresh);
    const interval = window.setInterval(refresh, 15000);

    return () => {
      window.clearInterval(interval);
      socket.disconnect();
    };
  }, [fetchMatches, t]);

  useEffect(() => {
    setSelectedMatch((current) =>
      current ? matches.find((match) => match.slug === current.slug) ?? null : null
    );
  }, [matches]);

  const teamOptions = useMemo(
    () => Array.from(new Set(matches.flatMap(getMatchTeamNames))).sort((a, b) => a.localeCompare(b)),
    [matches]
  );
  const playerOptions = useMemo(
    () => Array.from(new Set(matches.flatMap(getMatchPlayerNames))).sort((a, b) => a.localeCompare(b)),
    [matches]
  );

  const filteredMatches = useMemo(() => {
    const query = search.trim().toLowerCase();

    return matches.filter((match) => {
      const teamNames = getMatchTeamNames(match);
      const playerNames = getMatchPlayerNames(match);
      const searchText = [
        match.slug,
        match.currentMap,
        match.serverName,
        ...teamNames,
        ...playerNames,
        ...(match.config?.maplist ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (query && !searchText.includes(query)) return false;
      if (teamFilter !== 'all' && !teamNames.includes(teamFilter)) return false;
      if (playerFilter !== 'all' && !playerNames.includes(playerFilter)) return false;

      if (statusFilter === 'live' && match.status !== 'live' && match.status !== 'loaded') {
        return false;
      }
      if (statusFilter === 'upcoming' && match.status !== 'pending' && match.status !== 'ready') {
        return false;
      }
      if (statusFilter === 'completed' && match.status !== 'completed') return false;
      if (statusFilter === 'cancelled' && match.status !== 'cancelled') return false;

      const dateKey = getMatchDateKey(match);
      if (fromDate && (!dateKey || dateKey < fromDate)) return false;
      if (toDate && (!dateKey || dateKey > toDate)) return false;

      return true;
    });
  }, [fromDate, matches, playerFilter, search, statusFilter, teamFilter, toDate]);

  const resetFilters = () => {
    setSearch('');
    setTeamFilter('all');
    setPlayerFilter('all');
    setStatusFilter('all');
    setFromDate('');
    setToDate('');
  };

  const hasFilters = Boolean(
    search || teamFilter !== 'all' || playerFilter !== 'all' || statusFilter !== 'all' || fromDate || toDate
  );

  const liveMatches = useMemo(
    () => filteredMatches.filter((match) => match.status === 'live' || match.status === 'loaded'),
    [filteredMatches]
  );
  const upcomingMatches = useMemo(
    () => filteredMatches.filter((match) => match.status === 'pending' || match.status === 'ready'),
    [filteredMatches]
  );
  const historyMatches = useMemo(
    () =>
      filteredMatches
        .filter((match) => match.status === 'completed' || match.status === 'cancelled')
        .sort((a, b) => (b.completedAt ?? b.createdAt ?? 0) - (a.completedAt ?? a.createdAt ?? 0)),
    [filteredMatches]
  );

  const allVisibleMatches = [...liveMatches, ...upcomingMatches, ...historyMatches];
  const matchNumber = (match: Match) => allVisibleMatches.findIndex((item) => item.id === match.id) + 1;

  if (loading) {
    return (
      <Box minHeight="100vh" bgcolor="background.default">
        <TopNavBar />
        <Box display="flex" justifyContent="center" py={8}><CircularProgress /></Box>
      </Box>
    );
  }

  return (
    <Box minHeight="100vh" bgcolor="background.default">
      <TopNavBar />
      <Container maxWidth="lg" sx={{ py: 5 }}>
        <Box mb={4}>
          <Typography variant="h4" fontWeight={700}>{t('layout.pageTitle.matches')}</Typography>
          <Typography color="text.secondary" mt={1}>
            {t('matchesPage.subtitle')}
          </Typography>
        </Box>

        <Card variant="outlined" sx={{ mb: 4 }}>
          <CardContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('matchesPage.filters.helper')}
            </Typography>
            <Grid container spacing={2} alignItems="center">
              <Grid size={{ xs: 12, md: 5 }}>
                <TextField
                  fullWidth
                  label={t('matchesPage.filters.searchLabel')}
                  placeholder={t('matchesPage.filters.searchPlaceholder')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3.5 }}>
                <FormControl fullWidth>
                  <InputLabel>{t('matchesPage.filters.teamLabel')}</InputLabel>
                  <Select
                    label={t('matchesPage.filters.teamLabel')}
                    value={teamFilter}
                    onChange={(event) => setTeamFilter(event.target.value)}
                  >
                    <MenuItem value="all">{t('matchesPage.filters.allTeams')}</MenuItem>
                    {teamOptions.map((team) => <MenuItem key={team} value={team}>{team}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3.5 }}>
                <FormControl fullWidth>
                  <InputLabel>{t('matchesPage.filters.playerLabel')}</InputLabel>
                  <Select
                    label={t('matchesPage.filters.playerLabel')}
                    value={playerFilter}
                    onChange={(event) => setPlayerFilter(event.target.value)}
                  >
                    <MenuItem value="all">{t('matchesPage.filters.allPlayers')}</MenuItem>
                    {playerOptions.map((player) => <MenuItem key={player} value={player}>{player}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <FormControl fullWidth>
                  <InputLabel>{t('matchesPage.filters.statusLabel')}</InputLabel>
                  <Select
                    label={t('matchesPage.filters.statusLabel')}
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  >
                    <MenuItem value="all">{t('matchesPage.filters.allStatuses')}</MenuItem>
                    <MenuItem value="live">{t('matchesPage.filters.live')}</MenuItem>
                    <MenuItem value="upcoming">{t('matchesPage.filters.upcoming')}</MenuItem>
                    <MenuItem value="completed">{t('matchesPage.filters.completed')}</MenuItem>
                    <MenuItem value="cancelled">{t('matchesPage.filters.cancelled')}</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2.5 }}>
                <TextField
                  fullWidth
                  type="date"
                  label={t('matchesPage.filters.fromDate')}
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2.5 }}>
                <TextField
                  fullWidth
                  type="date"
                  label={t('matchesPage.filters.toDate')}
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Box display="flex" justifyContent={{ xs: 'flex-start', md: 'flex-end' }} alignItems="center" gap={2}>
                  <Typography variant="body2" color="text.secondary">
                    {t('matchesPage.filters.results', { visible: filteredMatches.length, total: matches.length })}
                  </Typography>
                  {hasFilters && (
                    <Button variant="outlined" startIcon={<RestartAltIcon />} onClick={resetFilters}>
                      {t('matchesPage.filters.reset')}
                    </Button>
                  )}
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        {allVisibleMatches.length === 0 ? (
          <EmptyState
            icon={SportsEsportsIcon}
            title={matches.length > 0 ? t('matchesPage.filters.noResultsTitle') : t('matchesPage.empty.title')}
            description={matches.length > 0 ? t('matchesPage.filters.noResultsDescription') : t('matchesPage.empty.description')}
          />
        ) : (
          <Stack spacing={4}>
            {liveMatches.length > 0 && (
              <MatchSection
                title={t('matchesPage.sections.live', { count: liveMatches.length })}
                matches={liveMatches}
                matchNumber={matchNumber}
                onSelect={setSelectedMatch}
                live
              />
            )}
            {upcomingMatches.length > 0 && (
              <MatchSection
                title={t('matchesPage.sections.upcoming', { count: upcomingMatches.length })}
                matches={upcomingMatches}
                matchNumber={matchNumber}
                onSelect={setSelectedMatch}
              />
            )}
            {historyMatches.length > 0 && (
              <MatchSection
                title={t('matchesPage.sections.recentResults', { count: historyMatches.length })}
                matches={historyMatches}
                matchNumber={matchNumber}
                onSelect={setSelectedMatch}
                completed
              />
            )}
            <StatusLegend />
          </Stack>
        )}
      </Container>

      <MatchDetailsModal
        match={selectedMatch}
        matchNumber={selectedMatch ? matchNumber(selectedMatch) : 0}
        roundLabel={selectedMatch ? getRoundLabel(selectedMatch.round) : ''}
        readOnly
        onClose={() => setSelectedMatch(null)}
      />
    </Box>
  );
}

function MatchSection({
  title,
  matches,
  matchNumber,
  onSelect,
  live = false,
  completed = false,
}: {
  title: string;
  matches: Match[];
  matchNumber: (match: Match) => number;
  onSelect: (match: Match) => void;
  live?: boolean;
  completed?: boolean;
}) {
  return (
    <Box>
      <Typography variant="h6" fontWeight={600} mb={2}>{title}</Typography>
      <Grid container spacing={2}>
        {matches.map((match) => (
          <Grid size={{ xs: 12, sm: 6 }} key={match.id}>
            <MatchCard
              match={match}
              matchNumber={matchNumber(match)}
              variant={live ? 'live' : completed ? 'completed' : 'default'}
              vetoCompleted={match.vetoCompleted}
              showServerInfo={match.status === 'live' || match.status === 'loaded'}
              onClick={() => onSelect(match)}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
