import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Button,
  Box,
  Grid,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Description as DescriptionIcon,
  EmojiEvents as EmojiEventsIcon,
  SmartToy as SmartToyIcon,
} from '@mui/icons-material';
import { api } from '../../utils/api';
import type { TournamentTemplate } from '../../types/tournament.types';
import { useTranslation } from 'react-i18next';

interface TournamentWelcomeScreenProps {
  onCreateNew: () => void;
  onLoadTemplate: (template: TournamentTemplate) => void;
  onCreateSimulation: (teamCount: number, playersPerTeam: number) => Promise<void>;
}

export function TournamentWelcomeScreen({
  onCreateNew,
  onLoadTemplate,
  onCreateSimulation,
}: TournamentWelcomeScreenProps) {
  const [templates, setTemplates] = useState<TournamentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulationTeamCount, setSimulationTeamCount] = useState(4);
  const [simulationPlayersPerTeam, setSimulationPlayersPerTeam] = useState(5);
  const [creatingSimulation, setCreatingSimulation] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const response = await api.get<{ success: boolean; templates: TournamentTemplate[] }>(
        '/api/templates'
      );
      if (response.success) {
        setTemplates(response.templates);
      }
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadTemplate = () => {
    if (selectedTemplateId) {
      const template = templates.find((t) => t.id === selectedTemplateId);
      if (template) {
        onLoadTemplate(template);
      }
    }
  };

  const handleCreateSimulation = async () => {
    setCreatingSimulation(true);
    try {
      await onCreateSimulation(simulationTeamCount, simulationPlayersPerTeam);
      setSimulationOpen(false);
    } catch {
      // The parent displays the API error.
    } finally {
      setCreatingSimulation(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Box textAlign="center" mb={4}>
          <EmojiEventsIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
          <Typography variant="h4" fontWeight={600} gutterBottom>
            {t('tournament.welcome.heading')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('tournament.welcome.chooseMethod')}
          </Typography>
        </Box>

        <Grid container spacing={3} justifyContent="center">
          <Grid item xs={12} sm={templates.length > 0 && !loading ? 6 : 12}>
            <Card
              variant="outlined"
              data-testid="tournament-welcome-create-new"
              sx={{
                height: '100%',
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: 'primary.main',
                  boxShadow: 2,
                },
              }}
              onClick={onCreateNew}
            >
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <AddIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  {t('tournament.welcome.createNewTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('tournament.welcome.createNewDescription')}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6}>
            <Card
              variant="outlined"
              data-testid="tournament-welcome-simulation"
              sx={{
                height: '100%',
                cursor: 'pointer',
                transition: 'all 0.2s',
                borderColor: 'secondary.main',
                '&:hover': {
                  borderColor: 'secondary.dark',
                  boxShadow: 2,
                },
              }}
              onClick={() => setSimulationOpen(true)}
            >
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <SmartToyIcon sx={{ fontSize: 48, color: 'secondary.main', mb: 2 }} />
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  Simulate Tournament
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Generate bot teams and test the full veto, server and match flow.
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          {!loading && templates.length > 0 && (
            <Grid item xs={12} sm={6}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Box textAlign="center" mb={3}>
                    <DescriptionIcon sx={{ fontSize: 48, color: 'secondary.main', mb: 2 }} />
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      Load from Template
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={3}>
                      Use a saved template to quickly create a tournament
                    </Typography>
                  </Box>

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Select Template</InputLabel>
                    <Select
                      value={selectedTemplateId}
                      label="Select Template"
                      onChange={(e) => setSelectedTemplateId(e.target.value as number | '')}
                    >
                      {templates.map((template) => (
                        <MenuItem key={template.id} value={template.id}>
                          {template.name}
                          {template.description && ` - ${template.description}`}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={handleLoadTemplate}
                    disabled={!selectedTemplateId}
                  >
                    Load Template
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          )}

          {loading && (
            <Grid item xs={12} sm={6}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Box textAlign="center" mb={3}>
                    <DescriptionIcon sx={{ fontSize: 48, color: 'secondary.main', mb: 2 }} />
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      Load from Template
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={3}>
                      Use a saved template to quickly create a tournament
                    </Typography>
                  </Box>
                  <Box display="flex" justifyContent="center" py={2}>
                    <CircularProgress size={24} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          )}
        </Grid>
      </CardContent>

      <Dialog open={simulationOpen} onClose={() => !creatingSimulation && setSimulationOpen(false)}>
        <DialogTitle>Simulation setup</DialogTitle>
        <DialogContent sx={{ display: 'flex', gap: 2, pt: '8px !important' }}>
          <FormControl sx={{ minWidth: 150 }}>
            <InputLabel id="simulation-team-count-label">Bot teams</InputLabel>
            <Select
              labelId="simulation-team-count-label"
              value={simulationTeamCount}
              label="Bot teams"
              onChange={(event) => setSimulationTeamCount(Number(event.target.value))}
              disabled={creatingSimulation}
            >
              {Array.from({ length: 15 }, (_, index) => index + 2).map((count) => (
                <MenuItem key={count} value={count}>
                  {count} teams
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: 150 }}>
            <InputLabel id="simulation-format-label">Format</InputLabel>
            <Select
              labelId="simulation-format-label"
              value={simulationPlayersPerTeam}
              label="Format"
              onChange={(event) => setSimulationPlayersPerTeam(Number(event.target.value))}
              disabled={creatingSimulation}
            >
              {Array.from({ length: 5 }, (_, index) => index + 1).map((size) => (
                <MenuItem key={size} value={size}>
                  {size}v{size}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSimulationOpen(false)} disabled={creatingSimulation}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleCreateSimulation()}
            disabled={creatingSimulation}
            variant="contained"
          >
            {creatingSimulation ? <CircularProgress size={20} color="inherit" /> : 'Create simulation'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

