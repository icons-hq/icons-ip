import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  claim: vi.fn(),
  reject: vi.fn(),
  promote: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  claims: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
vi.mock('@/lib/admin/artwork.server', () => ({
  createAdminArtworkUploadClaim: mocks.claim,
  rejectAdminArtworkUpload: mocks.reject,
  verifyAndPromoteAdminArtwork: mocks.promote,
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const claims = { select: () => claims, eq: () => claims, gte: () => claims, order: () => claims,
      limit: mocks.claims };
    return { from: () => claims, rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.upload }) } };
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn() }));
import {
  fetchGoodsImportImage,
  goodsImportFilePath,
  imageMime,
  isPublicImageAddress,
  prefetchGoodsImportImages,
  prepareGoodsImportImages,
} from './goods-import-images.server';
import { goodsImportView, type GoodsImportBatch } from './goods-import.server';
import { ADMIN_ARTWORK_VERIFICATIONS_PER_MINUTE } from './artwork';
import { countDroppedGoodsImportImages, type GoodsImportGroup } from './goods-workbook';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
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
  it('ICONS 양식 URL 이미지는 octet-stream 응답과 공백이 든 주소도 파일 서명으로 받는다', async () => {
    response(200, { 'content-type': 'application/octet-stream' }, PNG);
    await expect(fetchGoodsImportImage('https://example.test/a.png')).resolves.toEqual(PNG);
    response(200, { 'content-type': 'binary/octet-stream' }, PNG);
    await expect(fetchGoodsImportImage('https://bucket.s3.example.test/a')).resolves.toEqual(PNG);
    response(200, { 'content-type': 'image/png' }, PNG);
    await expect(fetchGoodsImportImage('https://example.test/상세 01.png')).resolves.toEqual(PNG);
    expect(String(mocks.request.mock.calls[2][0])).toBe('https://example.test/%EC%83%81%EC%84%B8%2001.png');
    response(200, { 'content-type': 'application/octet-stream' }, Buffer.from('<html></html>'));
    await expect(fetchGoodsImportImage('https://example.test/a.png')).rejects.toThrow('JPEG·PNG·WebP');
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
      fetchGoodsImportImage('ftp://example.test/a.png'),
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
    response(200, { 'content-type': 'image/png' }, PNG);
    await expect(
      fetchGoodsImportImage('https://example.test/a.png'),
    ).resolves.toEqual(PNG);
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
    response(200, { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) });
    await expect(
      fetchGoodsImportImage('https://example.test/a.png'),
    ).rejects.toThrow('5MB');
    response(200, { 'content-type': 'image/png' }, Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]));
    await expect(
      fetchGoodsImportImage('https://example.test/a.png'),
    ).rejects.toThrow('5MB');
    expect(imageMime(Buffer.from('<svg></svg>'))).toBeNull();
    expect(imageMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
      'image/png',
    );
  });
});

