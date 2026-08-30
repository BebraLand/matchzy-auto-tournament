import fs from 'fs';
import path from 'path';

/**
 * Persistent storage for map previews.
 *
 * Production mounts /app/data as a durable volume. Local development uses the
 * repository's data directory. MAP_IMAGES_DIR remains available for custom
 * deployments.
 */
export function getMapImagesDirectory(): string {
  return path.resolve(process.env.MAP_IMAGES_DIR || path.join(process.cwd(), 'data', 'map-images'));
}

export function ensureMapImagesDirectory(): void {
  fs.mkdirSync(getMapImagesDirectory(), { recursive: true });
}

export function getBrandingAssetsDirectory(): string {
  return path.resolve(
    process.env.BRANDING_ASSETS_DIR || path.join(process.cwd(), 'data', 'branding-assets')
  );
}

export function ensureBrandingAssetsDirectory(): void {
  fs.mkdirSync(getBrandingAssetsDirectory(), { recursive: true });
}

export type BroadcastAssetKind = 'players' | 'teams';

export function getBroadcastAssetsDirectory(): string {
  return path.resolve(
    process.env.BROADCAST_ASSETS_DIR || path.join(process.cwd(), 'data', 'broadcast-assets')
  );
}

export function getBroadcastAssetDirectory(kind: BroadcastAssetKind): string {
  return path.join(getBroadcastAssetsDirectory(), kind);
}

export function ensureBroadcastAssetsDirectory(): void {
  fs.mkdirSync(getBroadcastAssetDirectory('players'), { recursive: true });
  fs.mkdirSync(getBroadcastAssetDirectory('teams'), { recursive: true });
}
