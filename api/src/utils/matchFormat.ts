import type { MatchFormat } from '../types/tournament.types';

/** Resolve a bracket match's series length, including pre-start overrides. */
export function getMatchFormat(
  tournament: { format: MatchFormat; settings?: { matchFormats?: Record<string, MatchFormat> } | null },
  slug?: string
): MatchFormat {
  if (!slug) return tournament.format;
  const override = tournament.settings?.matchFormats?.[slug];
  return override === 'bo1' || override === 'bo3' || override === 'bo5'
    ? override
    : tournament.format;
}
