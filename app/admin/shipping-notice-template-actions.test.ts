const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyShippingNoticeTemplateToGoodsAction,
  listShippingNoticeTemplateOptionsAction,
  readShippingNoticeTemplateAction,
  saveShippingNoticeTemplateAction,
} from './shipping-notice-template-actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture() },
  rpc: vi.fn(), revalidatePath: vi.fn(), goods: vi.fn(), templates: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({
  rpc: mocks.rpc,
  from: (table: string) => table === 'goods'
    ? { select: () => ({ in: mocks.goods }) }
    : { select() { return this; }, order() { return this; }, range: mocks.templates },
})) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, unstable_rethrow: () => {} }));

const TEMPLATE = '00000000-0000-4000-8000-000000049001';
const OPERATION = '00000000-0000-4000-8000-0000000490aa';
const PERMISSION = '상품 관리 권한이 없습니다. 판매자 정보 > 매니저 관리 담당자에게 권한을 받은 뒤 다시 저장해 주세요.';
const UNKNOWN = '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.';

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    id: '', updatedAt: '', operationId: OPERATION, name: ' 기본 배송 안내 ',
    shippingNotice: '배송 안내', returnExchangeNotice: '교환·반품 안내', remoteAreaNotice: ' 제주·도서산간은 1~2일 더 걸립니다. ', csName: '엑스스퀘어 CS',
    csPhone: '02-000-0000', csEmail: 'help@example.com', ...overrides,
  })) data.set(key, value);
  return data;
}
const saved = (overrides: Record<string, unknown> = {}) => ({ data: { id: TEMPLATE, name: '기본 배송 안내', created: true, appliedGoods: 0, ...overrides }, error: null });
const good = (id: string, overrides: Record<string, unknown> = {}) => ({ id, name: `${id} 상품`, updated_at: '2026-11-26T01:00:00+00:00', archived_at: null, shipping_notice_template_id: null, ...overrides });

beforeEach(() => {
  mocks.auth.isStaff = true;
  mocks.rpc.mockReset().mockResolvedValue(saved());
  mocks.goods.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.templates.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.revalidatePath.mockReset();
});

