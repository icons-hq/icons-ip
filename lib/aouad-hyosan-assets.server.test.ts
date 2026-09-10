import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '@/components/online-popup/aouad/hyosan/package-manifest.json';

const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/aouad-popup.server', () => ({ canViewAouadPopup: auth }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, realpath: vi.fn(actual.realpath) };
});

import { GET, HEAD } from '@/app/ip-popups/aouad/hyosan/[...asset]/route';

const root = join(process.cwd(), 'private/ip-popups/aouad-hyosan');
const base = 'https://iconsip.com/ip-popups/aouad/hyosan/';
const context = (path: string) => ({ params: Promise.resolve({ asset: path.split('/') }) });
const request = (method: string, path: string, encoding?: string) => new Request(`${base}${path}`, {
  method, headers: encoding === undefined ? undefined : { 'Accept-Encoding': encoding },
});
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const files = manifest.files as Record<string, {
  path: string; contentType: string; bytes: number; sha256: string;
  encodings?: Record<string, { path: string; bytes: number; sha256: string }>;
}>;
const bundle = Object.keys(files).find(path => path.endsWith('.js'))!;
const stylesheet = Object.keys(files).find(path => path.endsWith('.css'))!;
const environment = 'media/school-environment.glb';

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Vary')).toBe('Cookie, Accept-Encoding');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(true);
  vi.mocked(realpath).mockClear();
});

describe('AOUAD embedded Hyosan package HTTP boundary', () => {
  it.each(['GET', 'HEAD'])('withdraws %s for the document, engine and media before reading a file', async method => {
    auth.mockResolvedValue(false);
    for (const path of ['index.html', bundle, environment]) {
      const response = await (method === 'HEAD' ? HEAD : GET)(request(method, path, 'br'), context(path));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('');
      expectPrivate(response);
    }
    expect(realpath).not.toHaveBeenCalled();
  });

  it('fails closed when the shared presentation access check fails', async () => {
    auth.mockRejectedValue(new Error('Access check unavailable'));
    const response = await GET(request('GET', 'index.html'), context('index.html'));
    expect(response.status).toBe(503);
    expect(realpath).not.toHaveBeenCalled();
    expectPrivate(response);
  });

  it.each([
    '../package.json', '%2e%2e/package.json', 'media%2fschool-environment.glb',
    'media\\school-environment.glb', '__encoded/br/school-environment.glb',
    'package-manifest.json', 'hyosan-showcase-manifest.json', 'upstream-source.tar.gz',
    'assets/index.js.map', 'reference/onjo.png', 'constructor', '',
  ])('rejects paths outside the public package manifest: %s', async path => {
    const response = await GET(request('GET', path), context(path));
    expect(response.status).toBe(404);
    expect(realpath).not.toHaveBeenCalled();
    expectPrivate(response);
  });

  it('rejects an allowlisted representation that resolves through a symlink', async () => {
    vi.mocked(realpath).mockResolvedValueOnce('/private-package').mockResolvedValueOnce('/outside/other.html');
    const response = await GET(request('GET', 'index.html'), context('index.html'));
    expect(response.status).toBe(404);
    expectPrivate(response);
  });

  it.each(['index.html', bundle, stylesheet, environment])('returns exact uncompressed bytes and MIME for %s', async path => {
    const response = await GET(request('GET', path), context(path));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(files[path].contentType);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Content-Length')).toBe(String(files[path].bytes));
    expect(hash(new Uint8Array(await response.arrayBuffer()))).toBe(files[path].sha256);
    expectPrivate(response);
  });

  it.each(['br', 'gzip'])('streams %s engine and GLB representations that decode to the canonical bytes', async encoding => {
    for (const path of [bundle, stylesheet, environment]) {
      const response = await GET(request('GET', path, encoding), context(path));
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Encoding')).toBe(encoding);
      const encoded = Buffer.from(await response.arrayBuffer());
      const descriptor = files[path].encodings![encoding];
      expect(encoded.length).toBe(descriptor.bytes);
      expect(hash(encoded)).toBe(descriptor.sha256);
      const decoded = encoding === 'br' ? brotliDecompressSync(encoded) : gunzipSync(encoded);
      expect(hash(decoded)).toBe(files[path].sha256);
      expectPrivate(response);
    }
  });

  it.each([
    ['gzip, br', 'br'], ['gzip;q=1, br;q=0.5', 'gzip'],
    ['br;q=0, gzip;q=0.7', 'gzip'], ['br;q=0, gzip;q=0', null],
    ['identity;q=1, br;q=0.5', null], ['deflate', null],
    ['*;q=0.8', 'br'], ['br;q=invalid, gzip;q=0', null],
  ])('negotiates %s without serving the wrong representation', async (accepted, expectedEncoding) => {
    const response = await HEAD(request('HEAD', bundle, accepted!), context(bundle));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBe(expectedEncoding);
    const expected = expectedEncoding ? files[bundle].encodings![expectedEncoding] : files[bundle];
    expect(response.headers.get('Content-Length')).toBe(String(expected.bytes));
    expect(await response.text()).toBe('');
  });

  it.each(['identity;q=0, br;q=0, gzip;q=0', '*;q=0', 'deflate, identity;q=0'])('returns 406 when every available encoding is refused: %s', async accepted => {
    const response = await GET(request('GET', bundle, accepted), context(bundle));
    expect(response.status).toBe(406);
    expect(await response.text()).toBe('');
    expect(realpath).not.toHaveBeenCalled();
    expectPrivate(response);
  });

  it('serves only popup-scoped URLs and excludes development drivers from the actual bundle', async () => {
    const html = await readFile(join(root, 'index.html'), 'utf8');
    const js = await readFile(join(root, files[bundle].path), 'utf8');
    expect(html).toContain('/ip-popups/aouad/hyosan/assets/');
    expect(js).toContain('/ip-popups/aouad/hyosan/media/');
    for (const text of [html, js]) {
      expect(text).not.toContain('/api/dev/hyosan-3d/');
      expect(text).not.toContain('__HYOSAN_3D_QA__');
      expect(text).not.toContain('NEXT_PUBLIC_HYOSAN_TEST_DRIVER');
    }
  });
});
