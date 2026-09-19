import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { settingsService } from '../services/settingsService';
import { saveBroadcastAsset } from '../services/broadcastAssetService';
import { tournamentService } from '../services/tournamentService';

const router = Router();
const screens = ['standby', 'live', 'completed'] as const;
const kinds = ['text', 'image', 'shape', 'line', 'maps', 'timeline'] as const;
const bindings = ['none', 'brand', 'tournamentName', 'team1', 'team2', 'format', 'status', 'turn', 'step', 'team1Logo', 'team2Logo', 'brandLogo'] as const;
const fallbackModes = ['initials', 'first-letter', 'first-last', 'full-name', 'hidden'] as const;
const mapStateStyles = ['outline', 'tint'] as const;

function validImage(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 500 && (
    /^\/(?:branding-assets|broadcast-assets|map-images)\/[\w./?=&-]+$/.test(value) ||
    /^https:\/\/[\w.-]+(?:\/[\w./?=&%-]*)?$/.test(value)
  );
}

function validColor(value: unknown): boolean {
  return typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value);
}

function numberIn(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validElement(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const el = value as Record<string, unknown>;
  return typeof el.id === 'string' && /^[\w-]{1,80}$/.test(el.id) &&
    kinds.includes(el.kind as typeof kinds[number]) &&
    numberIn(el.x, 0, 1920) && numberIn(el.y, 0, 1080) &&
    numberIn(el.w, 1, 1920) && numberIn(el.h, 1, 1080) &&
    (el.text === undefined || typeof el.text === 'string' && el.text.length <= 300) &&
    (el.imageUrl === undefined || validImage(el.imageUrl)) &&
    (el.binding === undefined || bindings.includes(el.binding as typeof bindings[number])) &&
    (el.color === undefined || validColor(el.color)) &&
    (el.background === undefined || validColor(el.background)) &&
    (el.borderColor === undefined || validColor(el.borderColor)) &&
    (el.fontSize === undefined || numberIn(el.fontSize, 8, 240)) &&
    (el.radius === undefined || numberIn(el.radius, 0, 500)) &&
    (el.opacity === undefined || numberIn(el.opacity, 0, 1)) &&
    (el.columns === undefined || numberIn(el.columns, 1, 10)) &&
    (el.gap === undefined || numberIn(el.gap, 0, 100)) &&
    (el.align === undefined || ['left', 'center', 'right'].includes(String(el.align))) &&
    (el.weight === undefined || [400, 500, 600, 700, 800, 900].includes(el.weight as number)) &&
    (el.fontFamily === undefined || ['Inter', 'Arial', 'Impact', 'Georgia', 'monospace'].includes(String(el.fontFamily))) &&
    (el.mapImages === undefined || typeof el.mapImages === 'object' && el.mapImages !== null && !Array.isArray(el.mapImages) &&
      Object.keys(el.mapImages).length <= 40 && Object.entries(el.mapImages).every(([name, url]) => /^[a-z0-9_-]{1,80}$/.test(name) && validImage(url))) &&
    (el.visible === undefined || typeof el.visible === 'boolean');
}

function validTeamFallback(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fallback = value as Record<string, unknown>;
  return fallbackModes.includes(fallback.mode as typeof fallbackModes[number]) &&
    numberIn(fallback.maxLetters, 1, 4) &&
    validColor(fallback.background) &&
    validColor(fallback.color) &&
    validColor(fallback.borderColor) &&
    numberIn(fallback.radius, 0, 500);
}

export function validDesign(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const design = value as Record<string, unknown>;
  if (design.version !== 1 || !design.screens || typeof design.screens !== 'object' || Array.isArray(design.screens) || !validTeamFallback(design.teamFallback) ||
    (design.mapStateStyle !== undefined && !mapStateStyles.includes(design.mapStateStyle as typeof mapStateStyles[number])) ||
    (design.mapStateTintOpacity !== undefined && !numberIn(design.mapStateTintOpacity, 0, 0.4)) ||
    (design.showActionOwnership !== undefined && typeof design.showActionOwnership !== 'boolean') ||
    (design.showMapSideBadges !== undefined && typeof design.showMapSideBadges !== 'boolean') ||
    (design.showTimelineOwnership !== undefined && typeof design.showTimelineOwnership !== 'boolean')) return false;
  const layouts = design.screens as Record<string, unknown>;
  return screens.every((screen) => {
    const layout = layouts[screen];
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return false;
    const data = layout as Record<string, unknown>;
    return validColor(data.background) &&
      (data.backgroundImage === undefined || validImage(data.backgroundImage)) &&
      (data.backgroundDim === undefined || numberIn(data.backgroundDim, 0, 0.8)) &&
      Array.isArray(data.elements) && data.elements.length <= 100 &&
      data.elements.every(validElement) &&
      new Set(data.elements.map((el: { id: string }) => el.id)).size === data.elements.length;
  });
}

async function read(key: 'broadcast_veto_draft' | 'broadcast_veto_published') {
  const value = await settingsService.getSetting(key);
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

router.get('/published', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const tournament = await tournamentService.getTournament();
  res.json({ success: true, design: await read('broadcast_veto_published'), tournamentName: tournament?.name || '' });
});

router.use(requireAuth);

router.get('/draft', async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const tournament = await tournamentService.getTournament();
  res.json({ success: true, design: await read('broadcast_veto_draft'), published: await read('broadcast_veto_published'), tournamentName: tournament?.name || '' });
});

router.put('/draft', async (req: Request, res: Response) => {
  if (!validDesign(req.body?.design)) return res.status(400).json({ success: false, error: 'Invalid veto design' });
  const serialized = JSON.stringify(req.body.design);
  if (serialized.length > 500_000) return res.status(413).json({ success: false, error: 'Veto design is too large' });
  await settingsService.setSetting('broadcast_veto_draft', serialized);
  return res.json({ success: true });
});

router.post('/publish', async (_req: Request, res: Response) => {
  const draft = await read('broadcast_veto_draft');
  if (!validDesign(draft)) return res.status(400).json({ success: false, error: 'Save a valid draft first' });
  await settingsService.setSetting('broadcast_veto_published', JSON.stringify(draft));
  return res.json({ success: true, design: draft });
});

router.post('/asset', async (req: Request, res: Response) => {
  try {
    const imageData = req.body?.imageData;
    if (typeof imageData !== 'string') return res.status(400).json({ success: false, error: 'Image is required' });
    const url = saveBroadcastAsset({ kind: 'veto', entityId: randomUUID(), imageData });
    return res.json({ success: true, url });
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Invalid image' });
  }
});

export default router;