const group = (overrides: Partial<GoodsImportGroup> = {}): GoodsImportGroup => ({
  key: 'code:MP-1', rows: [5], source: [], code: 'MP-1', name: '머그', kind: 'new', errors: [], warnings: [],
  fingerprint: null, format: 'sabangnet',
  images: [
    { field: 'image_path', kind: 'url', source: 'https://img.example.com/main.png' },
    { field: 'gallery_0', kind: 'url', source: 'https://private.example.com/sub.png' },
  ],
  target: { image_path: 'import-image:image_path', gallery_paths: ['import-image:gallery_0'], detail_image_path: null },
  ...overrides,
});
const batchWith = (plan: GoodsImportGroup[]): GoodsImportBatch => ({
  id: 'batch', actor_id: 'staff', workbook_name: 'sabangnet.xlsx', state: 'ready', has_images: false,
  plan, results: {}, prepared_images: {}, expires_at: '2999-01-01T00:00:00Z',
});
describe('사방넷 이미지 미리 받기와 초안 이미지 준비', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockImplementation(async (host: string) =>
      host.startsWith('private') ? [{ address: '10.0.0.8', family: 4 }] : [{ address: '8.8.8.8', family: 4 }]);
    mocks.upload.mockResolvedValue({ error: null });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.claim.mockResolvedValue(true);
    mocks.claims.mockResolvedValue({ data: [], error: null });
  });

  it('미리보기에서 URL 이미지를 비공개 작업 파일로 받아 두고 실패한 이미지는 경고와 함께 뺀다', async () => {
    response(200, { 'content-type': 'image/png' }, PNG);
    const planned = group();
    const errorGroup = group({ kind: 'error', images: [{ field: 'image_path', kind: 'url', source: 'https://img.example.com/never.png' }] });
    await prefetchGoodsImportImages({ id: 'batch', actor_id: 'staff' }, [planned, errorGroup]);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const cached = planned.images[0].cached!;
    expect(cached).toMatch(/^remote:[0-9a-f]{64}$/);
    expect(mocks.upload).toHaveBeenCalledWith(goodsImportFilePath({ id: 'batch', actor_id: 'staff' }, cached), PNG,
      { contentType: 'application/octet-stream', upsert: true });
    expect(planned.images).toHaveLength(1);
    expect(planned.target).toMatchObject({ image_path: 'import-image:image_path', gallery_paths: [] });
    expect(planned.warnings).toEqual([expect.stringContaining('추가 이미지 1: 내부 네트워크')]);
    expect(errorGroup.images[0].cached).toBeUndefined();
  });

  it('미리 받은 파일로 검증하고 네트워크를 다시 쓰지 않는다', async () => {
    mocks.promote.mockResolvedValue({ imagePath: 'public-media/catalog/good/main.png' });
    const planned = group({ images: [{ field: 'image_path', kind: 'url', source: 'https://img.example.com/main.png', cached: 'remote:a' }],
      target: { image_path: 'import-image:image_path', gallery_paths: [], detail_image_path: null } });
    await expect(prepareGoodsImportImages(batchWith([planned]), 0, new Map([['remote:a', PNG]]))).resolves.toEqual({ ready: true });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('service_cache_goods_import_images', expect.objectContaining({
      target_images: expect.objectContaining({ image_path: 'public-media/catalog/good/main.png' }),
    }));
  });

  it('사방넷 초안은 검증하지 못한 이미지를 빼고 저장하고 ICONS 양식 상품은 실패로 남긴다', async () => {
    const planned = group({ images: [{ field: 'gallery_0', kind: 'url', source: 'https://private.example.com/sub.png' }],
      target: { image_path: null, gallery_paths: ['import-image:gallery_0'], detail_image_path: null } });
    await expect(prepareGoodsImportImages(batchWith([planned]), 0, new Map())).resolves.toEqual({ ready: true });
    expect(mocks.rpc).toHaveBeenCalledWith('service_cache_goods_import_images', expect.objectContaining({
      target_images: expect.objectContaining({ gallery_paths: [] }),
    }));
    expect(countDroppedGoodsImportImages(planned, mocks.rpc.mock.calls[0][1].target_images)).toBe(1);
    await expect(prepareGoodsImportImages(batchWith([{ ...planned, format: undefined }]), 0, new Map())).rejects.toThrow('내부');
  });

  it('검증 대기로 이어서 처리해도 뺀 이미지 수를 저장된 준비 상태에서 다시 읽어 결과에 남긴다', async () => {
    const planned = group({
      images: [
        { field: 'image_path', kind: 'url', source: 'https://img.example.com/main.png', cached: 'remote:main' },
        { field: 'gallery_0', kind: 'url', source: 'https://img.example.com/sub.png', cached: 'remote:sub' },
      ],
    });
    const batch = batchWith([planned]);
    // service_cache_goods_import_images처럼 준비 상태를 작업 행에 합쳐 저장한다.
    mocks.rpc.mockImplementation(async (_name: string, args: { target_index: number; target_images: Record<string, unknown> }) => {
      batch.prepared_images[args.target_index] = { ...batch.prepared_images[args.target_index], ...args.target_images };
      return { error: null };
    });
    const busy = Array.from({ length: ADMIN_ARTWORK_VERIFICATIONS_PER_MINUTE }, () => ({ processing_started_at: new Date().toISOString() }));
    mocks.claims
      .mockResolvedValueOnce({ data: [], error: null }) // 대표 이미지 차례
      .mockResolvedValueOnce({ data: [], error: null }) // 대표 이미지 검증 실패 뒤 대기 확인
      .mockResolvedValueOnce({ data: busy, error: null }); // 추가 이미지 차례: 분당 상한
    mocks.promote.mockResolvedValueOnce(null).mockResolvedValueOnce({ imagePath: 'public-media/catalog/good/sub.png' });
    const files = new Map([['remote:main', PNG], ['remote:sub', PNG]]);

    await expect(prepareGoodsImportImages(batch, 0, files)).resolves.toMatchObject({ ready: false });
    expect(batch.prepared_images[0]).toMatchObject({ image_path: null, gallery_paths: ['import-image:gallery_0'] });
    await expect(prepareGoodsImportImages(batch, 0, files)).resolves.toEqual({ ready: true });
    expect(batch.prepared_images[0]).toMatchObject({ image_path: null, gallery_paths: ['public-media/catalog/good/sub.png'] });

    // 새로고침으로 다시 연 작업도 저장된 준비 상태로 같은 수를 보여 준다.
    const view = goodsImportView({ ...batch, state: 'complete', results: { 0: { status: 'success', id: 'good' } } });
    expect(view.groups[0].skippedImages).toBe(1);
    expect(goodsImportView({ ...batch, results: {} }).groups[0].skippedImages).toBe(0);
    expect(goodsImportView({ ...batch, plan: [{ ...planned, format: undefined }], results: { 0: { status: 'success' } } })
      .groups[0].skippedImages).toBe(0);
  });
});
