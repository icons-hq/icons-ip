#!/usr/bin/env node
import { createServer } from 'vite';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(scriptDirectory, 'admin-visual-fixture');
const repoRoot = resolve(scriptDirectory, '..');
const host = '127.0.0.1';
const port = 4319;
const replayAssetTypes = new Map([
  ['.avif', 'image/avif'], ['.css', 'text/css'], ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'], ['.jpg', 'image/jpeg'], ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'], ['.ttf', 'font/ttf'], ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function inside(parent, target) {
  const part = relative(parent, target);
  return part === '' || (!part.startsWith('..') && !isAbsolute(part));
}

async function loadReplayManifest() {
  const configuredRoot = process.env.ADMIN_QA_SNAPSHOTS_DIR;
  if (!configuredRoot) return null;
  const root = await realpath(resolve(configuredRoot));
  let manifestPath;
  let raw;
  for (const name of ['capture-manifest.json', 'manifest.json']) {
    try {
      manifestPath = join(root, name);
      raw = await readFile(manifestPath, 'utf8');
      break;
    } catch {
      manifestPath = undefined;
    }
  }
  if (!raw || !manifestPath) throw new Error('ADMIN_QA_SNAPSHOTS_DIR requires capture-manifest.json.');
  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest.routes) || !manifest.routes.length) throw new Error('Replay capture manifest requires routes.');
  const routes = new Map();
  for (const route of manifest.routes) {
    if (!route || typeof route.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(route.id) || routes.has(route.id)) {
      throw new Error('Replay capture manifest contains an invalid or duplicate route id.');
    }
    if (typeof route.htmlFile !== 'string' && (!route.htmlFilesByWidth || typeof route.htmlFilesByWidth !== 'object')) {
      throw new Error(`Replay capture route ${route.id} has no HTML file.`);
    }
    routes.set(route.id, route);
  }
  return { root, routes };
}

const replayManifest = await loadReplayManifest();

async function replayHtml(route, width) {
  const relativeFile = route.htmlFilesByWidth?.[String(width)] || route.htmlFile;
  if (typeof relativeFile !== 'string' || !relativeFile) throw new Error('Replay route has no HTML file for this viewport.');
  const file = await realpath(resolve(replayManifest.root, relativeFile));
  if (!inside(replayManifest.root, file) || extname(file).toLowerCase() !== '.html') throw new Error('Replay HTML file must stay inside the snapshot directory.');
  const source = await readFile(file, 'utf8');
  const withoutScripts = source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const modeMeta = '<meta name="admin-visual-replay" content="captured-components"><meta name="admin-visual-replay-mode" content="captured-components"><link rel="icon" href="/favicon.svg">';
  const mountScript = '<script type="module" src="/captured-selects.tsx"></script>';
  const withMeta = /<head\b[^>]*>/i.test(withoutScripts)
    ? withoutScripts.replace(/<head\b[^>]*>/i, (tag) => `${tag}${modeMeta}`)
    : `<head>${modeMeta}</head>${withoutScripts}`;
  return /<\/body\s*>/i.test(withMeta)
    ? withMeta.replace(/<\/body\s*>/i, `${mountScript}</body>`)
    : `${withMeta}${mountScript}`;
}

async function serveReplayAsset(requestPath, response, method = 'GET') {
  if (!replayManifest || !requestPath.startsWith('/assets/')) return false;
  const relativeAsset = decodeURIComponent(requestPath.slice('/assets/'.length));
  const assetRoot = await realpath(join(replayManifest.root, 'assets'));
  const asset = await realpath(resolve(assetRoot, relativeAsset));
  const mime = replayAssetTypes.get(extname(asset).toLowerCase());
  if (!mime || !inside(assetRoot, asset)) { response.statusCode = 404; response.end(); return true; }
  response.statusCode = 200;
  response.setHeader('Content-Type', mime);
  response.setHeader('Cache-Control', 'no-store');
  response.end(method === 'HEAD' ? undefined : await readFile(asset));
  return true;
}

const blockExternalBoundary = () => ({
  name: 'admin-visual-fixture-boundary',
  transform(code, id) {
    if (id === resolve(repoRoot, 'app/globals.css')) {
      return code.replace(/^@import url\(['"]https:\/\/cdn\.jsdelivr\.net[^\n]+\);\s*/m, '');
    }
    return null;
  },
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const requestUrl = new URL(request.url || '/', `http://${host}:${port}`);
      const pathname = requestUrl.pathname;
      if (pathname.startsWith('/api') || pathname.startsWith('/auth')) {
        response.statusCode = 503;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ error: 'fixture_boundary_blocked' }));
        return;
      }
      if (replayManifest && pathname === '/favicon.ico' && ['GET', 'HEAD'].includes(request.method || 'GET')) {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'image/svg+xml');
        response.end(request.method === 'HEAD' ? undefined : await readFile(join(fixtureRoot, 'favicon.svg')));
        return;
      }
      if (pathname.startsWith('/admin/visual-replay/')) {
        if (!replayManifest) { response.statusCode = 404; response.end(); return; }
        if (!['GET', 'HEAD'].includes(request.method || 'GET')) { response.statusCode = 405; response.end(); return; }
        let routeId;
        try {
          routeId = decodeURIComponent(pathname.slice('/admin/visual-replay/'.length));
        } catch {
          response.statusCode = 404; response.end(); return;
        }
        const width = Number(requestUrl.searchParams.get('width') || '390');
        const route = replayManifest.routes.get(routeId);
        if (!routeId || !route || !Number.isInteger(width) || width < 240 || width > 3840) {
          response.statusCode = 404; response.end(); return;
        }
        replayHtml(route, width).then((html) => {
          response.statusCode = 200;
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'self'; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'self'");
          response.end(request.method === 'HEAD' ? undefined : html);
        }).catch(() => { response.statusCode = 404; response.end(); });
        return;
      }
      if (pathname.startsWith('/assets/')) {
        if (!['GET', 'HEAD'].includes(request.method || 'GET')) { response.statusCode = 405; response.end(); return; }
        serveReplayAsset(pathname, response, request.method).then((served) => { if (!served) next(); }).catch(() => { response.statusCode = 404; response.end(); });
        return;
      }
      next();
    });
  },
});

const server = await createServer({
  appType: 'spa',
  envDir: fixtureRoot,
  plugins: [blockExternalBoundary()],
  root: fixtureRoot,
  resolve: {
    alias: [
      { find: 'next/image', replacement: `${fixtureRoot}/next-image.tsx` },
      { find: 'next/link', replacement: `${fixtureRoot}/next-link.tsx` },
      { find: 'next/navigation', replacement: `${fixtureRoot}/next-navigation.ts` },
      { find: /^@\/app\/login\/actions$/, replacement: `${fixtureRoot}/login-actions.ts` },
      { find: /^@\//, replacement: `${repoRoot}/` },
    ],
  },
  server: { host, port, strictPort: true },
});

await server.listen();
console.log(`Admin visual fixture listening at http://${host}:${port}/ (Vite dev server)`);
console.log('Boundary: /api and /auth return 503; no production/Auth/DB calls are permitted.');
if (replayManifest) console.log('Replay: /admin/visual-replay/<route-id>?width=<viewport> uses captured-components only.');

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
