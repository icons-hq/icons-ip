import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
vi.mock('@/lib/admin/artwork.server', () => ({
  createAdminArtworkUploadClaim: vi.fn(),
  rejectAdminArtworkUpload: vi.fn(),
  verifyAndPromoteAdminArtwork: vi.fn(),
}));
import {
  fetchGoodsImportImage,
  imageMime,
  isPublicImageAddress,
} from './goods-import-images.server';
function response(
  status: number,
  headers: Record<string, string>,
  bytes = Buffer.from('image'),
) {
  mocks.request.mockImplementationOnce((_url, _options, receive) => {
    const req = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      end: () => void;
      destroy: (error: Error) => void;
    };
    req.setTimeout = vi.fn();
    req.destroy = (error) => req.emit('error', error);
    req.end = () => {
      const stream = Object.assign(Readable.from([bytes]), {
        statusCode: status,
        headers,
      });
      receive(stream);
    };
    return req;
  });
}
describe('import image source boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  });
  it('denies local, metadata, private, mapped-private and multicast addresses', async () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.2',
      '169.254.169.254',
      '::1',
      'fc00::1',
      '::ffff:127.0.0.1',
      '224.0.0.1',
    ])
      expect(isPublicImageAddress(ip)).toBe(false);
    expect(isPublicImageAddress('8.8.8.8')).toBe(true);
    await expect(
      fetchGoodsImportImage('http://example.test/a.png'),
    ).rejects.toThrow('HTTPS');
    mocks.lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(
      fetchGoodsImportImage('https://example.test/a.png'),
    ).rejects.toThrow('내부');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('pins the resolved public socket address and rechecks every redirect', async () => {
    response(200, {});
    await expect(
      fetchGoodsImportImage('https://example.test/a.png'),
    ).resolves.toEqual(Buffer.from('image'));
    const callback = vi.fn();
    mocks.request.mock.calls[0][1].lookup('example.test', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    response(302, { location: 'https://private.test/image.png' });
    mocks.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      fetchGoodsImportImage('https://example.test/a.png'),
    ).rejects.toThrow('내부');
  });
  it('enforces header and streamed size and requires supported image signatures', async () => {
    response(200, { 'content-length': String(6 * 1024 * 1024) });
    await expect(
      fetchGoodsImportImage('https://example.test/a.png'),
    ).rejects.toThrow('5MB');
    response(200, {}, Buffer.alloc(6 * 1024 * 1024));
    await expect(
      fetchGoodsImportImage('https://example.test/a.png'),
    ).rejects.toThrow('5MB');
    expect(imageMime(Buffer.from('<svg></svg>'))).toBeNull();
    expect(imageMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
      'image/png',
    );
  });
});
