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
  return path.resolve(
    process.env.MAP_IMAGES_DIR || path.join(process.cwd(), 'data', 'map-images')
  );
}

export function ensureMapImagesDirectory(): void {
  fs.mkdirSync(getMapImagesDirectory(), { recursive: true });
}
