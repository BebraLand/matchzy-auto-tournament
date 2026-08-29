import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Stack,
  Chip,
  Divider,
  CircularProgress,
  Alert,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../utils/matchUtils';
import { MapAccordion } from './MapAccordion';
import type { Match, TeamMatchHistory } from '../../types';
import { normalizeConfigPlayers } from '../../utils/playerUtils';
import { MatchStatsScoreboard } from '../match/MatchStatsScoreboard';

interface TeamMatchHistoryModalProps {
  matchHistory: TeamMatchHistory | null;
  teamId?: string;
  onClose: () => void;
}

export function TeamMatchHistoryModal({
  matchHistory,
  teamId,
  onClose,
}: TeamMatchHistoryModalProps) {
  const { t } = useTranslation();
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getRoundLabel = (round: number) => {
    if (round === 1) return t('rounds.round1');
    if (round === 2) return t('rounds.round2');
    if (round === 3) return t('rounds.quarterfinals');
    if (round === 4) return t('rounds.semifinals');
    if (round === 5) return t('rounds.finals');
    return t('rounds.roundN', { n: round });
  };

  useEffect(() => {
    if (!matchHistory) {
      setMatch(null);
      return;
    }

    const fetchMatchDetails = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/matches/${matchHistory.slug}`);
        if (!response.ok) {
          throw new Error('Failed to fetch match details');
        }

        const data = await response.json();
        setMatch(data.match);
      } catch (err) {
        console.error('Error fetching match details:', err);
        setError(t('teamMatchHistory.loadError'));
      } finally {
        setLoading(false);
      }
    };

    fetchMatchDetails();
  }, [matchHistory, teamId, t]);

  if (!matchHistory) {
    return null;
  }

  // Determine if the viewing team is team1 (undefined if match not loaded yet)
  const isTeam1 = teamId && match ? match.team1?.id === teamId : undefined;

  // Use matchHistory scores (already in correct perspective: team vs opponent)
  // Or calculate from match map results if available
  let team1Score = matchHistory.teamScore;
  let team2Score = matchHistory.opponentScore;

  // If we have match data and know which team is which, swap scores if needed
  if (match && teamId) {
    const calculatedSeriesScore = match.mapResults
      ? match.mapResults.reduce(
          (acc, result) => {
            if (result.team1Score > result.team2Score) {
              acc.team1 += 1;
            } else if (result.team2Score > result.team1Score) {
              acc.team2 += 1;
            }
            return acc;
          },
          { team1: 0, team2: 0 }
        )
      : null;

    if (calculatedSeriesScore) {
      // Match data has accurate series score
      team1Score = isTeam1 ? calculatedSeriesScore.team1 : calculatedSeriesScore.team2;
      team2Score = isTeam1 ? calculatedSeriesScore.team2 : calculatedSeriesScore.team1;
    }
  }

  const configPlayers = match
    ? [
        ...normalizeConfigPlayers(match.config?.team1?.players),
        ...normalizeConfigPlayers(match.config?.team2?.players),
      ]
    : [];
  const teamPlayers = match ? [...(match.team1?.players ?? []), ...(match.team2?.players ?? [])] : [];
  const playerAvatars = Object.fromEntries([
    ...teamPlayers.map((player) => [player.steamId.toLowerCase(), player.avatar] as const),
    ...configPlayers.map((player) => [player.steamid.toLowerCase(), player.avatar] as const),
  ]);

  return (
    <Dialog open={!!matchHistory} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" fontWeight={600}>
            {t('teamMatchHistory.modalTitle')}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        {loading && (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && match && (
          <Stack spacing={3}>
            {/* Match Header */}
            <Box>
              <Stack direction="row" spacing={2} alignItems="center" mb={2}>
                <Chip
                  icon={<EmojiEventsIcon />}
                  label={matchHistory.won ? t('teamMatchHistory.modalVictory') : t('teamMatchHistory.modalDefeat')}
                  color={matchHistory.won ? 'success' : 'error'}
                  sx={{ fontWeight: 600 }}
                />
                <Chip
                  label={t('teamMatchHistory.modalMatchNumber', { number: matchHistory.matchNumber })}
                  variant="outlined"
                />
                <Chip
                  label={getRoundLabel(matchHistory.round)}
                  variant="outlined"
                />
              </Stack>

              {/* Teams */}
              <Box mb={2}>
                <Typography variant="h6" gutterBottom>
                  {match.team1?.name || t('teamMatchHistory.team1')}
                  {match.team1?.tag && ` (${match.team1.tag})`} {t('teamMatchHistory.vs')}{' '}
                  {match.team2?.name || t('teamMatchHistory.team2')}
                  {match.team2?.tag && ` (${match.team2.tag})`}
                </Typography>
              </Box>

              {/* Series Score */}
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: 'background.default',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  {t('teamMatchHistory.finalSeriesScore')}
                </Typography>
                <Typography variant="h4" fontWeight={700} textAlign="center">
                  {team1Score} - {team2Score}
                </Typography>
              </Box>

              {/* Match Date */}
              <Typography variant="body2" color="text.secondary" mt={2}>
                {t('teamMatchHistory.completed', { date: formatDate(matchHistory.completedAt) })}
              </Typography>
            </Box>

            <Divider />

            {/* Maps Accordion */}
            {match.maps && match.maps.length > 0 && (
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  {t('teamMatchHistory.mapsPlayed')}
                </Typography>
                <Stack spacing={1}>
                  {match.maps.map((mapName, index) => {
                    const mapResult = match.mapResults?.find((mr) => mr.mapNumber === index);
                    const previousMapResult =
                      index > 0 ? match.mapResults?.find((mr) => mr.mapNumber === index - 1) : undefined;

                    const viewingTeamIsTeam1 =
                      teamId && match.team1?.id && match.team1.id === teamId
                        ? true
                        : teamId && match.team2?.id && match.team2.id === teamId
                        ? false
                        : undefined;

                    const viewingTeamName =
                      viewingTeamIsTeam1 === undefined
                        ? undefined
                        : viewingTeamIsTeam1
                        ? match.team1?.name
                        : match.team2?.name;

                    const opponentTeamName =
                      viewingTeamIsTeam1 === undefined
                        ? undefined
                        : viewingTeamIsTeam1
                        ? match.team2?.name
                        : match.team1?.name;

                    return (
                      <MapAccordion
                        key={index}
                        mapNumber={index}
                        mapName={mapName}
                        mapResult={mapResult}
                        matchSlug={match.slug}
                        matchLoadedAt={match.loadedAt}
                        previousMapCompletedAt={previousMapResult?.completedAt}
                        viewingTeamName={viewingTeamName}
                        opponentTeamName={opponentTeamName}
                        viewingTeamIsTeam1={viewingTeamIsTeam1}
                      />
                    );
                  })}
                </Stack>
              </Box>
            )}

            {(!match.maps || match.maps.length === 0) && (
              <Alert severity="info">{t('teamMatchHistory.noMaps')}</Alert>
            )}

            {/* Player stats across the match/series and individual maps */}
            {match.team1 && match.team2 && (match.team1Players?.length || match.mapResults?.length) && (
              <Box>
                <MatchStatsScoreboard
                  key={match.slug}
                  team1Name={match.team1.name}
                  team2Name={match.team2.name}
                  team1Players={match.team1Players ?? []}
                  team2Players={match.team2Players ?? []}
                  maps={match.maps ?? []}
                  mapResults={match.mapResults ?? []}
                  playerAvatars={playerAvatars}
                />
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

