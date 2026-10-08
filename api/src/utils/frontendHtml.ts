import express, { Router, type Request, type RequestHandler } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from './logger';

interface FrontendBranding {
  displayName: string;
  logoUrl: string;
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

function getPageUrl(req: Request, frontendBaseUrl: string): URL {
  const url = new URL(frontendBaseUrl || `${req.protocol}://${req.get('host')}`);
  const pathname = req.originalUrl.split('?')[0].replace(/^\/app(?=\/|$)/, '');
  url.pathname = pathname === '/index.html' ? '/' : pathname || '/';
  url.search = '';
  url.hash = '';
  return url;
}

export function renderFrontendHtml(
  template: string,
  branding: FrontendBranding,
  pageUrl: URL
): string {
  const title = escapeHtml(branding.displayName);
  const image = escapeHtml(new URL(branding.logoUrl, pageUrl.origin).href);
  const url = escapeHtml(pageUrl.href);
  const description = escapeHtml(`${branding.displayName} — CS2 tournament matches, players, and results.`);
  const metadata = [
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:site_name" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:alt" content="${title}" />`,
    `<meta property="og:url" content="${url}" />`,
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join('\n    ');

  return template
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${title}</title>`)
    .replace(/<link\b[^>]*\brel=["']icon["'][^>]*>/i, () => `<link rel="icon" href="${image}" />`)
    .replace(/<\/head>/i, () => `    ${metadata}\n  </head>`);
}

export function createFrontendRouter(
  publicPath: string,
  loadBranding: () => Promise<FrontendBranding>,
  frontendBaseUrl = ''
): Router {
  const router = Router();
  const serveHtml: RequestHandler = async (req, res, next) => {
    try {
      const [template, branding] = await Promise.all([
        readFile(path.join(publicPath, 'index.html'), 'utf8'),
        loadBranding().catch((error: unknown) => {
          log.warn('Failed to load frontend branding; using defaults', {
            error: error instanceof Error ? error.message : String(error),
          });
          return { displayName: 'MatchZy Auto Tournament', logoUrl: '/icon.svg' };
        }),
      ]);
      // Branding must be in the initial HTML for link-preview crawlers.
      res.set('Cache-Control', 'no-store');
      res.type('html').send(renderFrontendHtml(template, branding, getPageUrl(req, frontendBaseUrl)));
    } catch (error) {
      next(error);
    }
  };

  router.get(['/', '/index.html'], serveHtml);
  router.use(express.static(publicPath, { index: false }));
  router.get('*', serveHtml);
  return router;
}