describe('배송 안내 템플릿 저장', () => {
  it('빠진 칸은 그 칸에서 말하고 저장하지 않는다. 적은 값은 돌려준다', async () => {
    const result = await saveShippingNoticeTemplateAction({}, form({ name: '', csPhone: '', csEmail: '' }));
    expect(result.errors).toEqual({ name: '템플릿 이름을 1~80자로 적어 주세요.', csPhone: '고객센터 전화와 이메일 가운데 하나는 적어 주세요.' });
    expect(result.values?.shippingNotice).toBe('배송 안내');
    expect(result.saved).toBeUndefined();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* N-1·N-3: 코드·버전·확인 근거를 보내지 않는다. 저장 한 번으로 바로 상품에서 고를 수 있다. */
  it('새 템플릿은 이름과 본문만 한 번에 저장하고, 등록했다는 결과를 돌려준다', async () => {
    const result = await saveShippingNoticeTemplateAction({}, form());
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_and_apply_shipping_notice_template', {
      p_operation: OPERATION, p_template_id: null, p_expected_updated_at: null, p_name: '기본 배송 안내',
      p_shipping_notice: '배송 안내', p_return_exchange_notice: '교환·반품 안내', p_remote_area_notice: '제주·도서산간은 1~2일 더 걸립니다.',
      p_cs_name: '엑스스퀘어 CS', p_cs_phone: '02-000-0000', p_cs_email: 'help@example.com',
    });
    expect(result).toMatchObject({ saved: { id: TEMPLATE, name: '기본 배송 안내', created: true, appliedGoods: 0 } });
    expect(result.errors).toBeUndefined();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(['/admin/settings/shipping-notices', '/admin/catalog/goods']);
  });

  it('고칠 때는 연 줄과 그때의 시각을 보내고, 상품의 안내가 바뀌었으면 고객 화면도 다시 그린다', async () => {
    mocks.rpc.mockResolvedValue(saved({ created: false, appliedGoods: 12 }));
    const result = await saveShippingNoticeTemplateAction({}, form({ id: TEMPLATE, updatedAt: '2026-11-26T01:00:00.123456+00:00' }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_and_apply_shipping_notice_template', expect.objectContaining({
      p_template_id: TEMPLATE, p_expected_updated_at: '2026-11-26T01:00:00.123456+00:00' }));
    expect(result.saved).toEqual({ id: TEMPLATE, name: '기본 배송 안내', created: false, appliedGoods: 12 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop/[goodId]', 'page');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/shipping-notices');
  });

  it('연 줄의 번호나 시각이 깨졌거나 작업 번호가 없으면 저장하지 않는다', async () => {
    expect((await saveShippingNoticeTemplateAction({}, form({ id: 'not-a-uuid', updatedAt: '2026-11-26T01:00:00Z' }))).errors?.form).toContain('템플릿을 다시 열어 주세요.');
    expect((await saveShippingNoticeTemplateAction({}, form({ id: TEMPLATE, updatedAt: '' }))).errors?.form).toContain('템플릿을 다시 열어 주세요.');
    expect((await saveShippingNoticeTemplateAction({}, form({ operationId: '' }))).errors?.form).toBe('화면을 새로고침한 뒤 다시 저장해 주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('다른 사람이 먼저 바꿨으면 그렇게 알리고 두 길을 고르게 한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'shipping_notice_template_conflict private' } });
    const result = await saveShippingNoticeTemplateAction({}, form({ id: TEMPLATE, updatedAt: '2026-11-26T01:00:00Z' }));
    expect(result).toMatchObject({ conflict: true, errors: { form: '다른 사람이 먼저 바꿨습니다.' } });
    expect(result.uncertain).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private');
    /* 같은 버전이 먼저 생긴 경우(23505)도 고치는 중이면 같은 뜻이다. 새 템플릿이면 다시 저장하라고 한다. */
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    expect(await saveShippingNoticeTemplateAction({}, form({ id: TEMPLATE, updatedAt: '2026-11-26T01:00:00Z' }))).toMatchObject({ conflict: true });
    const fresh = await saveShippingNoticeTemplateAction({}, form());
    expect(fresh.conflict).toBeUndefined();
    expect(fresh.errors?.form).toBe('저장하지 못했습니다. 적은 내용은 그대로 있습니다. 잠시 뒤 다시 저장해 주세요.');
  });

  it('저장하지 않은 것이 분명한 거절은 고칠 방법과 함께 알린다', async () => {
    const reject = async (code: string, message: string) => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
      const result = await saveShippingNoticeTemplateAction({}, form({ id: TEMPLATE, updatedAt: '2026-11-26T01:00:00Z' }));
      expect(result.uncertain).toBeUndefined();
      return result.errors?.form;
    };
    expect(await reject('23514', 'shipping_notice_template_required')).toBe('배송 안내, 교환·반품 안내, 고객센터 이름, 고객센터 전화나 이메일을 모두 적은 뒤 다시 저장해 주세요.');
    expect(await reject('P0002', 'shipping_notice_template_not_found')).toBe('템플릿을 찾을 수 없습니다. 창을 닫고 목록을 새로고침해 주세요.');
    expect(await reject('PT409', 'shipping_notice_template_operation_mismatch')).toContain('앞서 누른 저장과 내용이나 로그인한 계정이 달라');
    expect(await reject('42501', 'operator_capability_required')).toBe(PERMISSION);
    expect(await reject('22023', 'invalid_shipping_notice_template')).toContain('칸마다 글자 수를 확인한 뒤');
    expect(await reject('PGRST202', 'Could not find the function')).toBe('저장하지 못했습니다. 적은 내용은 그대로 있습니다. 잠시 뒤 다시 저장해 주세요.');
    /* 교착(40P01)으로 끝난 저장은 통째로 되돌려졌다. 저장됐는지 모른다고 하지 않고 다시 저장하라고 한다. */
    expect(await reject('40P01', 'deadlock detected')).toBe('저장하지 못했습니다. 적은 내용은 그대로 있습니다. 잠시 뒤 다시 저장해 주세요.');
  });

  it('저장됐는지 알 수 없으면 같은 작업 번호로 다시 확인하게 한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    expect(await saveShippingNoticeTemplateAction({}, form())).toMatchObject({ uncertain: true, errors: { form: UNKNOWN } });
    mocks.rpc.mockRejectedValue(new Error('fetch failed'));
    expect(await saveShippingNoticeTemplateAction({}, form())).toMatchObject({ uncertain: true, errors: { form: UNKNOWN } });
    /* 응답 모양이 다르면 저장됐다고 말하지 않는다. */
    mocks.rpc.mockReset().mockResolvedValue({ data: { id: TEMPLATE }, error: null });
    const odd = await saveShippingNoticeTemplateAction({}, form());
    expect(odd).toMatchObject({ uncertain: true });
    expect(odd.saved).toBeUndefined();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('운영자가 아니면 저장하지 않고 권한을 받는 방법을 알린다', async () => {
    mocks.auth.isStaff = false;
    expect((await saveShippingNoticeTemplateAction({}, form())).errors?.form).toBe(PERMISSION);
    expect(await readShippingNoticeTemplateAction('n-abc')).toEqual({ ok: false, error: PERMISSION });
    expect(await listShippingNoticeTemplateOptionsAction()).toEqual({ ok: false, error: PERMISSION });
    expect(await applyShippingNoticeTemplateToGoodsAction({ id: TEMPLATE, code: 'n-abc' }, [{ id: 'good-1', name: '키링' }])).toEqual({ ok: false, error: PERMISSION });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.goods).not.toHaveBeenCalled();
  });
});

