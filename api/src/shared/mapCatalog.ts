export interface SharedCuratedMap {
  id: string;
  displayName: string;
  imageUrl: string;
}

export const CURATED_MAPS: readonly SharedCuratedMap[] = [
  {
    id: 'de_cache',
    displayName: 'Cache',
    imageUrl:
      'https://raw.githubusercontent.com/auuruum/matchzy-auto-tournament/main/map_thumbnails/de_cache.webp',
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
] as const;
