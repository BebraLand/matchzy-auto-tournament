import fs from 'fs';
import path from 'path';
import {
  ensureBroadcastAssetsDirectory,
  getBroadcastAssetDirectory,
  type BroadcastAssetKind,
} from '../config/storage';

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const EXTENSIONS = ['png', 'jpg', 'webp'] as const;
type ImageExtension = (typeof EXTENSIONS)[number];

function detectImageExtension(buffer: Buffer): ImageExtension | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export function saveBroadcastAsset(params: {
  kind: BroadcastAssetKind;
  entityId: string;
  imageData: string;
}): string {
  const { kind, entityId, imageData } = params;
  if (!/^[A-Za-z0-9_-]+$/.test(entityId)) {
    throw new Error('Invalid asset owner ID');
  }

  const match = imageData.match(/^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new Error('Expected a PNG, JPEG, or WebP base64 data URL');
  }

  const buffer = Buffer.from(match[1].replace(/\s/g, ''), 'base64');
  if (buffer.length === 0 || buffer.length > MAX_ASSET_BYTES) {
    throw new Error('Image must be between 1 byte and 8 MB');
  }

  const extension = detectImageExtension(buffer);
  if (!extension) {
    throw new Error('Uploaded data is not a valid PNG, JPEG, or WebP image');
  }

  ensureBroadcastAssetsDirectory();
  const directory = getBroadcastAssetDirectory(kind);
  const filename = `${entityId}.${extension}`;
  const destination = path.join(directory, filename);
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, buffer, { mode: 0o644 });
  fs.renameSync(temporary, destination);

  for (const staleExtension of EXTENSIONS) {
    if (staleExtension === extension) continue;
    const stale = path.join(directory, `${entityId}.${staleExtension}`);
    if (fs.existsSync(stale)) fs.unlinkSync(stale);
  }

  return `/broadcast-assets/${kind}/${filename}?v=${Date.now()}`;
}

export function deleteBroadcastAsset(params: {
  kind: BroadcastAssetKind;
  entityId: string;
}): void {
  const { kind, entityId } = params;
  if (!/^[A-Za-z0-9_-]+$/.test(entityId)) {
    throw new Error('Invalid asset owner ID');
  }

  const directory = getBroadcastAssetDirectory(kind);
  for (const extension of EXTENSIONS) {
    fs.rmSync(path.join(directory, `${entityId}.${extension}`), { force: true });
  }
}
