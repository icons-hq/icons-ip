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
}));
vi.mock('@/lib/admin/goods-import-images.server', () => ({
  prepareGoodsImportImages: mocks.images,
}));
vi.mock('@/lib/admin/goods-workbook-file', () => ({
  parseGoodsWorkbook: mocks.parse,
}));
vi.mock('@/lib/admin/goods-workbook', async (original) => ({
  ...(await original<object>()),
  planGoodsWorkbookImport: mocks.plan,
}));
import {
  prepareGoodsImport,
  previewGoodsImport,
  commitNextGoodsImport,
} from './goods-import-actions';
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
