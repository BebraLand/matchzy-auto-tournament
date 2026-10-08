import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { load } from 'cheerio';
import { createFrontendRouter } from '../api/src/utils/frontendHtml';

async function main() {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'mat-link-preview-'));
  const template = await readFile(path.resolve('client/index.html'), 'utf8');
  await writeFile(path.join(fixtureDir, 'index.html'), template);
  await writeFile(path.join(fixtureDir, 'asset.txt'), 'static asset');
  let branding = { displayName: 'BebraCup 2026', logoUrl: '/branding-assets/beaver.png?v=123&size=64' };
  let reads = 0;
  const app = express();
  app.use('/app', createFrontendRouter(fixtureDir, async () => {
    reads += 1;
    return branding;
  }, 'https://mat.auuruum.dev'));
  app.use('/fallback', createFrontendRouter(fixtureDir, async () => {
    throw new Error('Expected unavailable settings fixture');
  }, 'https://mat.auuruum.dev'));
  app.use('/local', createFrontendRouter(fixtureDir, async () => branding));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  let checks = 0;

  try {
    for (const [route, publicPath] of [
      ['/app', '/'], ['/app/', '/'], ['/app/index.html', '/'],
      ['/app/tournament', '/tournament'], ['/app/players/42', '/players/42'],
      ['/app/bracket?token=private&debug=1', '/bracket'],
    ]) {
      const response = await globalThis.fetch(`${origin}${route}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /text\/html/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const html = load(await response.text());
      assert.equal(html('title').text(), branding.displayName);
      assert.equal(html('meta[property="og:title"]').attr('content'), branding.displayName);
      assert.equal(html('meta[property="og:site_name"]').attr('content'), branding.displayName);
      assert.equal(html('meta[property="og:image"]').attr('content'), `https://mat.auuruum.dev${branding.logoUrl}`);
      assert.equal(html('link[rel="icon"]').attr('href'), `https://mat.auuruum.dev${branding.logoUrl}`);
      assert.equal(html('link[rel="icon"]').attr('type'), undefined);
      assert.equal(html('meta[property="og:url"]').attr('content'), `https://mat.auuruum.dev${publicPath}`);
      assert.equal(html('link[rel="canonical"]').attr('href'), `https://mat.auuruum.dev${publicPath}`);
      assert.equal(html('meta[name="twitter:title"]').attr('content'), branding.displayName);
      assert.equal(html('script[type="module"]').length, 1);
      checks += 1;
    }

    const previousReads = reads;
    const asset = await globalThis.fetch(`${origin}/app/asset.txt`);
    assert.equal(await asset.text(), 'static asset');
    assert.equal(reads, previousReads);
    const cachedAsset = await globalThis.fetch(`${origin}/app/asset.txt`, {
      headers: { 'If-None-Match': asset.headers.get('etag') || '', 'Cache-Control': 'max-age=0' },
    });
    assert.equal(cachedAsset.status, 304);
    checks += 1;

    branding = {
      displayName: 'Бебра "$&" <Cup> & \'2026\'',
      logoUrl: 'https://cdn.example.com/beaver.png?v=456&size=64',
    };
    const updated = load(await (await globalThis.fetch(`${origin}/app/tournament`)).text());
    assert.equal(updated('title').text(), branding.displayName);
    assert.equal(updated('meta[property="og:title"]').attr('content'), branding.displayName);
    assert.equal(updated('meta[property="og:image"]').attr('content'), branding.logoUrl);
    assert.equal(updated('Cup').length, 0);
    checks += 1;

    const head = await globalThis.fetch(`${origin}/app/tournament`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert(Number(head.headers.get('content-length')) > 0);
    checks += 1;

    const fallback = load(await (await globalThis.fetch(`${origin}/fallback/`)).text());
    assert.equal(fallback('title').text(), 'MatchZy Auto Tournament');
    assert.equal(fallback('meta[property="og:image"]').attr('content'), 'https://mat.auuruum.dev/icon.svg');
    checks += 1;

    const local = load(await (await globalThis.fetch(`${origin}/local/tournament`)).text());
    assert.equal(local('meta[property="og:url"]').attr('content'), `${origin}/local/tournament`);
    checks += 1;
    console.log(`Link previews passed: ${checks} HTTP checks without JavaScript`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    assert.equal(path.dirname(path.resolve(fixtureDir)), path.resolve(tmpdir()));
    assert(path.basename(fixtureDir).startsWith('mat-link-preview-'));
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