describe('배송 안내 템플릿 읽기', () => {
  it('편집 창은 코드로 지금 내용과 쓰는 상품 수를 읽는다', async () => {
    const row = { id: TEMPLATE, code: 'n-abc', version: 2, name: '기본', shippingNotice: '배송', returnExchangeNotice: '반품', remoteAreaNotice: '',
      csName: 'CS', csPhone: '02', csEmail: '', status: 'active', updatedAt: '2026-11-26T01:00:00+00:00', goodsCount: 4 };
    mocks.rpc.mockResolvedValue({ data: { total: 1, rows: [row] }, error: null });
    expect(await readShippingNoticeTemplateAction('n-abc')).toEqual({ ok: true, template: row });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_shipping_notice_templates', { p_query: '', p_limit: 1, p_offset: 0, p_code: 'n-abc' });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private' } });
    expect(await readShippingNoticeTemplateAction('n-abc')).toEqual({ ok: false, error: '지금 저장된 템플릿을 읽지 못했습니다. 잠시 뒤 다시 눌러 주세요.' });
    mocks.rpc.mockClear();
    expect((await readShippingNoticeTemplateAction('Bad Code')).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* 0-3: 상품등록의 선택창이 열릴 때 부른다. 다른 탭에서 만든 템플릿도 새로고침 없이 보인다. */
  it('선택창용 목록은 지금 고를 수 있는 템플릿과 준비 중인 템플릿 수를 돌려준다', async () => {
    mocks.templates.mockResolvedValue({ data: [
      { id: 'a2', code: 'basic', version: 2, name: '기본', shipping_notice: '배송', return_exchange_notice: '반품', remote_area_notice: '', cs_name: 'CS', cs_phone: '02', cs_email: '', status: 'active' },
      { id: 'a1', code: 'basic', version: 1, name: '옛 기본', shipping_notice: '배송', return_exchange_notice: '반품', remote_area_notice: '', cs_name: 'CS', cs_phone: '02', cs_email: '', status: 'active' },
      { id: 'p1', code: 'pending', version: 1, name: '준비', shipping_notice: '', return_exchange_notice: '', remote_area_notice: '', cs_name: '', cs_phone: '', cs_email: '', status: 'draft' },
    ], error: null });
    const result = await listShippingNoticeTemplateOptionsAction();
    expect(result).toMatchObject({ ok: true, pendingCount: 1 });
    expect(result.ok && result.options.map((option) => `${option.code}@${option.version}`)).toEqual(['basic@2']);
    mocks.templates.mockResolvedValue({ data: null, error: { message: 'private' } });
    expect(await listShippingNoticeTemplateOptionsAction()).toEqual({ ok: false, error: '템플릿 목록을 새로 읽지 못했습니다.' });
  });
});

