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
  TextField,
} from '@mui/material';
import {
  Add as AddIcon,
  Description as DescriptionIcon,
  EmojiEvents as EmojiEventsIcon,
  SmartToy as SmartToyIcon,
} from '@mui/icons-material';
import { api } from '../../utils/api';
import type { TournamentTemplate } from '../../types/tournament.types';
import type { MapPool } from '../../types/api.types';
import { useTranslation } from 'react-i18next';

interface TournamentWelcomeScreenProps {
  onCreateNew: () => void;
  onLoadTemplate: (template: TournamentTemplate) => void;
  onCreateSimulation: (
    teamCount: number,
    playersPerTeam: number,
    options: {
      name: string;
      type: string;
      format: string;
      maps: string[];
      maxRounds: number;
      overtimeMode: 'enabled' | 'disabled';
      overtimeSegments: number;
      grandFinalMode: 'none' | 'simple' | 'double';
    }
  ) => Promise<void>;
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
  const [simulationName, setSimulationName] = useState('Simulation Tournament');
  const [simulationType, setSimulationType] = useState('single_elimination');
  const [simulationFormat, setSimulationFormat] = useState('bo3');
  const [simulationMaps, setSimulationMaps] = useState<string[]>(['de_dust2', 'de_cache', 'de_inferno']);
  const [simulationMaxRounds, setSimulationMaxRounds] = useState(24);
  const [simulationOvertimeMode, setSimulationOvertimeMode] = useState<'enabled' | 'disabled'>('enabled');
  const [simulationOvertimeSegments, setSimulationOvertimeSegments] = useState(0);
  const [simulationGrandFinalMode, setSimulationGrandFinalMode] = useState<'none' | 'simple' | 'double'>('simple');
  const [mapPools, setMapPools] = useState<MapPool[]>([]);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    loadTemplates();
    api.get<{ mapPools: MapPool[] }>('/api/map-pools').then((response) => {
      const pools = response.mapPools || [];
      setMapPools(pools);
      const activeDuty = pools.find((pool) => pool.enabled && pool.name.toLowerCase() === 'active duty');
      if (activeDuty) setSimulationMaps(activeDuty.mapIds);
    }).catch((error) => console.error('Error loading map pools:', error));
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
      await onCreateSimulation(simulationTeamCount, simulationPlayersPerTeam, {
        name: simulationName,
        type: simulationType,
        format: simulationType === 'shuffle' ? 'bo1' : simulationFormat,
        maps: simulationMaps,
        maxRounds: simulationMaxRounds,
        overtimeMode: simulationOvertimeMode,
        overtimeSegments: simulationOvertimeSegments,
        grandFinalMode: simulationGrandFinalMode,
      });
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
              Configure the same tournament settings as a normal tournament. Only the teams and players are synthetic.
            </Typography>
            <TextField
              fullWidth
              label="Tournament name"
              value={simulationName}
              onChange={(event) => setSimulationName(event.target.value)}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Tournament type</InputLabel>
              <Select value={simulationType} label="Tournament type" onChange={(event) => setSimulationType(event.target.value)}>
                <MenuItem value="single_elimination">Single Elimination</MenuItem>
                <MenuItem value="double_elimination">Double Elimination</MenuItem>
                <MenuItem value="round_robin">Round Robin</MenuItem>
                <MenuItem value="swiss">Swiss System</MenuItem>
                <MenuItem value="shuffle">Shuffle Tournament</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Match format</InputLabel>
              <Select value={simulationType === 'shuffle' ? 'bo1' : simulationFormat} label="Match format" onChange={(event) => setSimulationFormat(event.target.value)} disabled={simulationType === 'shuffle'}>
                <MenuItem value="bo1">Best of 1</MenuItem>
                <MenuItem value="bo3">Best of 3</MenuItem>
                <MenuItem value="bo5">Best of 5</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Map pool</InputLabel>
              <Select value={mapPools.find((pool) => pool.mapIds.join(',') === simulationMaps.join(','))?.id?.toString() || 'custom'} label="Map pool" onChange={(event) => {
                const value = event.target.value;
                const pool = mapPools.find((item) => item.id.toString() === value);
                if (pool) setSimulationMaps(pool.mapIds);
              }}>
                {mapPools.filter((pool) => pool.enabled).map((pool) => <MenuItem key={pool.id} value={pool.id.toString()}>{pool.name}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              type="number"
              label="Max rounds per map"
              value={simulationMaxRounds}
              onChange={(event) => setSimulationMaxRounds(Number(event.target.value))}
              sx={{ mb: 2 }}
              inputProps={{ min: 1, max: 30 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Overtime</InputLabel>
              <Select value={simulationOvertimeMode} label="Overtime" onChange={(event) => setSimulationOvertimeMode(event.target.value as 'enabled' | 'disabled')}>
                <MenuItem value="enabled">Enabled</MenuItem>
                <MenuItem value="disabled">Disabled</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              type="number"
              label="Overtime segments (0 = default)"
              value={simulationOvertimeSegments}
              onChange={(event) => setSimulationOvertimeSegments(Number(event.target.value))}
              sx={{ mb: 2 }}
              inputProps={{ min: 0 }}
            />
            {simulationType === 'double_elimination' && (
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Grand final</InputLabel>
                <Select value={simulationGrandFinalMode} label="Grand final" onChange={(event) => setSimulationGrandFinalMode(event.target.value as 'none' | 'simple' | 'double')}>
                  <MenuItem value="none">No grand final</MenuItem>
                  <MenuItem value="simple">Simple grand final</MenuItem>
                  <MenuItem value="double">Double grand final</MenuItem>
                </Select>
              </FormControl>
            )}
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

