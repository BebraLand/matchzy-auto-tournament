import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { hudProjectionService } from '../services/hudProjectionService';
import { hudTokenService } from '../services/hudTokenService';
import {
  disconnectHudIntegrationClients,
  emitHudProjectionInvalidated,
} from '../services/socketService';

const router = Router();

function publicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL || process.env.FRONTEND_BASE_URL;
  return (configured || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

async function requireHudToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authorization = req.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!(await hudTokenService.verifyToken(token))) {
    res.status(401).json({ success: false, error: 'Invalid or missing MAT HUD token' });
    return;
  }
  next();
}

router.get('/status', requireAuth, async (_req: Request, res: Response) => {
  const [token, broadcastMatchSlug] = await Promise.all([
    hudTokenService.getStatus(),
    hudProjectionService.getBroadcastMatchSlug(),
  ]);
  res.json({ success: true, token, broadcastMatchSlug });
});

router.post('/token', requireAuth, async (_req: Request, res: Response) => {
  try {
    const created = await hudTokenService.createToken();
    disconnectHudIntegrationClients();
    res.status(201).json({
      success: true,
      token: created.token,
      createdAt: created.createdAt,
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

router.use('/v1', requireHudToken);

router.get('/v1/current', async (req: Request, res: Response) => {
  try {
    const projection = await hudProjectionService.getCurrentProjection(publicBaseUrl(req));
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