describe('배송 안내 템플릿을 상품에 적용', () => {
  const picked = (...ids: string[]) => ids.map((id) => ({ id, name: `${id} 이름` }));
  const OPENED = { id: TEMPLATE, code: 'n-abc' };
  const APPLY = 'admin_apply_shipping_notice_template';
  /** 템플릿의 지금 줄을 읽는 조회와 상품마다 부르는 적용 함수를 가른다. */
  const database = (apply: (goodId: string) => unknown = () => ({ data: {}, error: null }), latestId = TEMPLATE) =>
    mocks.rpc.mockImplementation(async (name: string, args: { target_good_id: string }) => name === APPLY ? apply(args.target_good_id)
      : { data: { total: 1, rows: [{ id: latestId, code: 'n-abc', version: 2, name: '기본', updatedAt: '2026-11-26T01:00:00+00:00', status: 'active', goodsCount: 0 }] }, error: null });
  const applyCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === APPLY);

  it('상품마다 적용하고, 된 것·이미 쓰던 것·안 된 것을 나눠 돌려준다', async () => {
    mocks.goods.mockResolvedValue({ data: [
      good('good-new'), good('good-same', { shipping_notice_template_id: TEMPLATE }), good('good-archived', { archived_at: '2026-11-01T00:00:00Z' }), good('good-busy'),
    ], error: null });
    database((goodId) => goodId === 'good-busy' ? { data: null, error: { code: 'PT409', message: 'good_shipping_notice_conflict' } } : { data: {}, error: null });
    const result = await applyShippingNoticeTemplateToGoodsAction(OPENED, picked('good-new', 'good-same', 'good-archived', 'good-busy', 'good-gone', 'good-new'));
    expect(result).toEqual({ ok: true, result: { applied: 1, unchanged: 1, failed: [
      { name: 'good-archived 상품', reason: '보관한 상품' },
      { name: 'good-busy 상품', reason: '다른 사람이 방금 고친 상품' },
      { name: 'good-gone 이름', reason: '찾을 수 없는 상품' },
    ] } });
    expect(mocks.goods).toHaveBeenCalledWith('id', ['good-new', 'good-same', 'good-archived', 'good-busy', 'good-gone']);
    /* 이미 쓰던 상품·보관한 상품·없는 상품은 적용 함수를 부르지 않는다. 부를 때는 읽은 시각을 함께 보낸다. */
    expect(applyCalls()).toEqual([
      [APPLY, { target_good_id: 'good-new', target_template_id: TEMPLATE, expected_good_updated_at: '2026-11-26T01:00:00+00:00' }],
      [APPLY, { target_good_id: 'good-busy', target_template_id: TEMPLATE, expected_good_updated_at: '2026-11-26T01:00:00+00:00' }],
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/shipping-notices');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop/[goodId]', 'page');
  });

  it('준비 중인 템플릿은 적용하지 않고 먼저 저장하라고 알린다', async () => {
    mocks.goods.mockResolvedValue({ data: [good('good-1'), good('good-2')], error: null });
    database(() => ({ data: null, error: { code: '23514', message: 'shipping_notice_template_not_active' } }));
    expect(await applyShippingNoticeTemplateToGoodsAction(OPENED, picked('good-1', 'good-2')))
      .toEqual({ ok: false, error: '준비 중인 템플릿은 상품에 적용할 수 없습니다. 먼저 [수정]을 눌러 저장해 주세요.' });
    expect(applyCalls()).toHaveLength(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  /* 화면을 연 뒤 다른 사람이 템플릿을 고쳤으면, 고치기 전 내용을 상품에 넣지 않는다. */
  it('연 줄이 더는 이 템플릿의 지금 내용이 아니면 적용하지 않는다', async () => {
    mocks.goods.mockResolvedValue({ data: [good('good-1')], error: null });
    database(undefined, '00000000-0000-4000-8000-000000049009');
    expect(await applyShippingNoticeTemplateToGoodsAction(OPENED, picked('good-1')))
      .toEqual({ ok: false, error: '다른 사람이 먼저 바꿨습니다. 창을 닫고 목록을 새로고침한 뒤 다시 적용해 주세요.' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_shipping_notice_templates', { p_query: '', p_limit: 1, p_offset: 0, p_code: 'n-abc' });
    expect(applyCalls()).toHaveLength(0);
    expect(mocks.goods).not.toHaveBeenCalled();
  });

  /*
   * 앱의 사전 확인과 적용 사이(상품을 차례로 적용하는 동안 포함)에 다른 사람이 템플릿을 고치면, 적용 함수가 상품마다 다시 확인해 거절한다.
   * 고치기 전 내용을 받은 상품이 '적용했습니다'로 보고되지 않는다.
   */
  it('적용하는 사이 템플릿이 고쳐지면 그 상품부터 넣지 않고 멈춘다', async () => {
    mocks.goods.mockResolvedValue({ data: [good('good-1'), good('good-2'), good('good-3')], error: null });
    database(() => ({ data: null, error: { code: 'PT409', message: 'shipping_notice_template_conflict' } }));
    expect(await applyShippingNoticeTemplateToGoodsAction(OPENED, picked('good-1', 'good-2', 'good-3')))
      .toEqual({ ok: false, error: '다른 사람이 먼저 바꿨습니다. 창을 닫고 목록을 새로고침한 뒤 다시 적용해 주세요.' });
    expect(applyCalls()).toHaveLength(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    /* 첫 상품은 적용됐고 둘째에서 고쳐진 것을 알았다: 남은 상품은 건드리지 않고, 적용한 수와 멈췄다는 것을 돌려준다. */
    mocks.rpc.mockReset(); mocks.revalidatePath.mockReset();
    database((goodId) => goodId === 'good-1' ? { data: {}, error: null } : { data: null, error: { code: 'PT409', message: 'shipping_notice_template_conflict' } });
    expect(await applyShippingNoticeTemplateToGoodsAction(OPENED, picked('good-1', 'good-2', 'good-3')))
      .toEqual({ ok: true, result: { applied: 1, unchanged: 0, failed: [], stopped: true } });
    expect(applyCalls().map(([, args]) => (args as { target_good_id: string }).target_good_id)).toEqual(['good-1', 'good-2']);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/shipping-notices');
  });

  it('일부를 적용한 뒤 끊기면 적용한 수와 멈췄다는 것을 함께 돌려준다', async () => {
    mocks.goods.mockResolvedValue({ data: [good('good-1'), good('good-2')], error: null });
    database((goodId) => { if (goodId === 'good-2') throw new Error('fetch failed'); return { data: {}, error: null }; });
    expect(await applyShippingNoticeTemplateToGoodsAction(OPENED, picked('good-1', 'good-2')))
      .toEqual({ ok: true, result: { applied: 1, unchanged: 0, failed: [], stopped: true } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/shipping-notices');
  });

  it('고른 상품이 없거나 100개를 넘으면 상품을 읽지 않는다', async () => {
    expect(await applyShippingNoticeTemplateToGoodsAction(OPENED, [])).toEqual({ ok: false, error: '적용할 상품을 먼저 골라 주세요.' });
    const many = Array.from({ length: 101 }, (_, index) => ({ id: `good-${index}`, name: '상품' }));
    expect(await applyShippingNoticeTemplateToGoodsAction(OPENED, many)).toEqual({ ok: false, error: '한 번에 100개까지 적용할 수 있습니다. 나눠서 적용해 주세요.' });
    expect((await applyShippingNoticeTemplateToGoodsAction({ id: 'bad', code: 'n-abc' }, picked('good-1'))).ok).toBe(false);
    expect((await applyShippingNoticeTemplateToGoodsAction({ id: TEMPLATE, code: 'Bad Code' }, picked('good-1'))).ok).toBe(false);
    expect(mocks.goods).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
