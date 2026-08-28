import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, CircularProgress, Container, Grid, Stack, Typography } from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import { io } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { TopNavBar } from '../components/layout/TopNavBar';
import MatchDetailsModal from '../components/modals/MatchDetailsModal';
import { EmptyState } from '../components/shared/EmptyState';
import { MatchCard } from '../components/shared/MatchCard';
import { StatusLegend } from '../components/shared/StatusLegend';
import { api } from '../utils/api';
import { getRoundLabel } from '../utils/matchUtils';
import type { Match, MatchesResponse } from '../types';

const hasTeams = (match: Match) => {
  if (match.round === 0) {
    const team1 = (match.config?.team1 as { name?: string } | undefined)?.name;
    const team2 = (match.config?.team2 as { name?: string } | undefined)?.name;
    return Boolean(team1 && team1 !== 'TBD' && team2 && team2 !== 'TBD');
  }
  return Boolean(match.team1 && match.team2);
};

export default function PublicMatches() {
  const { t } = useTranslation();
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const liveMatches = useMemo(
    () => matches.filter((match) => match.status === 'live' || match.status === 'loaded'),
    [matches]
  );
  const upcomingMatches = useMemo(
    () => matches.filter((match) => match.status === 'pending' || match.status === 'ready'),
    [matches]
  );
  const historyMatches = useMemo(
    () =>
      matches
        .filter((match) => match.status === 'completed' || match.status === 'cancelled')
        .sort((a, b) => (b.completedAt ?? b.createdAt ?? 0) - (a.completedAt ?? a.createdAt ?? 0)),
    [matches]
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
            Live matches and results from the last 7 days.
          </Typography>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        {allVisibleMatches.length === 0 ? (
          <EmptyState
            icon={SportsEsportsIcon}
            title={t('matchesPage.empty.title')}
            description={t('matchesPage.empty.description')}
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
                title={t('matchesPage.sections.history', { count: historyMatches.length })}
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
