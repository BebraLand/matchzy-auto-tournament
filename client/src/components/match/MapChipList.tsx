import { Box, Chip } from '@mui/material';
import type { MatchMapResult } from '../../types';
import { getMapDisplayName } from '../../constants/maps';

interface MapChipListProps {
  maps: string[];
  activeMapIndex: number | null;
  activeMapLabel?: string | null;
  mapResults: MatchMapResult[];
  onMapClick?: (mapNumber: number) => void;
  selectedMapIndex?: number | null;
}

export function MapChipList({
  maps,
  activeMapIndex,
  activeMapLabel,
  mapResults,
  onMapClick,
  selectedMapIndex = null,
}: MapChipListProps) {
  return (
    <Box display="flex" flexWrap="wrap" gap={1} alignItems="center">
      {maps.map((map, idx) => {
        const displayName = getMapDisplayName(map) || map;
        const labelBase = `${idx + 1}. ${displayName}`;
        const result = mapResults.find((mr) => mr.mapNumber === idx);
        const isSelected = selectedMapIndex === idx;
        let chipLabel = labelBase;
        let chipColor: 'default' | 'success' | 'error' | 'secondary' = 'default';

        if (result) {
          chipLabel = `${labelBase} • ${result.team1Score}-${result.team2Score}`;
          chipColor = result.team1Score > result.team2Score ? 'success' : 'error';
        } else if (activeMapIndex === idx && activeMapLabel) {
          chipLabel = `${labelBase} • Live`;
          chipColor = 'secondary';
        }

        return (
          <Chip
            key={`${map}-${idx}`}
            label={chipLabel}
            color={isSelected ? 'primary' : chipColor}
            variant={isSelected || chipColor !== 'default' ? 'filled' : 'outlined'}
            clickable={Boolean(onMapClick && result)}
            onClick={onMapClick && result ? () => onMapClick(idx) : undefined}
            sx={isSelected ? { fontWeight: 700 } : undefined}
          />
        );
      })}
    </Box>
  );
}

