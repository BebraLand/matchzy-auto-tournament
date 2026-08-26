import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { hudProjectionService } from '../services/hudProjectionService';
import { hudTokenService } from '../services/hudTokenService';
import {
  disconnectHudIntegrationClients,
  emitHudProjectionInvalidated,
} from '../services/socketService';
import type { HudTokenMode } from '../services/hudTokenService';

const router = Router();

function publicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL || process.env.FRONTEND_BASE_URL;
  return (configured || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

async function requireHudToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authorization = req.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const mode = await hudTokenService.resolveToken(token);
  if (!mode) {
    res.status(401).json({ success: false, error: 'Invalid or missing MAT HUD token' });
    return;
  }
  res.locals.hudTokenMode = mode;
  next();
}

router.get('/status', requireAuth, async (_req: Request, res: Response) => {
  const [token, broadcastMatchSlug] = await Promise.all([
    hudTokenService.getStatus(),
    hudProjectionService.getBroadcastMatchSlug(),
  ]);
  res.json({ success: true, token, broadcastMatchSlug });
});

router.post('/token', requireAuth, async (req: Request, res: Response) => {
  try {
    const requestedMode = (req.body as { mode?: HudTokenMode } | undefined)?.mode;
    if (requestedMode && requestedMode !== 'manual' && requestedMode !== 'automatic') {
      res.status(400).json({ success: false, error: 'Token mode must be manual or automatic' });
      return;
    }
    const created = await hudTokenService.createToken(requestedMode || 'manual');
    disconnectHudIntegrationClients();
    res.status(201).json({
      success: true,
      token: created.token,
      createdAt: created.createdAt,
      mode: created.mode,
      warning: 'Copy this token now. MAT stores only its hash and cannot show it again.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

router.put('/broadcast-match', requireAuth, async (req: Request, res: Response) => {
  try {
    const slug = (req.body as { slug?: string | null }).slug?.trim() || null;
    const broadcastMatchSlug = await hudProjectionService.setBroadcastMatch(slug);
    emitHudProjectionInvalidated('broadcast-match-changed');
    res.json({ success: true, broadcastMatchSlug });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(message.includes('not found') ? 404 : 409).json({ success: false, error: message });
  }
});

// Stable, anonymous OBS entrypoint. The redirect is deliberately resolved by
// MAT on every fetch, so a Browser Source can follow the current broadcast
// match without embedding a mutable match slug in its URL.
router.get('/broadcast-veto', async (_req: Request, res: Response) => {
  const slug = await hudProjectionService.getBroadcastMatchSlug();
  if (!slug) {
    res.status(404).json({ success: false, error: 'No match is selected for broadcast' });
    return;
  }
  res.redirect(307, `/api/veto/${encodeURIComponent(slug)}?broadcast=1`);
});

router.use('/v1', requireHudToken);

router.get('/v1/current', async (req: Request, res: Response) => {
  try {
    const rawSteamIds = typeof req.query.steamIds === 'string' ? req.query.steamIds : '';
    const steamIds = rawSteamIds
      .split(',')
      .map((steamId) => steamId.trim())
      .filter(Boolean);
    const tokenMode = (res.locals.hudTokenMode || 'manual') as HudTokenMode;
    res.setHeader('X-MAT-HUD-Token-Mode', tokenMode);
    const projection = await hudProjectionService.getCurrentProjection(publicBaseUrl(req), {
      automatic: tokenMode === 'automatic',
      steamIds,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(projection);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

router.get('/v1/matches/:slug', async (req: Request, res: Response) => {
  try {
    const projection = await hudProjectionService.getProjectionForMatch(
      req.params.slug,
      publicBaseUrl(req)
    );
    if (!projection) {
      res.status(404).json({ success: false, error: `Match '${req.params.slug}' not found` });
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(projection);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

router.get('/v1/tournaments/:id/matches', async (req: Request, res: Response) => {
  const tournamentId = Number(req.params.id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    res.status(400).json({ success: false, error: 'Tournament ID must be a positive integer' });
    return;
  }
  try {
    const matches = await hudProjectionService.getTournamentMatches(tournamentId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      contract: 'bebraland-mat-hud',
      version: 1,
      tournamentId: String(tournamentId),
      matches,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
