import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from './access.test-fixtures';
import { EMPTY_GOODS_AFTER_SALES } from '@/lib/goods-after-sales';
import { emptyGoodsSizeChartValues } from '@/lib/goods-size-chart';
const mocks = vi.hoisted(() => ({ client: vi.fn(), auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
import { goodsImportErrorMessage, loadGoodsWorkbookContext } from './goods-import.server';

const record = () => ({ good: { id: 'guidance-test', code: '001' }, variants: [], fingerprint: 'fingerprint',
  afterSales: { goodId: 'guidance-test', goodName: '상품', revision: 0, updatedAt: null, ...EMPTY_GOODS_AFTER_SALES },
  sizeChart: { goodId: 'guidance-test', goodName: '상품', revision: 0, updatedAt: null, values: emptyGoodsSizeChartValues() } });
describe('goods import current guidance snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: true, isAdmin: true, user: { id: 'actor' }, operatorAccess: configuredOperatorAccessFixture('primary') });
    mocks.rpc.mockResolvedValue({ data: [record()], error: null });
    mocks.client.mockResolvedValue({ rpc: mocks.rpc, from: () => {
      const chain = { select: () => chain, order: () => chain, range: () => chain, then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }) };
      return chain;
    } });
  });
  it('reads child snapshots from the bounded record RPC without independent follow-up calls', async () => {
    const context = await loadGoodsWorkbookContext([], ['guidance-test']);
    expect(context.existing[0]).toMatchObject(record());
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_goods_import_records', { target_codes: [], target_ids: ['guidance-test'] });
  });
  it.each(['missing', 'invalid', 'wrongGood'])('fails closed for an incomplete authorized snapshot: %s', async scenario => {
    const source: Record<string, unknown> = record();
    if (scenario === 'missing') delete source.afterSales;
    if (scenario === 'invalid') source.sizeChart = { ...record().sizeChart, revision: 0, updatedAt: '2026-10-14' };
    if (scenario === 'wrongGood') source.afterSales = { ...record().afterSales, goodId: 'another-product' };
    mocks.rpc.mockResolvedValue({ data: [source], error: null });
    await expect(loadGoodsWorkbookContext()).rejects.toThrow('A/S·사이즈 안내');
  });
  it('does not return child documents when catalog management is absent', async () => {
    const access = configuredOperatorAccessFixture('logistics');
    access.capabilities.push('catalog.read'); // Synthetic future read-only projection, not a real role change.
    mocks.auth.mockResolvedValue({ isConfigured: true, isStaff: true, user: { id: 'actor' }, operatorAccess: access });
    expect((await loadGoodsWorkbookContext()).existing[0]).toMatchObject({ good: record().good, afterSales: null, sizeChart: null });
  });
  /* ADR-0044: 대표 카테고리 규칙의 거절은 일반 카테고리 안내가 아니라 그 이유로 알린다. 옛 상품 유형 코드는 더 매핑하지 않는다. */
  it('explains goods category rejections', () => {
    expect(goodsImportErrorMessage('goods_category_required')).toBe('대표 카테고리를 고른 뒤 공개해주세요.');
    expect(goodsImportErrorMessage('goods_published_category_clear')).toContain('공개 중인 상품은 대표 카테고리를 비울 수 없습니다');
    expect(goodsImportErrorMessage('goods_type_category_required')).not.toContain('상품 유형');
    expect(goodsImportErrorMessage('goods_notice_required')).toContain('상품정보제공고시');
  });
  it('explains per-product rollback for stale or invalid guidance', () => {
    for (const error of ['goods_after_sales_changed', 'goods_size_chart_changed', 'invalid_import_guidance', 'goods_size_chart_cannot_clear'])
      expect(goodsImportErrorMessage(error)).toContain('저장하지 않았습니다');
  });
});
