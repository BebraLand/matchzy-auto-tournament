import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Button,
  Box,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
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
  const [simulationDialogOpen, setSimulationDialogOpen] = useState(false);
  const [simulationTeamCount, setSimulationTeamCount] = useState(4);
  const [simulationPlayersPerTeam, setSimulationPlayersPerTeam] = useState(5);
  const [simulationLoading, setSimulationLoading] = useState(false);
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
    setSimulationLoading(true);
    try {
      await onCreateSimulation(simulationTeamCount, simulationPlayersPerTeam);
      setSimulationDialogOpen(false);
    } finally {
      setSimulationLoading(false);
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

          <Grid item xs={12} sm={4}>
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
              onClick={() => setSimulationDialogOpen(true)}
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

        <Dialog
          open={simulationDialogOpen}
          onClose={() => !simulationLoading && setSimulationDialogOpen(false)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Simulation setup</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Create an isolated tournament with generated teams and players. Nothing is added to the real roster.
            </Typography>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Teams</InputLabel>
              <Select
                value={simulationTeamCount}
                label="Teams"
                onChange={(event) => setSimulationTeamCount(Number(event.target.value))}
              >
                {Array.from({ length: 7 }, (_, index) => index + 2).map((count) => (
                  <MenuItem key={count} value={count}>{count} teams</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Players per team</InputLabel>
              <Select
                value={simulationPlayersPerTeam}
                label="Players per team"
                onChange={(event) => setSimulationPlayersPerTeam(Number(event.target.value))}
              >
                {Array.from({ length: 5 }, (_, index) => index + 1).map((count) => (
                  <MenuItem key={count} value={count}>{count} players</MenuItem>
                ))}
              </Select>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSimulationDialogOpen(false)} disabled={simulationLoading}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleCreateSimulation}
              disabled={simulationLoading}
              startIcon={simulationLoading ? <CircularProgress size={16} /> : undefined}
            >
              Create simulation
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}

