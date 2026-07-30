/**
 * CS2 Map data with images
 */

import type { CS2MapData } from '../types/veto.types';
import { CURATED_MAPS } from '../../../api/src/shared/mapCatalog';

// Map images - using sivert-io/cs2-server-manager
// Full-size webp images are used for large hero/background displays.
// Thumbnails (with `_thumb` suffix) are used for smaller cards/lists.
const MAP_IMAGE_BASE =
  'https://raw.githubusercontent.com/sivert-io/cs2-server-manager/master/map_thumbnails';


const getUpstreamFullImageUrl = (mapName: string): string =>
  `${MAP_IMAGE_BASE}/${mapName}.webp`;

const getUpstreamThumbnailUrl = (mapName: string): string =>
  `${MAP_IMAGE_BASE}/${mapName}_thumb.webp`;

export const CS2_MAPS: CS2MapData[] = [
  {
    name: 'de_ancient',
    displayName: 'Ancient',
    image: getUpstreamFullImageUrl('de_ancient'),
    thumbnail: getUpstreamThumbnailUrl('de_ancient'),
  },
  {
    name: 'de_anubis',
    displayName: 'Anubis',
    image: getUpstreamFullImageUrl('de_anubis'),
    thumbnail: getUpstreamThumbnailUrl('de_anubis'),
  },
  {
    name: 'de_dust2',
    displayName: 'Dust II',
    image: getUpstreamFullImageUrl('de_dust2'),
    thumbnail: getUpstreamThumbnailUrl('de_dust2'),
  },
  {
    name: 'de_inferno',
    displayName: 'Inferno',
    image: getUpstreamFullImageUrl('de_inferno'),
    thumbnail: getUpstreamThumbnailUrl('de_inferno'),
  },
  {
    name: 'de_mirage',
    displayName: 'Mirage',
    image: getUpstreamFullImageUrl('de_mirage'),
    thumbnail: getUpstreamThumbnailUrl('de_mirage'),
  },
  {
    name: 'de_nuke',
    displayName: 'Nuke',
    image: getUpstreamFullImageUrl('de_nuke'),
    thumbnail: getUpstreamThumbnailUrl('de_nuke'),
  },
  {
    name: 'de_vertigo',
    displayName: 'Vertigo',
    image: getUpstreamFullImageUrl('de_vertigo'),
    thumbnail: getUpstreamThumbnailUrl('de_vertigo'),
  },
  ...CURATED_MAPS.map((map) => ({
    name: map.id,
    displayName: map.displayName,
    image: map.imageUrl,
    // Curated maps ship one full-size image; reuse it for compact cards.
    thumbnail: map.imageUrl,
  })),
];

export const getMapData = (mapName: string): CS2MapData | undefined => {
  return CS2_MAPS.find((m) => m.name === mapName);
};

export const getMapDisplayName = (mapName: string): string => {
  const mapData = getMapData(mapName);
  if (mapData) return mapData.displayName;

  return mapName
    .replace(/^(?:de|cs|ar|aim|fy|dz)_/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export const getMapFullImageUrl = (mapName: string): string =>
  getMapData(mapName)?.image || getUpstreamFullImageUrl(mapName);

export const getMapThumbnailUrl = (mapName: string): string => {
  const mapData = getMapData(mapName);
  return mapData?.thumbnail || mapData?.image || getUpstreamThumbnailUrl(mapName);
};

