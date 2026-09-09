import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import index from '@/components/online-popup/aouad/asset-index.json';
import goodsManifest from '@/components/online-popup/aouad/generated-asset-manifest.json';
import boxManifest from '@/components/online-popup/aouad/generated-box-asset-manifest.json';

const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/aouad-popup.server', () => ({ canViewAouadPopup: auth }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, realpath: vi.fn(actual.realpath) };
});

import { GET, HEAD } from '@/app/ip-popups/aouad/[...asset]/route';

const sample = 'md-cabinet-penholder-v2.webp';
const samplePath = join(process.cwd(), 'private/ip-popups/aouad', sample);
const context = (name = sample) => ({ params: Promise.resolve({ asset: name.split('/') }) });
const request = (method = 'GET', headers?: HeadersInit) => new Request(`https://iconsip.com/ip-popups/aouad/${sample}`, { method, headers });
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
}

beforeEach(() => {
  auth.mockReset().mockResolvedValue(true);
  vi.mocked(realpath).mockClear();
});

describe('private AOUAD media HTTP contract', () => {
  it.each(['GET', 'HEAD'])('denies %s before any filesystem lookup, including Range requests', async (method) => {
    auth.mockResolvedValue(false);
    const response = await (method === 'HEAD' ? HEAD : GET)(request(method, { Range: 'bytes=0-9' }), context());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(realpath).not.toHaveBeenCalled();
    expectPrivate(response);
  });

  it('fails closed if authorization cannot be checked', async () => {
    auth.mockRejectedValue(new Error('authentication unavailable'));
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
    expect(realpath).not.toHaveBeenCalled();
    expectPrivate(response);
  });

  it.each(['../package.json', '%2e%2e/package.json', 'characters%2fonjo.jpg', 'characters\\onjo.jpg', '/key-armed-group.jpg', 'missing.jpg', 'characters'])('rejects non-manifest path %s', async (path) => {
    const response = await GET(request(), context(path));
    expect(response.status).toBe(404);
    expect(realpath).not.toHaveBeenCalled();
    expectPrivate(response);
  });

  it('rejects a manifest file resolving through a symlink', async () => {
    vi.mocked(realpath).mockResolvedValueOnce('/private-media').mockResolvedValueOnce('/outside/secret');
    const response = await GET(request(), context());
    expect(response.status).toBe(404);
    expectPrivate(response);
  });

  it('streams the unchanged image bytes to an authorized viewer', async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('content-length')).toBe(String(index[sample].bytes));
    expect(hash(new Uint8Array(await response.arrayBuffer()))).toBe(index[sample].sha256);
    expectPrivate(response);
  });

  it.each(['bytes=7-31', 'bytes=154100-', 'bytes=-19', 'bytes=154100-999999'])('serves the exact requested byte range %s', async (range) => {
    const raw = await readFile(samplePath);
    const expected = range === 'bytes=7-31' ? raw.subarray(7, 32)
      : range === 'bytes=-19' ? raw.subarray(-19) : raw.subarray(154100);
    const start = range === 'bytes=7-31' ? 7 : range === 'bytes=-19' ? raw.length - 19 : 154100;
    const response = await GET(request('GET', { Range: range }), context());
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes ${start}-${start + expected.length - 1}/${raw.length}`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected);
    expectPrivate(response);
  });

  it.each(['bytes=999999-', 'bytes=10-9', 'bytes=-0', 'bytes=-', 'bytes=nope', 'bytes=999999999999999999999-'])('rejects unsatisfiable range %s', async (range) => {
    const response = await GET(request('GET', { Range: range }), context());
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe(`bytes */${index[sample].bytes}`);
    expect(await response.text()).toBe('');
    expectPrivate(response);
  });

  it('HEAD ignores Range and returns only full-representation headers', async () => {
    const response = await HEAD(request('HEAD', { Range: 'bytes=0-9' }), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-range')).toBeNull();
    expect(response.headers.get('content-length')).toBe(String(index[sample].bytes));
    expect(await response.text()).toBe('');
    expectPrivate(response);
  });

  it('ignores an unmatched If-Range validator', async () => {
    const response = await GET(request('GET', { Range: 'bytes=0-9', 'If-Range': '"old-version"' }), context());
    expect(response.status).toBe(200);
    expect(hash(new Uint8Array(await response.arrayBuffer()))).toBe(index[sample].sha256);
  });

  it('streams large video and supports media seeking', async () => {
    const name = 'hero-cafeteria.mp4';
    const raw = await readFile(join(process.cwd(), 'private/ip-popups/aouad', name));
    const response = await GET(request('GET', { Range: 'bytes=1000000-1001023' }), context(name));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(raw.subarray(1000000, 1001024));
    expectPrivate(response);
  });

  it('retains every approved byte and the generated-artwork SHA chain outside public', async () => {
    expect(Object.keys(index)).toHaveLength(229);
    for (const [name, expected] of Object.entries(index)) {
      const bytes = await readFile(join(process.cwd(), 'private/ip-popups/aouad', name));
      expect(bytes.length, name).toBe(expected.bytes);
      expect(hash(bytes), name).toBe(expected.sha256);
    }
    for (const asset of [...goodsManifest.assets, ...boxManifest.assets]) {
      expect(asset.finalPath).toMatch(/^private\/ip-popups\/aouad\//);
      expect(hash(await readFile(join(process.cwd(), asset.finalPath)))).toBe(asset.finalSha256);
    }
    await expect(readFile(join(process.cwd(), 'public/ip-popups/aouad', sample))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
