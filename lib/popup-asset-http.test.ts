import { beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '@/components/online-popup/aouad/hyosan/package-manifest.json';
import { GET as mediaGet, HEAD as mediaHead } from '@/app/ip-popups/aouad/[...asset]/route';
import { GET as gameGet, HEAD as gameHead } from '@/app/ip-popups/aouad/hyosan/[...asset]/route';

const access = vi.hoisted(() => ({ enabled: true, auth: vi.fn() }));
vi.mock('@/lib/aouad-popup', () => ({
  get AOUAD_POPUP_ENABLED() { return access.enabled; },
  AOUAD_POPUP_PUBLIC: true,
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: access.auth }));

const routes = [
  { name: 'presentation media', path: 'hero-cafeteria.mp4', get: mediaGet, head: mediaHead },
  { name: 'embedded game', path: 'index.html', get: gameGet, head: gameHead },
];
const context = (path: string) => ({ params: Promise.resolve({ asset: path.split('/') }) });
const request = (method: string, headers?: HeadersInit) => new Request('https://iconsip.com/ip-popups/aouad/test', { method, headers });

beforeEach(() => {
  access.enabled = true;
  access.auth.mockReset().mockResolvedValue({ isStaff: false });
});

describe('public popup conditional HTTP requests', () => {
  it.each(routes)('$name returns a bodyless 304 for an unchanged anonymous request', async (route) => {
    const head = await route.head(request('HEAD'), context(route.path));
    expect(head.status).toBe(200);
    const etag = head.headers.get('etag');
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    const cached = await route.get(request('GET', { 'If-None-Match': etag! }), context(route.path));
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
    expect(cached.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate, no-transform');
    expect(cached.headers.has('content-length')).toBe(false);
    expect(access.auth).not.toHaveBeenCalled();
  });

  it.each(routes)('$name checks withdrawal before accepting a cached validator', async (route) => {
    const head = await route.head(request('HEAD'), context(route.path));
    access.enabled = false;
    for (const method of ['GET', 'HEAD']) {
      const response = await (method === 'HEAD' ? route.head : route.get)(request(method, {
        'If-None-Match': head.headers.get('etag')!, Range: 'bytes=0-15',
      }), context(route.path));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('');
      expect(response.headers.has('etag')).toBe(false);
      expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    }
  });

  it.each(routes)('$name preserves anonymous HEAD and byte Range responses', async (route) => {
    const head = await route.head(request('HEAD', { Range: 'bytes=0-15' }), context(route.path));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(head.headers.has('content-range')).toBe(false);
    const response = await route.get(request('GET', {
      Range: 'bytes=0-15', 'If-Range': head.headers.get('etag')!,
    }), context(route.path));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 0-15/${head.headers.get('content-length')}`);
    expect((await response.arrayBuffer()).byteLength).toBe(16);
    expect(access.auth).not.toHaveBeenCalled();
  });

  it.each(routes)('$name supports weak/list validators and never validates missing files', async (route) => {
    const head = await route.head(request('HEAD'), context(route.path));
    for (const validator of [`"previous", W/${head.headers.get('etag')}`, '*']) {
      const response = await route.head(request('HEAD', { 'If-None-Match': validator }), context(route.path));
      expect(response.status).toBe(304);
      expect(await response.text()).toBe('');
    }
    const missing = await route.get(request('GET', { 'If-None-Match': '*' }), context('missing.png'));
    expect(missing.status).toBe(404);
    expect(missing.headers.has('etag')).toBe(false);
  });

  it('binds game validators to the negotiated manifest representation', async () => {
    const path = Object.keys(manifest.files).find((name) => name.endsWith('.js'))!;
    const identity = await gameHead(request('HEAD'), context(path));
    const compressed = await gameHead(request('HEAD', { 'Accept-Encoding': 'br', 'If-None-Match': identity.headers.get('etag')! }), context(path));
    expect(compressed.status).toBe(200);
    expect(compressed.headers.get('etag')).not.toBe(identity.headers.get('etag'));
    expect(compressed.headers.get('content-encoding')).toBe('br');
    const cached = await gameGet(request('GET', { 'Accept-Encoding': 'br', 'If-None-Match': compressed.headers.get('etag')! }), context(path));
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
  });

  it('uses the same cache and security header set for both routes', async () => {
    const [media, game] = await Promise.all(routes.map((route) => route.head(request('HEAD'), context(route.path))));
    for (const header of ['Cache-Control', 'Vary', 'X-Content-Type-Options', 'X-Robots-Tag', 'Cross-Origin-Resource-Policy', 'X-Frame-Options', 'Content-Security-Policy']) {
      expect(media.headers.get(header), header).not.toBeNull();
      expect(media.headers.get(header), header).toBe(game.headers.get(header));
    }
  });
});
