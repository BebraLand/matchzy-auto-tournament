import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  CircularProgress,
  IconButton,
  Typography,
  FormControlLabel,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Switch,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../../utils/api';
import { useSnackbar } from '../../contexts/SnackbarContext';
import ConfirmDialog from './ConfirmDialog';
import { PlayerAvatar } from '../player/PlayerAvatar';
import type { PlayerDetail } from '../../types/api.types';
import type { Team, TeamsResponse } from '../../types';
import { useTranslation } from 'react-i18next';

interface PlayerModalProps {
  open: boolean;
  player: PlayerDetail | null;
  onClose: () => void;
  onSave: () => void;
  onDelete: (playerId: string) => void;
}

export default function PlayerModal({ open, player, onClose, onSave, onDelete }: PlayerModalProps) {
  const { t } = useTranslation();
  const { showSuccess, showError, showWarning } = useSnackbar();
  const [steamId, setSteamId] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [pendingPhotoData, setPendingPhotoData] = useState<string | null>(null);
  const [teamId, setTeamId] = useState('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [elo, setElo] = useState<number | ''>('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmEloUpdateOpen, setConfirmEloUpdateOpen] = useState(false);
  const [pendingElo, setPendingElo] = useState<number | ''>('');

  const isEditing = !!player;
  const originalElo = player?.currentElo ?? null;

  useEffect(() => {
    if (player) {
      setSteamId(player.id);
      setName(player.name);
      setAvatar(player.avatar || '');
      setFirstName(player.firstName || '');
      setLastName(player.lastName || '');
      setCountryCode(player.countryCode || '');
      setPhotoUrl(player.photoUrl || '');
      setPendingPhotoData(null);
      setElo(player.currentElo);
      setPendingElo('');
      setIsAdmin(Boolean(player.isAdmin));
      setIsSpectator(Boolean(player.isSpectator));
    } else {
      resetForm();
    }
  }, [player, open]);

  useEffect(() => {
    if (!open) return;
    void api
      .get<TeamsResponse>('/api/teams')
      .then((response) => {
        const availableTeams = response.teams || [];
        setTeams(availableTeams);
        setTeamId(
          player
            ? availableTeams.find((team) =>
                team.players?.some((entry) => entry.steamId === player.id)
              )?.id || ''
            : ''
        );
      })
      .catch(() => setTeams([]));
  }, [open, player]);

  const resetForm = () => {
    setSteamId('');
    setName('');
    setAvatar('');
    setFirstName('');
    setLastName('');
    setCountryCode('');
    setPhotoUrl('');
    setPendingPhotoData(null);
    setTeamId('');
    setElo('');
    setIsAdmin(false);
    setIsSpectator(false);
    setError('');
  };

  const handlePhotoFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showWarning('Player photo must be PNG, JPEG, or WebP');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPendingPhotoData(String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleResolveSteam = async () => {
    if (!steamId.trim()) {
      setError(t('playerModal.errors.steamLookupEmpty'));
      return;
    }

    setResolving(true);
    setError('');

    try {
      const response: {
        success: boolean;
        player?: { steamId: string; name: string; avatar?: string };
      } = await api.post('/api/steam/resolve', {
        input: steamId.trim(),
      });

      if (response.player) {
        setSteamId(response.player.steamId);
        setName(response.player.name);
        if (response.player.avatar) {
          setAvatar(response.player.avatar);
        }
        setError('');
      }
    } catch (err) {
      const error = err as Error;
      // If Steam API not available or resolution failed, allow manual entry
      if (error.message?.includes('Steam API is not configured')) {
        setError(t('playerModal.errors.steamApiNotConfigured'));
      } else {
        setError(t('playerModal.errors.steamResolveFailed'));
      }
    } finally {
      setResolving(false);
    }
  };

  const handleSave = async () => {
    if (!steamId.trim()) {
      showWarning(t('playerModal.errors.steamRequired'));
      return;
    }

    if (!name.trim()) {
      showWarning(t('playerModal.errors.nameRequired'));
      return;
    }

    // Check if ELO is being changed for an existing player
    if (isEditing && originalElo !== null && elo !== '' && Number(elo) !== originalElo) {
      setPendingElo(elo);
      setConfirmEloUpdateOpen(true);
      return;
    }

    await performSave();
  };

  const handleDialogClose = (
    _event: React.SyntheticEvent | Event,
    reason: 'backdropClick' | 'escapeKeyDown'
  ) => {
    // Prevent accidental closes via backdrop or ESC; require explicit Cancel/X.
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
      return;
    }
    onClose();
  };

  const performSave = async () => {
    setSaving(true);
    setError('');

    try {
      const payload = {
        id: steamId.trim(),
        name: name.trim(),
        avatar: avatar.trim() || undefined,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        countryCode: countryCode.trim().toUpperCase() || undefined,
        photoUrl: photoUrl.trim() || null,
        elo: elo !== '' ? Number(elo) : undefined,
        isAdmin,
        isSpectator,
      };

      if (isEditing) {
        await api.put(`/api/players/${player.id}`, payload);
        showSuccess(t('playerModal.success.playerUpdated'));
      } else {
        await api.post('/api/players', payload);
        showSuccess(t('playerModal.success.playerCreated'));
      }

      if (pendingPhotoData) {
        await api.post(`/api/players/${steamId.trim()}/photo`, { imageData: pendingPhotoData });
      }
      await api.put(`/api/players/${steamId.trim()}/team`, { teamId: teamId || null });

      onSave();
      onClose();
      resetForm();
      setConfirmEloUpdateOpen(false);
      setPendingElo('');
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || t('playerModal.errors.saveFailed');
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleEloUpdateConfirm = async () => {
    setConfirmEloUpdateOpen(false);
    await performSave();
  };

  const handleEloUpdateCancel = () => {
    setConfirmEloUpdateOpen(false);
    setPendingElo('');
    // Reset ELO to original value
    if (player) {
      setElo(player.currentElo);
    }
  };

  const handleDeleteClick = () => {
    setConfirmDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!player) return;
    setConfirmDeleteOpen(false);
    onDelete(player.id);
    onClose();
    resetForm();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleDialogClose}
        maxWidth="sm"
        fullWidth
        data-testid="player-modal"
        disableEscapeKeyDown
      >
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">
              {isEditing ? t('playerModal.titleEdit') : t('playerModal.titleCreate')}
            </Typography>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField
              label={t('playerModal.steamLabel')}
              value={steamId}
              onChange={(e) => setSteamId(e.target.value)}
              disabled={isEditing || resolving}
              fullWidth
              required
              error={!!error}
              slotProps={{
                htmlInput: { 'data-testid': 'player-steam-id-input' },
              }}
              helperText={
                error ||
                (isEditing ? t('playerModal.steamHelperEditing') : t('playerModal.steamHelperNew'))
              }
            />

            {!isEditing && (
              <Button
                variant="outlined"
                onClick={handleResolveSteam}
                disabled={resolving || !steamId.trim()}
                startIcon={resolving ? <CircularProgress size={16} /> : undefined}
              >
                {resolving ? t('playerModal.resolving') : t('playerModal.resolveSteam')}
              </Button>
            )}

            {avatar && (
              <Box display="flex" alignItems="center" gap={2}>
                <PlayerAvatar
                  id={steamId || player?.id || 'unknown'}
                  name={name || player?.name || t('playerModal.playerNamePlaceholder')}
                  avatarUrl={avatar}
                  size={48}
                />
              </Box>
            )}

            <TextField
              label={t('playerModal.playerNameLabel')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
              disabled={resolving}
              slotProps={{
                htmlInput: { 'data-testid': 'player-name-input' },
              }}
            />

            <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }} gap={2}>
              <TextField
                label="First name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
              <TextField
                label="Last name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </Box>

            <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '140px 1fr' }} gap={2}>
              <TextField
                label="Country"
                value={countryCode}
                onChange={(event) => setCountryCode(event.target.value.toUpperCase().slice(0, 2))}
                helperText="ISO code, e.g. LT"
              />
              <FormControl fullWidth>
                <InputLabel id="player-team-label">Team</InputLabel>
                <Select
                  labelId="player-team-label"
                  value={teamId}
                  label="Team"
                  onChange={(event) => setTeamId(event.target.value)}
                >
                  <MenuItem value="">No team</MenuItem>
                  {teams.map((team) => (
                    <MenuItem key={team.id} value={team.id}>
                      {team.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <TextField
              label="Player photo URL"
              value={photoUrl}
              onChange={(event) => setPhotoUrl(event.target.value)}
              helperText="Optional broadcast portrait. An uploaded image takes priority."
            />
            <Box display="flex" alignItems="center" gap={2}>
              {(pendingPhotoData || photoUrl) && (
                <Box
                  component="img"
                  src={pendingPhotoData || photoUrl}
                  alt="Player portrait preview"
                  sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1 }}
                />
              )}
              <Button variant="outlined" component="label">
                Upload player photo
                <input
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => handlePhotoFile(event.target.files?.[0])}
                />
              </Button>
              {(pendingPhotoData || photoUrl) && (
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => {
                    setPendingPhotoData(null);
                    setPhotoUrl('');
                  }}
                  data-testid="player-photo-remove-button"
                >
                  {t('playerModal.buttons.deletePhoto')}
                </Button>
              )}
            </Box>

            <TextField
              label={isEditing ? t('playerModal.eloLabelEdit') : t('playerModal.eloLabelNew')}
              type="number"
              value={elo}
              onChange={(e) => setElo(e.target.value === '' ? '' : Number(e.target.value))}
              fullWidth
              slotProps={{
                htmlInput: { 'data-testid': 'player-elo-input' },
              }}
              helperText={
                isEditing ? t('playerModal.eloHelperEdit') : t('playerModal.eloHelperNew')
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                  color="primary"
                />
              }
              label={t('playerModal.isAdminLabel')}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={isSpectator}
                  onChange={(e) => setIsSpectator(e.target.checked)}
                  color="primary"
                />
              }
              label={t('playerModal.isSpectatorLabel')}
            />

            {isEditing && (
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {t('playerModal.currentElo', { value: player.currentElo })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('playerModal.startingElo', { value: player.startingElo })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('playerModal.matchesPlayed', { count: player.matchCount })}
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          {isEditing && (
            <Button
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleDeleteClick}
              disabled={saving}
            >
              {t('playerModal.buttons.delete')}
            </Button>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Button onClick={onClose} disabled={saving}>
            {t('playerModal.buttons.cancel')}
          </Button>
          <Button
            data-testid="player-save-button"
            variant="contained"
            onClick={handleSave}
            disabled={saving || resolving}
            startIcon={saving ? <CircularProgress size={20} color="inherit" /> : undefined}
            sx={{
              ...((!steamId.trim() || !name.trim()) &&
                !saving &&
                !resolving && {
                  bgcolor: 'action.disabledBackground',
                  color: 'action.disabled',
                  '&:hover': {
                    bgcolor: 'action.disabledBackground',
                  },
                }),
            }}
          >
            {saving
              ? t('playerModal.buttons.saving')
              : isEditing
                ? t('playerModal.buttons.save')
                : t('playerModal.buttons.create')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t('playerModal.confirmDelete.title')}
        message={t('playerModal.confirmDelete.message', { name: player?.name })}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      <ConfirmDialog
        open={confirmEloUpdateOpen}
        title={t('playerModal.confirmEloUpdate.title')}
        message={t('playerModal.confirmEloUpdate.message', {
          from: originalElo,
          to: pendingElo,
        })}
        onConfirm={handleEloUpdateConfirm}
        onCancel={handleEloUpdateCancel}
      />
    </>
  );
}
