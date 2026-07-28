import fs from 'fs';
import path from 'path';
import { ensureMapImagesDirectory, getMapImagesDirectory } from './storage';
import { log } from '../utils/logger';
import type { MapData } from '../utils/fetchCS2Maps';

interface CuratedMap {
  id: string;
  displayName: string;
  bundledImage: string;
  fallbackImageUrl: string;
  workshopId: string;
}

const CURATED_MAPS: CuratedMap[] = [
  {
    id: 'de_cache',
    displayName: 'Cache',
    bundledImage: 'de_cache.webp',
    fallbackImageUrl:
      'https://images.steamusercontent.com/ugc/33318782142641136/49247DD5C622542749998E7073E3B29DF0194849/',
    workshopId: '3437809122',
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

const IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'gif'];

function findExistingPreview(mapId: string): string | null {
  const directory = getMapImagesDirectory();
  for (const extension of IMAGE_EXTENSIONS) {
    if (fs.existsSync(path.join(directory, `${mapId}.${extension}`))) {
      return `/map-images/${mapId}.${extension}`;
    }
  }
  return null;
}

function installBundledPreview(map: CuratedMap): string {
  ensureMapImagesDirectory();

  const existingPreview = findExistingPreview(map.id);
  if (existingPreview) return existingPreview;

  const source = path.join(process.cwd(), 'assets', 'map-images', map.bundledImage);
  const destination = path.join(getMapImagesDirectory(), map.bundledImage);

  try {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    return `/map-images/${map.bundledImage}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return `/map-images/${map.bundledImage}`;
    }

    log.warn(`Failed to install bundled preview for ${map.id}; using remote fallback`, { error });
    return map.fallbackImageUrl;
  }
}

/**
 * Maps maintained by this fork in addition to the upstream thumbnail catalog.
 * Existing uploaded previews are preserved.
 */
export function getCuratedMaps(): MapData[] {
  return CURATED_MAPS.map((map) => ({
    id: map.id,
    displayName: map.displayName,
    imageUrl: installBundledPreview(map),
  }));
}

export function getCuratedWorkshopId(mapId: string): string | null {
  return CURATED_MAPS.find((map) => map.id === mapId)?.workshopId ?? null;
}
