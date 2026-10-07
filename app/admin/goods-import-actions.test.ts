import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  service: vi.fn(),
  client: vi.fn(),
  batch: vi.fn(),
  context: vi.fn(),
  images: vi.fn(),
  parse: vi.fn(),
  plan: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  sheet: vi.fn(),
  ips: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  unstable_rethrow: (error: Error) => {
    if (error.message.startsWith('NEXT_REDIRECT')) throw error;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.service,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/admin/goods-import.server', () => ({
  loadGoodsImportBatch: mocks.batch,
  loadGoodsWorkbookContext: mocks.context,
  goodsImportView: (batch: unknown) => batch,
  acquireGoodsImportWork: mocks.acquire,
  releaseGoodsImportWork: mocks.release,
  loadGoodsImportIps: mocks.ips,
}));
vi.mock('@/lib/admin/goods-import-images.server', () => ({
  prepareGoodsImportImages: mocks.images,
  prefetchGoodsImportImages: mocks.prefetch,
  goodsImportFilePath: (batch: { actor_id: string; id: string }, name: string) => `${batch.actor_id}/${batch.id}/images/${name}`,
}));
vi.mock('@/lib/admin/goods-workbook-file', () => ({
  parseGoodsWorkbookWithKc: mocks.parse,
  readSabangnetGoodsSheet: mocks.sheet,
}));
vi.mock('@/lib/admin/goods-workbook', async (original) => ({
  ...(await original<object>()),
  planGoodsWorkbookImport: mocks.plan,
}));
import {
  prepareGoodsImport,
  previewGoodsImport,
  commitNextGoodsImport,
  inspectSabangnetGoodsImport,
  previewSabangnetGoodsImport,
} from './goods-import-actions';
import type { GoodsWorkbookContext } from '@/lib/admin/goods-workbook';
import { SABANGNET_KC_WARNING, suggestSabangnetTargets } from '@/lib/admin/sabangnet-goods-format';
describe('goods workbook server boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquire.mockResolvedValue(true);
    mocks.auth.mockResolvedValue({
      isConfigured: true,
      isStaff: true,
      user: { id: 'staff' },
    });
  });
  it('rejects invalid upload metadata before service access', async () => {
    expect(
      await prepareGoodsImport({ name: 'wrong.csv', size: 10 }),
    ).toMatchObject({ ok: false });
    expect(
      await prepareGoodsImport({
        name: 'goods.xlsx',
        size: 2 * 1024 * 1024 + 1,
      }),
    ).toMatchObject({ ok: false });
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('guards upload and preview before any private read', async () => {
    mocks.auth.mockResolvedValue({
      isConfigured: true,
      isStaff: false,
      user: { id: 'user' },
    });
    expect(await previewGoodsImport('batch')).toMatchObject({ ok: false });
    expect(mocks.batch).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({
      isConfigured: true,
      isStaff: false,
      user: null,
    });
    await expect(
      prepareGoodsImport({ name: 'goods.xlsx', size: 10 }),
    ).rejects.toThrow('NEXT_REDIRECT');
  });
  it('uses actor-owned stored plans and does not accept client payloads', async () => {
    const batch = {
      id: 'batch',
      actor_id: 'staff',
      state: 'ready',
      has_images: false,
      plan: [{ kind: 'error', images: [] }],
      results: {},
    };
    mocks.batch.mockResolvedValue(batch);
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: 'failed' }, error: null });
    mocks.client.mockResolvedValue({ rpc });
    expect(await commitNextGoodsImport('batch')).toMatchObject({ ok: true });
    expect(mocks.batch).toHaveBeenCalledWith('batch', 'staff');
    expect(rpc).toHaveBeenCalledWith('admin_commit_goods_import_group', {
      target_batch: 'batch',
      target_index: 0,
    });
    expect(mocks.images).not.toHaveBeenCalled();
  });
  it('returns infrastructure failures without losing the batch identity', async () => {
    mocks.batch.mockRejectedValue(new Error('database unavailable'));
    expect(await commitNextGoodsImport('batch')).toMatchObject({
      ok: false,
      error: expect.any(String),
    });
  });
  it('reopens an immutable preview without rereading or replacing its source file', async () => {
    mocks.batch.mockResolvedValue({
      id: 'batch',
      state: 'ready',
      plan: [],
      results: {},
    });
    expect(await previewGoodsImport('batch')).toMatchObject({ ok: true });
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('waits for the existing image budget before any product mutation', async () => {
    const batch = {
      id: 'batch',
      actor_id: 'staff',
      state: 'ready',
      plan: [
        {
          kind: 'new',
          images: [{ kind: 'url', source: 'https://example.test/image.png' }],
        },
      ],
      results: {},
    };
    mocks.batch.mockResolvedValue(batch);
    mocks.service.mockReturnValue({});
    mocks.images.mockResolvedValue({ ready: false, retryAfter: 12000 });
    expect(await commitNextGoodsImport('batch')).toMatchObject({
      ok: true,
      retryAfter: 12000,
    });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('waits when another tab owns image preparation instead of failing the product', async () => {
    mocks.batch.mockResolvedValue({
      id: 'batch',
      actor_id: 'staff',
      state: 'ready',
      plan: [
        {
          kind: 'new',
          images: [{ kind: 'url', source: 'https://example.test/a.png' }],
        },
      ],
      results: {},
    });
    mocks.acquire.mockResolvedValue(false);
    expect(await commitNextGoodsImport('batch')).toMatchObject({
      ok: true,
      retryAfter: 2000,
    });
    expect(mocks.images).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('reloads the plan after claiming work so a stale tab cannot prepare completed images', async () => {
    const batch = { id: 'batch', state: 'ready', plan: [{ kind: 'new', images: [{ kind: 'url', source: 'https://example.test/a.png' }] }], results: {} };
    mocks.batch.mockResolvedValueOnce(batch).mockResolvedValue({ ...batch, state: 'complete', results: { 0: { status: 'success' } } });
    expect(await commitNextGoodsImport('batch')).toMatchObject({ ok: true });
    expect(mocks.images).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });
});

describe('사방넷 상품 양식 흐름', () => {
  const headers = ['상품명', '자체상품코드', '판매가', '인증번호', '원가', '대표이미지'];
  const targets = suggestSabangnetTargets(headers).targets;
  const uploading = { id: 'batch', actor_id: 'staff', state: 'uploading', workbook_name: 'sabangnet.xlsx', plan: [], results: {} };
  const context: GoodsWorkbookContext = {
    existing: [{ good: { id: 'old-good', code: 'OLD-1' }, variants: [], fingerprint: 'f' }],
    ips: [{ id: 'maple', archived_at: null }],
    origins: [],
    presets: [],
    mediaUrl: () => null,
  };
  let saved: Record<string, unknown> | undefined;
  beforeEach(async () => {
    vi.clearAllMocks();
    saved = undefined;
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: true, user: { id: 'staff' } });
    const actual = await vi.importActual<typeof import('@/lib/admin/goods-workbook')>('@/lib/admin/goods-workbook');
    mocks.plan.mockImplementation(actual.planGoodsWorkbookImport);
    mocks.client.mockResolvedValue({
      storage: { from: () => ({ download: async () => ({ data: new Blob(['xlsx']), error: null }) }) },
    });
    const chain = { eq: () => chain };
    mocks.service.mockReturnValue({
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'batch' }, error: null }) }) }),
        select: () => ({ lt: () => ({ limit: async () => ({ data: [] }) }) }),
        update: (payload: Record<string, unknown>) => {
          saved = payload;
          const eq = { eq: () => eq, then: (resolve: (value: unknown) => void) => resolve({ error: null }) };
          return eq;
        },
      }),
    });
    mocks.ips.mockResolvedValue([{ id: 'maple', title: '메이플스토리' }]);
    mocks.context.mockResolvedValue(context);
    mocks.prefetch.mockResolvedValue(new Map());
    mocks.sheet.mockResolvedValue({
      headerRow: 3,
      headers,
      rows: [
        { row: 4, cells: ['머그', 'MP-1', '15000', 'CB-1', '7000', 'http://img.example.com/mug.jpg'] },
        { row: 5, cells: ['기존 상품', 'old-1', '9000', '', '', ''] },
      ],
    });
  });

  it('XLS는 올리기 전에 xlsx 저장을 안내하고 CSV는 받으며 이미지 ZIP은 받지 않는다', async () => {
    expect(await prepareGoodsImport({ name: '사방넷.xls', size: 10, format: 'sabangnet' })).toEqual({
      ok: false, error: expect.stringContaining('.xlsx'),
    });
    expect(await prepareGoodsImport({ name: 'goods.zip', size: 10, format: 'sabangnet' })).toMatchObject({ ok: false });
    expect(await prepareGoodsImport({ name: 'a.csv', size: 10, imageName: 'a.zip', imageSize: 10, format: 'sabangnet' }))
      .toEqual({ ok: false, error: expect.stringContaining('ZIP 없이') });
    expect(mocks.service).not.toHaveBeenCalled();
    expect(await prepareGoodsImport({ name: '사방넷.csv', size: 10, format: 'sabangnet' })).toEqual({
      ok: true, id: 'batch', prefix: 'staff/batch',
    });
    expect(await prepareGoodsImport({ name: '사방넷.csv', size: 10 })).toMatchObject({ ok: false });
  });

  it('열 확인은 운영자만, 업로드 중인 본인 작업에서 열 이름·예시·IP 목록을 돌려준다', async () => {
    mocks.batch.mockResolvedValue(uploading);
    const result = await inspectSabangnetGoodsImport('batch');
    expect(result).toMatchObject({ ok: true, inspection: {
      headerRow: 3, rowCount: 2, ips: [{ id: 'maple', title: '메이플스토리' }],
      columns: expect.arrayContaining([{ header: '상품명', sample: '머그', values: ['머그', '기존 상품'] }]),
    } });
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: false, user: { id: 'user' } });
    vi.clearAllMocks();
    expect(await inspectSabangnetGoodsImport('batch')).toMatchObject({ ok: false });
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('미리보기는 연결·IP를 서버에서 다시 검증하고 저장하지 않는다', async () => {
    mocks.batch.mockResolvedValue(uploading);
    expect(await previewSabangnetGoodsImport('batch', { targets: targets.map(() => 'ignore'), ipId: 'maple' }))
      .toEqual({ ok: false, error: '상품명으로 쓸 열을 골라 주세요.' });
    expect(await previewSabangnetGoodsImport('batch', { targets, ipId: 'unknown-ip' }))
      .toEqual({ ok: false, error: '새 상품을 연결할 IP를 골라 주세요.' });
    expect(saved).toBeUndefined();
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });

  it('새 상품은 초안으로, 기존 상품코드는 덮어쓰지 않고 오류로 계획하고 가져오지 않은 열을 알려 준다', async () => {
    mocks.batch.mockResolvedValueOnce(uploading).mockResolvedValue({ ...uploading, state: 'ready' });
    const result = await previewSabangnetGoodsImport('batch', { targets, ipId: 'maple', brandIps: { constructor: 'maple' } });
    expect(result).toMatchObject({ ok: true, ignoredColumns: ['원가'] });
    const plan = saved?.plan as { kind: string; format: string; errors: string[]; warnings: string[]; target: Record<string, unknown> | null; images: unknown[] }[];
    expect(saved?.state).toBe('ready');
    expect(plan.map((group) => [group.kind, group.format])).toEqual([['new', 'sabangnet'], ['error', 'sabangnet']]);
    expect(plan[0].target).toMatchObject({ publish: false, ip_id: 'maple', code: 'MP-1' });
    expect(plan[0].warnings).toContain(SABANGNET_KC_WARNING);
    expect(plan[0].images).toEqual([{ field: 'image_path', kind: 'url', source: 'https://img.example.com/mug.jpg' }]);
    expect(plan[1].errors).toEqual([expect.stringContaining('이미 등록된 상품코드')]);
    expect(mocks.prefetch).toHaveBeenCalledWith(expect.objectContaining({ id: 'batch' }), plan);
  });

  it('미리 받은 이미지를 작업 파일에서 읽어 적용하고 뺀 이미지 수를 알려 준다', async () => {
    const download = vi.fn(async () => ({ data: new Blob(['png']), error: null }));
    const batch = { id: 'batch', actor_id: 'staff', state: 'ready', results: {}, plan: [{
      kind: 'new', format: 'sabangnet', images: [{ kind: 'url', field: 'image_path', source: 'https://img.example.com/a.png', cached: 'remote:a' }],
    }] };
    mocks.batch.mockResolvedValue(batch);
    mocks.acquire.mockResolvedValue(true);
    mocks.service.mockReturnValue({ storage: { from: () => ({ download }) } });
    mocks.images.mockResolvedValue({ ready: true, skipped: 1 });
    mocks.client.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: { status: 'success' }, error: null }) });
    expect(await commitNextGoodsImport('batch')).toMatchObject({ ok: true, skippedImages: { index: 0, count: 1 } });
    expect(download).toHaveBeenCalledWith('staff/batch/images/remote:a');
    expect((mocks.images.mock.calls[0][2] as Map<string, Buffer>).has('remote:a')).toBe(true);
  });
});
