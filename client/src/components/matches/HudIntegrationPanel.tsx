import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ContentCopy, Key, LiveTv } from '@mui/icons-material';
import type { Match } from '../../types';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';

type IntegrationStatus = {
  success: boolean;
  token: { configured: boolean; createdAt: string | null; mode: 'manual' | 'automatic' };
  broadcastMatchSlug: string | null;
};

type TokenResponse = {
  success: boolean;
  token: string;
  createdAt: string;
  warning: string;
  mode: 'manual' | 'automatic';
};

export function HudIntegrationPanel({ matches }: { matches: Match[] }) {
  const { showError, showSuccess } = useSnackbar();
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [generatedToken, setGeneratedToken] = useState('');
  const [busy, setBusy] = useState(false);
  const eligibleMatches = useMemo(
    () =>
      matches.filter(
        (match) =>
          (match.team1 || match.config?.team1) &&
          (match.team2 || match.config?.team2) &&
          match.status !== 'completed' &&
          match.operatorState !== 'held' &&
          match.operatorState !== 'postponed' &&
          match.status !== 'cancelled'
      ),
    [matches]
  );

  const refresh = async () => {
    const next = await api.get<IntegrationStatus>('/api/integrations/jts-hud/status');
    setStatus(next);
  };

  useEffect(() => {
    void refresh().catch(() => setStatus(null));
  }, []);

  const selectBroadcast = async (slug: string) => {
    setBusy(true);
    try {
      await api.put('/api/integrations/jts-hud/broadcast-match', { slug: slug || null });
      await refresh();
      showSuccess(slug ? `Broadcast match selected: ${slug}` : 'Broadcast match cleared');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to select broadcast match');
    } finally {
      setBusy(false);
    }
  };

  const generateToken = async (mode: 'manual' | 'automatic') => {
    setBusy(true);
    try {
      const response = await api.post<TokenResponse>('/api/integrations/jts-hud/token', { mode });
      setGeneratedToken(response.token);
      await refresh();
      showSuccess(
        `${mode === 'automatic' ? 'Automatic' : 'Manual'} read-only MAT HUD token generated`
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to generate MAT HUD token');
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(generatedToken);
      showSuccess('HUD token copied');
    } catch {
      showError('Could not copy automatically. Select the token and copy it manually.');
    }
  };

  return (
    <Card sx={{ mb: 3, border: 1, borderColor: 'divider' }} data-testid="hud-integration-panel">
      <CardContent>
        <Stack spacing={2}>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            gap={2}
            flexWrap="wrap"
          >
            <Box>
              <Box display="flex" alignItems="center" gap={1}>
                <LiveTv color="primary" />
                <Typography variant="h6" fontWeight={800}>
                  JTs-Hud Broadcast Integration
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                Select a MAT match for a manual token, or let an automatic token identify it from
                the observer's live players.
              </Typography>
            </Box>
            <Chip
              color={status?.token.configured ? 'success' : 'default'}
              label={
                status?.token.configured
                  ? `${status.token.mode === 'automatic' ? 'Automatic' : 'Manual'} token configured`
                  : 'Token not configured'
              }
            />
          </Box>

          <FormControl fullWidth size="small">
            <InputLabel id="broadcast-match-label">Manual broadcast match</InputLabel>
            <Select
              labelId="broadcast-match-label"
              value={status?.broadcastMatchSlug || ''}
              label="Manual broadcast match"
              disabled={busy}
              onChange={(event) => void selectBroadcast(event.target.value)}
            >
              <MenuItem value="">None / automatic token selection</MenuItem>
              {eligibleMatches.map((match) => (
                <MenuItem key={match.slug} value={match.slug}>
                  {match.team1?.name || 'TBD'} vs {match.team2?.name || 'TBD'} · {match.slug}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box display="flex" gap={1} flexWrap="wrap">
            <Button
              variant="outlined"
              startIcon={<Key />}
              disabled={busy}
              onClick={() => void generateToken('manual')}
            >
              {status?.token.mode === 'manual' && status.token.configured
                ? 'Regenerate manual token'
                : 'Generate manual token'}
            </Button>
            <Button
              variant="outlined"
              startIcon={<LiveTv />}
              disabled={busy}
              onClick={() => void generateToken('automatic')}
            >
              {status?.token.mode === 'automatic' && status.token.configured
                ? 'Regenerate automatic token'
                : 'Generate automatic token'}
            </Button>
          </Box>

          {generatedToken && (
            <Alert severity="warning">
              <Stack spacing={1}>
                <Typography variant="body2" fontWeight={700}>
                  Copy this token now. MAT stores only its hash and cannot show it again.
                </Typography>
                <Box display="flex" gap={1} alignItems="center">
                  <TextField
                    fullWidth
                    size="small"
                    value={generatedToken}
                    slotProps={{ input: { readOnly: true } }}
                  />
                  <Button
                    variant="contained"
                    startIcon={<ContentCopy />}
                    onClick={() => void copyToken()}
                  >
                    Copy
                  </Button>
                </Box>
              </Stack>
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
