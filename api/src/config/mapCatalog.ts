import type { MapData } from '../utils/fetchCS2Maps';

const CURATED_MAPS: MapData[] = [
  {
    id: 'de_cache',
    displayName: 'Cache',
    imageUrl:
      'https://raw.githubusercontent.com/auuruum/matchzy-auto-tournament/fix/maps-production-persistence/map_thumbnails/de_cache.webp',
  },
];

export const CURATED_ACTIVE_DUTY_MAP_IDS = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_cache',
];

/**
 * Maps maintained by this fork in addition to the upstream thumbnail catalog.
 */
export function getCuratedMaps(): MapData[] {
  return CURATED_MAPS;
}

export function isCuratedMap(mapId: string): boolean {
  return CURATED_MAPS.some((map) => map.id === mapId);
}
