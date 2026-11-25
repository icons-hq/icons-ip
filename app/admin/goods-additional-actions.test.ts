const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), goods: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
/* from('goods').select(...).in('id', ids)는 읽은 상품의 코드·사진을 덧붙이는 조회다. */
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ in: mocks.goods }) }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { readGoodsAdditionalAction, checkGoodsAdditionalCandidateAction, saveGoodsAdditionalAction, searchGoodsAdditionalCandidatesAction } from './goods-additional-actions';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff1' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), role: 'staff' });
});
describe('additional goods staff actions', () => {
  it('requires current staff permission on every read and write', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'user1' }, isStaff: false, role: 'user' });
    expect(await readGoodsAdditionalAction('g1')).toMatchObject({ ok: false });
    expect(await checkGoodsAdditionalCandidateAction('g1', 'g2')).toMatchObject({ ok: false });
    expect(await saveGoodsAdditionalAction('g1', ['g2'], null)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('sends the observed revision and ordered identities without introducing price overrides', async () => {
    mocks.rpc.mockResolvedValue({ data: { revision: 4, changed: true }, error: null });
    expect(await saveGoodsAdditionalAction('g1', ['g3', 'g2'], 3)).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_additional', {
      p_good_id: 'g1', p_target_good_ids: ['g3', 'g2'], p_expected_revision: 3,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith('/shop/[goodId]', 'page');
  });
  it('rejects self references before a request and reports conflicts without successful invalidation', async () => {
    expect(await saveGoodsAdditionalAction('g1', ['g1'], null)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'additional_goods_changed' } });
    expect(await saveGoodsAdditionalAction('g1', [], 1)).toMatchObject({ ok: false, error: expect.stringContaining('변경') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe('연결한 상품 읽기', () => {
  const saved = { revision: 2, items: [{ goodId: 'g2', name: '보호 케이스', available: true }, { goodId: 'g3', name: '스탠드', available: false }] };
  it('연결 정보에 상품 자동코드와 사진을 덧붙여 돌려준다', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    mocks.rpc.mockResolvedValue({ data: saved, error: null });
    mocks.goods.mockResolvedValue({ data: [{ id: 'g3', code: 'HW-0003', image_path: 'goods/g3.png', bg: null }, { id: 'g2', code: 'HW-0002', image_path: null, bg: null }], error: null });
    const result = await readGoodsAdditionalAction('g1');
    expect(mocks.goods).toHaveBeenCalledWith('id', ['g2', 'g3']);
    expect(result).toEqual({ ok: true, configuration: { revision: 2, items: [
      { goodId: 'g2', name: '보호 케이스', available: true, code: 'HW-0002', imageUrl: null },
      { goodId: 'g3', name: '스탠드', available: false, code: 'HW-0003', imageUrl: 'https://example.supabase.co/storage/v1/object/public/public-media/goods/g3.png' },
    ] } });
    vi.unstubAllEnvs();
  });
  it('코드·사진을 읽지 못해도 연결 정보는 그대로 돌려준다', async () => {
    mocks.rpc.mockResolvedValue({ data: saved, error: null });
    mocks.goods.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(await readGoodsAdditionalAction('g1')).toEqual({ ok: true, configuration: saved });
  });
  it('연결한 상품이 없으면 덧붙이는 조회를 하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: { revision: null, items: [] }, error: null });
    expect(await readGoodsAdditionalAction('g1')).toEqual({ ok: true, configuration: { revision: null, items: [] } });
    expect(mocks.goods).not.toHaveBeenCalled();
  });
});

describe('추가 구성으로 연결할 수 있는 상품 확인', () => {
  const found = (...ids: string[]) => ({ data: ids.map((goodId) => ({ goodId, name: goodId, available: true })), error: null });
  it('판매 중인 상품만 돌려주는 후보 검색에 상품 URL로 물어 결과에 있으면 연결할 수 있다', async () => {
    mocks.rpc.mockResolvedValue(found('g2', 'g20'));
    expect(await checkGoodsAdditionalCandidateAction('g1', 'g2')).toEqual({ ok: true, verdict: 'available' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_additional', { p_base_good_id: 'g1', p_query: 'g2' });
  });
  it('결과에 없으면 지금 고객이 살 수 없는 상품이다', async () => {
    mocks.rpc.mockResolvedValue(found('g20'));
    expect(await checkGoodsAdditionalCandidateAction('g1', 'g2')).toEqual({ ok: true, verdict: 'unavailable' });
  });
  it('저장 전인 새 상품은 기준 상품 없이(빈 값) 확인한다', async () => {
    mocks.rpc.mockResolvedValue(found('g2'));
    expect(await checkGoodsAdditionalCandidateAction(null, 'g2')).toEqual({ ok: true, verdict: 'available' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_additional', { p_base_good_id: '', p_query: 'g2' });
  });
  it('후보 검색이 실패하면 연결할 수 없다고 단정하지 않고 다시 고르게 한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(await checkGoodsAdditionalCandidateAction('g1', 'g2')).toMatchObject({ ok: false, error: expect.stringContaining('다시') });
  });
  it('검색어 길이 제한을 넘는 상품 URL은 묻지 않고 저장할 때 가리게 둔다', async () => {
    expect(await checkGoodsAdditionalCandidateAction('g1', 'g'.repeat(101))).toEqual({ ok: true, verdict: 'unknown' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('상품을 알아볼 수 없으면 요청하지 않는다', async () => {
    expect(await checkGoodsAdditionalCandidateAction('g1', '')).toMatchObject({ ok: false });
    expect(await checkGoodsAdditionalCandidateAction(undefined, 'g2')).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('추가구성상품 선택창 조회', () => {
  const filters = { query: '케이스', field: 'name', categoryId: '', page: 1 };
  const row = (id: string) => ({ id, code: id.toUpperCase(), name: `상품 ${id}`, categoryName: '케이스', imagePath: null, publishedAt: '2026-11-01T00:00:00Z', archivedAt: null });

  it('운영자가 아니면 조회하지 않는다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'user1' }, isStaff: false, role: 'user' });
    expect(await searchGoodsAdditionalCandidatesAction('g1', filters)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* 규칙 2: 고를 수 없는 상품은 조회에서 뺀다. 지금 편집 중인 상품과 검색 조건을 함께 보내 DB가 거르고 센다. */
  it('지금 연결할 수 있는 상품만 돌려주는 조회에 기준 상품·검색 조건·페이지를 보낸다', async () => {
    mocks.rpc.mockResolvedValue({ data: { total: 21, rows: [row('g2')] }, error: null });
    const result = await searchGoodsAdditionalCandidatesAction('g1', { ...filters, field: 'code', page: 2 });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_additional_candidates', {
      p_base_good_id: 'g1', p_query: '케이스', p_field: 'code', p_category_id: null, p_limit: 20, p_offset: 20,
    });
    expect(result).toEqual({ ok: true, data: { total: 21, page: 2, pageSize: 20,
      rows: [{ id: 'g2', code: 'G2', name: '상품 g2', categoryName: '케이스', imageUrl: null, published: true }] } });
  });

  it('저장 전인 새 상품은 기준 상품 없이 조회한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });
    expect(await searchGoodsAdditionalCandidatesAction(null, filters)).toMatchObject({ ok: true, data: { total: 0, rows: [] } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_additional_candidates', expect.objectContaining({ p_base_good_id: null, p_offset: 0 }));
  });

  it('마지막 페이지를 넘겨 물으면 마지막 페이지를 다시 읽는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { total: 21, rows: [] }, error: null }).mockResolvedValueOnce({ data: { total: 21, rows: [row('g9')] }, error: null });
    const result = await searchGoodsAdditionalCandidatesAction('g1', { ...filters, page: 5 });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_search_goods_additional_candidates', expect.objectContaining({ p_offset: 20 }));
    expect(result).toMatchObject({ ok: true, data: { page: 2, rows: [{ id: 'g9' }] } });
  });

  it('조건이 맞지 않거나 조회가 실패하면 고칠 수 있는 말로 알리고 내부 오류를 흘리지 않는다', async () => {
    expect(await searchGoodsAdditionalCandidatesAction('g1', { ...filters, field: 'barcode' })).toEqual({ ok: false, error: '상품 검색 조건을 확인해주세요.' });
    expect(await searchGoodsAdditionalCandidatesAction('', filters)).toEqual({ ok: false, error: '상품 검색 조건을 확인해주세요.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } });
    expect(await searchGoodsAdditionalCandidatesAction('g1', filters)).toEqual({ ok: false, error: '연결할 수 있는 상품을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.' });
    mocks.rpc.mockResolvedValue({ data: { total: 1, rows: [{ id: 'g2' }] }, error: null });
    expect(await searchGoodsAdditionalCandidatesAction('g1', filters)).toMatchObject({ ok: false });
  });
});
