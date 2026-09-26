import { Box, Button, Typography, Alert } from '@mui/material';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { TeamMatchInfo } from '../../types';
import type { CS2MapData } from '../../constants/maps';
import { FadeInImage } from '../common/FadeInImage';

interface MatchServerPanelProps {
  server: TeamMatchInfo['server'];
  preparing?: boolean;
  currentMapData: CS2MapData | null;
  currentMapNumber?: number | null;
  connected: boolean;
  copied: boolean;
  onConnect: () => void;
  onCopy: () => void;
}

export function MatchServerPanel({
  server,
  preparing = false,
  currentMapData,
  currentMapNumber,
  connected,
  copied,
  onConnect,
  onCopy,
}: MatchServerPanelProps) {
  const mapPreview = currentMapData && (
    <FadeInImage
      src={currentMapData.image}
      alt={currentMapData.displayName}
      height={180}
      sx={{ borderRadius: 2 }}
    >
      <Box sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.5))',
      }}>
        <Typography variant="h3" sx={{
          fontWeight: 700,
          color: 'white',
          textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
        }}>
          {currentMapData.displayName}
        </Typography>
        {typeof currentMapNumber === 'number' && (
          <Typography variant="caption" sx={{
            mt: 0.5,
            color: 'rgba(255, 255, 255, 0.8)',
            fontSize: '0.7rem',
            textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
          }}>
            Map {currentMapNumber + 1}
          </Typography>
        )}
      </Box>
    </FadeInImage>
  );

  if (!server) {
    return (
      <Box display="flex" flexDirection="column" gap={2}>
        {mapPreview}
        <Alert severity="info">
          <Typography variant="body2" fontWeight={600} gutterBottom>
            ⏳ {preparing ? 'Preparing CS2 server and map' : 'Waiting for Server Assignment'}
          </Typography>
          <Typography variant="body2">
            {preparing
              ? 'Connect details will appear once CS2 confirms this match and map are ready.'
              : 'A server will be automatically assigned as soon as one becomes available. This page will update automatically when your server is ready.'}
          </Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {mapPreview}

      <Box display="flex" flexDirection="column" gap={2}>
        {/* Server info */}
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Server: {server.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" fontFamily="monospace">
            {server.host}:{server.port}
          </Typography>
          {server.status && (
            <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
              Status: {server.statusDescription?.label || server.status}
            </Typography>
          )}
        </Box>

        <Button
          variant="contained"
          size="large"
          fullWidth
          color={connected ? 'success' : 'primary'}
          startIcon={<SportsEsportsIcon />}
          onClick={onConnect}
          disabled={!server.host || !server.port} // Disable if server details missing
          sx={{ py: 1.5 }}
        >
          {connected ? '✓ Connecting...' : 'Connect to Server'}
        </Button>

        <Button
          variant="outlined"
          size="small"
          fullWidth
          startIcon={copied ? null : <ContentCopyIcon />}
          onClick={onCopy}
          disabled={!server.host || !server.port} // Disable if server details missing
        >
          {copied ? '✓ Copied!' : 'Copy Console Command'}
        </Button>
      </Box>
    </Box>
  );
}

