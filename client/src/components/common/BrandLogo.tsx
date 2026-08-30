import React from 'react';
import { Box, Typography } from '@mui/material';
import { useBranding } from '../../contexts/BrandingContext';

export function BrandLogo({ compact = false, size }: { compact?: boolean; size?: number }) {
  const { branding } = useBranding();
  const logoSize = size ?? (compact ? 32 : 36);
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 1 : 1.5,
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      <Box
        component="img"
        src={branding.logoUrl}
        alt={`${branding.displayName} logo`}
        sx={{ width: logoSize, height: logoSize, objectFit: 'contain' }}
        onError={(event: React.SyntheticEvent<HTMLImageElement>) => {
          event.currentTarget.src = '/icon.svg';
        }}
      />
      {!compact && (
        <Typography variant="body2" noWrap fontWeight={700} color="text.primary">
          {branding.displayName}
        </Typography>
      )}
    </Box>
  );
}
