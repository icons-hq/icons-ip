import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveAdminCategoryAction, assignAdminGoodCategoryAction, bulkCreateAdminCategoriesAction, reorderAdminCategoriesAction, saveAdminCategoryAction, saveAdminCategoryErpMappingAction, setAdminCategoryActivationAction } from './category-actions';
import { STOREFRONT_MEGA_MENU_CACHE_TAG } from '@/lib/storefront-mega-menu';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff-1' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), role: 'staff' as const },
  getAuth: vi.fn(), createClient: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(), updateTag: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getAuth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath, updateTag: mocks.updateTag }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); }, unstable_rethrow: (error: unknown) => { throw error; } }));

function form(values: Record<string, string> = {}) {
  const result = new FormData();
  result.set('operationId', '00000000-0000-4000-8000-000000047401');
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

beforeEach(() => {
  mocks.getAuth.mockReset().mockResolvedValue(mocks.auth);
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  mocks.createClient.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.revalidatePath.mockReset();
  mocks.updateTag.mockReset();
});

describe('admin category actions', () => {
  it('validates category code/name before RPC and preserves input', async () => {
    const result = await saveAdminCategoryAction({}, form({ code: '한글', name: '' }));
    expect(result).toMatchObject({ errors: { code: expect.any(String), name: expect.any(String) }, values: { code: '한글' }, attempt: 1 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('saves a category through the audited RPC', async () => {
    await expect(saveAdminCategoryAction({}, form({ code: 'paper', name: '문구', sortOrder: '1' }))).resolves.toEqual({
      message: '카테고리를 등록했습니다.', changed: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_category', expect.objectContaining({ target_code: 'paper', target_name: '문구', target_parent_id: null }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/catalog/categories');
    /* 상품분류 저장도 공개 메뉴(분류 공개·연결)를 바꿀 수 있어 셸 메뉴 캐시를 함께 만료한다. */
    expect(mocks.updateTag).toHaveBeenCalledWith(STOREFRONT_MEGA_MENU_CACHE_TAG);
  });

  /* ADR-0044: 상품 유형 연결은 없다. 폼에 옛 goodType 값이 와도 읽지 않고 RPC에 유형 인자를 보내지 않는다. */
  it('상품 유형 연결을 보내지 않고, 옛 폼의 goodType 값은 무시한다', async () => {
    await saveAdminCategoryAction({}, form({ code: 'figure', name: '피규어' }));
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_upsert_category', expect.objectContaining({ target_code: 'figure' }));
    expect(mocks.rpc.mock.lastCall?.[1]).not.toHaveProperty('target_good_type');
    await saveAdminCategoryAction({}, form({ code: 'figure', name: '피규어', goodType: '피규어' }));
    expect(mocks.rpc.mock.lastCall?.[1]).not.toHaveProperty('target_good_type');
    const invalid = await saveAdminCategoryAction({}, form({ code: 'figure', name: '피규어', goodType: '포스터' }));
    expect(invalid).not.toHaveProperty('errors');
  });

  /* C-06: 새 카테고리는 코드를 비워 두면 자동으로 만든다. 작업 번호에서 만들어 같은 저장을 다시 보내도 같은 코드다. */
  it('새 카테고리는 코드를 비워 두면 작업 번호에서 자동 코드를 만들고, 고치는 카테고리는 코드가 꼭 있어야 한다', async () => {
    await saveAdminCategoryAction({}, form({ name: '문구', sortOrder: '3' }));
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_upsert_category', expect.objectContaining({
      target_operation_id: '00000000-0000-4000-8000-000000047401', target_code: 'c-0000000000', target_name: '문구', target_sort_order: 3,
    }));
    await saveAdminCategoryAction({}, form({ name: '문구', code: 'paper' }));
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_upsert_category', expect.objectContaining({ target_code: 'paper' }));
    mocks.rpc.mockClear();
    const editing = await saveAdminCategoryAction({}, form({ id: '00000000-0000-4000-8000-000000047499', name: '문구', code: '', expectedUpdatedAt: '2026-09-10T00:00:00Z' }));
    expect(editing).toMatchObject({ errors: { code: expect.stringContaining('카테고리 코드는 영문 소문자·숫자·하이픈(-)만') } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('DB가 거절한 이유를 고칠 방법과 함께 알려 준다', async () => {
    const messageFor = async (message: string) => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
      return (await saveAdminCategoryAction({}, form({ code: 'paper', name: '문구' }))).errors?.form;
    };
    expect(await messageFor('category_code_taken')).toBe('다른 카테고리가 이미 쓰는 코드입니다. 다른 코드로 바꿔 다시 저장해주세요.');
    expect(await messageFor('category_parent_archived')).toBe('보관한 카테고리 아래에는 둘 수 없습니다. 상위 카테고리를 먼저 복원하거나 다른 상위 카테고리를 골라주세요.');
    expect(await messageFor('category_has_goods')).toContain('다른 상위 카테고리를 고르거나');
    expect(await messageFor('category_changed')).toBe('다른 사람이 먼저 바꿨습니다. 새로고침한 뒤 다시 해주세요.');
    /* 화면에서 쓰지 않는 말: 부모·요청·트리. */
    for (const raw of ['category_code_taken', 'category_cycle', 'category_depth_exceeded', 'category_parent_archived', 'category_has_goods', 'operation_conflict', 'unknown']) {
      expect(await messageFor(raw)).not.toMatch(/부모|요청|트리/);
    }
  });

  /* C-02: 카테고리를 고르지 않은 채 저장하면 대표 카테고리가 지워지던 길을 막는다. 지우는 일은 [미분류로 되돌리기](intent=clear)만 한다. */
  it('대표 카테고리 바꾸기는 카테고리를 골라야 저장하고, 고르지 않으면 DB에 닿지 않는다', async () => {
    const empty = await assignAdminGoodCategoryAction({}, form({ goodId: 'g100', categoryId: '' }));
    expect(empty).toMatchObject({ errors: { categoryId: '바꿀 대표 카테고리를 고른 뒤 다시 눌러주세요.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
    const noGood = await assignAdminGoodCategoryAction({}, form({ goodId: '', categoryId: '00000000-0000-4000-8000-000000047499' }));
    expect(noGood).toMatchObject({ errors: { form: '상품을 고르지 않았습니다. [상품 고르기]로 상품을 고른 뒤 다시 눌러주세요.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(assignAdminGoodCategoryAction({}, form({ goodId: 'g100', categoryId: '00000000-0000-4000-8000-000000047499' }))).resolves.toEqual({
      message: '대표 카테고리를 바꿨습니다.', changed: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_assign_good_category', expect.objectContaining({ target_good_id: 'g100', target_category_id: '00000000-0000-4000-8000-000000047499' }));
  });

  it('[미분류로 되돌리기]만 대표 카테고리를 지우고, 공개 중 상품은 계약 문구로 안내한다', async () => {
    await expect(assignAdminGoodCategoryAction({}, form({ goodId: 'g100', intent: 'clear', categoryId: '00000000-0000-4000-8000-000000047499' }))).resolves.toEqual({
      message: '대표 카테고리를 지웠습니다. 이 상품은 지금 미분류입니다.', changed: true,
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_assign_good_category', expect.objectContaining({ target_good_id: 'g100', target_category_id: null }));
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'goods_published_category_clear' } });
    const cleared = await assignAdminGoodCategoryAction({}, form({ goodId: 'g100', intent: 'clear' }));
    expect(cleared).toMatchObject({ errors: { form: '공개 중인 상품은 대표 카테고리를 비울 수 없습니다. 다른 카테고리를 고르거나 비공개로 전환한 뒤 비워주세요.' } });
  });

  /* 결정 D3(2026-11-25): 근거 칸을 없앤다. 켜기·끄기만 보내고, 근거 인자는 빈 값으로 둔다(DB가 저장돼 있던 근거를 그대로 둔다). */
  it('사용 설정은 근거 없이 켜고 끄며, 화면에 없는 ERP 분류 값은 폼이 실어 온 대로 보낸다', async () => {
    mocks.getAuth.mockResolvedValue({ ...mocks.auth, role: 'admin' });
    await expect(setAdminCategoryActivationAction({}, form({ customerEnabled: 'on' }))).resolves.toEqual({
      message: '켰습니다. 고객 화면에 카테고리가 보입니다.', changed: true,
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_set_category_activation', {
      target_operation_id: '00000000-0000-4000-8000-000000047401', target_customer_enabled: true, target_erp_enabled: false, target_evidence: {},
    });
    await expect(setAdminCategoryActivationAction({}, form({ erpEnabled: 'on' }))).resolves.toEqual({
      message: '껐습니다. 고객 화면에서 카테고리를 내렸습니다.', changed: true,
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_set_category_activation', expect.objectContaining({ target_customer_enabled: false, target_erp_enabled: true, target_evidence: {} }));
    /* 옛 화면이 보내던 근거 칸은 읽지 않는다. */
    await setAdminCategoryActivationAction({}, form({ customerEnabled: 'on', customerEvidenceSource: '운영 분류표', customerEvidenceReference: 'LG-3', customerEvidenceVerifiedAt: '2026-10-26T00:00:00Z' }));
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_set_category_activation', expect.objectContaining({ target_evidence: {} }));
  });

  /* 리드 지시(LG-3) — 고객 카테고리 공개를 켜거나 끄면 공개 메가메뉴·카테고리 시트가 300초 셸 캐시를 기다리지 않고 바로 바뀐다. */
  it('고객 카테고리 공개 전환이 성공하면 공개 메뉴 캐시 태그를 즉시 만료한다', async () => {
    mocks.getAuth.mockResolvedValue({ ...mocks.auth, role: 'admin' });
    await setAdminCategoryActivationAction({}, form({ customerEnabled: 'on' }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_category_activation', expect.objectContaining({ target_customer_enabled: true }));
    expect(mocks.updateTag).toHaveBeenCalledWith(STOREFRONT_MEGA_MENU_CACHE_TAG);

    /* 끄는 쪽도 같다. */
    mocks.updateTag.mockReset();
    await setAdminCategoryActivationAction({}, form({}));
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_set_category_activation', expect.objectContaining({ target_customer_enabled: false }));
    expect(mocks.updateTag).toHaveBeenCalledWith(STOREFRONT_MEGA_MENU_CACHE_TAG);
  });

  /* 거절되는 까닭은 둘이다: 그사이 카테고리가 모두 없어졌거나(새로고침하면 버튼이 잠기고 아래에 이유가 보인다), 화면에 없는 ERP 분류 값이
     걸렸거나(새로고침하면 화면이 끈 값으로 보내 다시 누르면 된다). 카드에 이유가 늘 적혀 있는 것은 아니라 '적힌 이유를 확인'이라고만 하지 않는다. */
  it('공개 전환을 DB가 거절하면 새로고침한 뒤 다시 누르라고 알리고 메뉴 캐시를 건드리지 않는다', async () => {
    mocks.getAuth.mockResolvedValue({ ...mocks.auth, role: 'admin' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'category_activation_unready' } });
    await expect(setAdminCategoryActivationAction({}, form({ customerEnabled: 'on' }))).resolves.toMatchObject({
      errors: { form: '지금은 바꿀 수 없습니다. 새로고침한 뒤 다시 눌러주세요. 버튼이 잠겨 있으면 그 아래에 이유가 적혀 있습니다.' },
    });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it('ERP 코드·품명은 출처·검증 시각 없이 저장하고, 두 칸이 비면 DB에 닿지 않는다', async () => {
    const categoryId = '00000000-0000-4000-8000-000000047499';
    await expect(saveAdminCategoryErpMappingAction({}, form({ categoryId, erpCode: ' ERP-01 ', erpName: ' 문구 ' }))).resolves.toEqual({
      message: 'ERP 코드를 저장했습니다.', changed: true,
    });
    /* 출처·검증 시각 인자는 DB 함수에 남아 있어 빈 값으로 보낸다 — 이미 저장된 값은 DB가 그대로 둔다. */
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_category_erp_mapping', {
      target_operation_id: '00000000-0000-4000-8000-000000047401', target_category_id: categoryId,
      target_erp_code: 'ERP-01', target_erp_name: '문구', target_source: null, target_verified_at: null,
    });
    mocks.rpc.mockClear();
    const missing = await saveAdminCategoryErpMappingAction({}, form({ categoryId, erpCode: '', erpName: ' ' }));
    expect(missing).toMatchObject({ errors: { erpCode: 'ERP 코드를 적어주세요.', erpName: 'ERP 품명을 적어주세요.' } });
    /* 옛 화면이 보내던 출처·검증 시각은 읽지 않고, 없다고 막지도 않는다. */
    await saveAdminCategoryErpMappingAction({}, form({ categoryId, erpCode: 'ERP-01', erpName: '문구', source: 'ERP sheet', verifiedAt: '2026-11-10T09:30' }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_set_category_erp_mapping', expect.objectContaining({ target_source: null, target_verified_at: null }));
  });

  it('보관은 작업 번호·카테고리·읽은 시각을 그대로 보낸다', async () => {
    await expect(archiveAdminCategoryAction({}, form({ id: '00000000-0000-4000-8000-000000047499', expectedUpdatedAt: '2026-09-10T00:00:00Z' }))).resolves.toEqual({
      message: '카테고리를 보관했습니다.', changed: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_archive_category', {
      target_operation_id: '00000000-0000-4000-8000-000000047401', target_category_id: '00000000-0000-4000-8000-000000047499', target_expected_updated_at: '2026-09-10T00:00:00Z',
    });
  });

  it('blocks non-staff before RPC', async () => {
    mocks.getAuth.mockResolvedValue({ ...mocks.auth, isStaff: false, user: { id: 'user-1' }, role: 'user' });
    await expect(saveAdminCategoryAction({}, form({ code: 'paper', name: '문구' }))).resolves.toMatchObject({ errors: { form: '카테고리를 바꿀 권한이 없습니다. 상품 관리 권한이 있는 계정으로 다시 해주세요.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

it('configured deputy can save categories but cannot change ERP mappings or activation', async () => {
  mocks.getAuth.mockResolvedValue({ ...mocks.auth, operatorAccess: configuredOperatorAccessFixture('deputy') });
  expect((await saveAdminCategoryAction({}, form({ code: 'paper', name: '합성 문구', sortOrder: '1' }))).message).toContain('등록했습니다');
  mocks.rpc.mockClear();
  expect((await saveAdminCategoryErpMappingAction({}, form())).errors?.form).toBe('이 설정은 통합 매니저와 계정 주매니저만 바꿀 수 있습니다. 그 계정으로 다시 해주세요.');
  expect((await setAdminCategoryActivationAction({}, form())).errors?.form).toContain('통합 매니저와 계정 주매니저만');
  expect(mocks.rpc).not.toHaveBeenCalled();
});

/* R9(10/27 회의): 카테고리 관리 일괄 등록 — 붙여넣은 `대>중>소` 경로를 한 번의 감사 RPC로 보내고, 결과표 줄 번호는 붙여넣은 원래 줄을 가리킨다. */
describe('카테고리 일괄 등록', () => {
  const operationId = '00000000-0000-4000-8000-000000047450';
  const rpcResult = {
    createdCategories: 3, createdLines: 1, skippedLines: 1, failedLines: 0,
    lines: [
      { line: 1, path: '문구>노트>스프링노트', status: 'created', created: 3, reason: null },
      { line: 2, path: '문구>노트>스프링노트', status: 'skipped', created: 0, reason: null },
    ],
  };

  it('빈 줄을 뺀 경로만 보내고 결과 줄 번호를 붙여넣은 줄로 되돌린다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: rpcResult, error: null });
    const result = await bulkCreateAdminCategoriesAction({ operationId, text: '\n문구>노트>스프링노트\n\n문구>노트>스프링노트' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_bulk_create_categories', { p_operation_id: operationId, p_paths: ['문구>노트>스프링노트', '문구>노트>스프링노트'] });
    expect(result).toEqual({ ok: true, result: { ...rpcResult, lines: [{ ...rpcResult.lines[0], line: 2 }, { ...rpcResult.lines[1], line: 4 }] } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/catalog/categories');
    expect(mocks.updateTag).toHaveBeenCalledWith(STOREFRONT_MEGA_MENU_CACHE_TAG);
  });

  it('새로 만든 카테고리가 없으면 화면 캐시를 건드리지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...rpcResult, createdCategories: 0, createdLines: 0, skippedLines: 2 }, error: null });
    expect(await bulkCreateAdminCategoriesAction({ operationId, text: '문구>노트' })).toMatchObject({ ok: true });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('입력·권한·응답 형식을 RPC 전후로 확인한다', async () => {
    expect(await bulkCreateAdminCategoriesAction({ operationId, text: ' \n ' })).toEqual({ ok: false, error: '등록할 경로를 한 줄에 하나씩 입력하세요.' });
    expect(await bulkCreateAdminCategoriesAction({ operationId: 'nope', text: '문구' })).toMatchObject({ ok: false });
    expect(await bulkCreateAdminCategoriesAction({ operationId, text: Array.from({ length: 1001 }, (_, index) => `분류${index}`).join('\n') }))
      .toEqual({ ok: false, error: '한 번에 1,000줄까지 등록할 수 있습니다. 나눠서 등록하세요.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: { lines: 'broken' }, error: null });
    expect(await bulkCreateAdminCategoriesAction({ operationId, text: '문구' })).toMatchObject({ ok: false, error: expect.stringContaining('결과를 확인하지 못했습니다') });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'operation_conflict' } });
    expect(await bulkCreateAdminCategoriesAction({ operationId, text: '문구' })).toMatchObject({ ok: false, error: '방금 누른 저장이 이미 처리됐습니다. 새로고침해 카테고리 목록에 반영됐는지 확인해주세요.' });
    mocks.getAuth.mockResolvedValue({ ...mocks.auth, isStaff: false, user: { id: 'user-1' }, role: 'user' });
    mocks.rpc.mockClear();
    expect(await bulkCreateAdminCategoriesAction({ operationId, text: '문구' })).toEqual({ ok: false, error: '카테고리를 바꿀 권한이 없습니다. 상품 관리 권한이 있는 계정으로 다시 해주세요.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

/* C-07: 순서는 숫자 칸 대신 목록의 [위로]·[아래로]로 바꾼다. 같은 상위 아래의 카테고리 전체를 새 순서대로 한 번에 보낸다. */
describe('카테고리 순서 바꾸기', () => {
  const operationId = '00000000-0000-4000-8000-000000047460';
  const parentId = '00000000-0000-4000-8000-000000047461';
  const orderedIds = ['00000000-0000-4000-8000-000000047463', '00000000-0000-4000-8000-000000047462'];

  it('새 순서를 감사 RPC 한 번으로 보내고, 바뀌었으면 화면과 공개 메뉴를 새로 읽게 한다', async () => {
    expect(await reorderAdminCategoriesAction({ operationId, parentId, orderedIds })).toEqual({ ok: true, changed: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_reorder_categories', { target_operation_id: operationId, target_parent_id: parentId, target_ordered_ids: orderedIds });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/catalog/categories');
    expect(mocks.updateTag).toHaveBeenCalledWith(STOREFRONT_MEGA_MENU_CACHE_TAG);
    /* 최상위는 상위가 없다. 이미 그 순서면 바뀐 것이 없어 화면을 다시 읽지 않는다. */
    mocks.revalidatePath.mockReset();
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await reorderAdminCategoriesAction({ operationId, parentId: null, orderedIds })).toEqual({ ok: true, changed: false });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_reorder_categories', expect.objectContaining({ target_parent_id: null }));
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('형식이 맞지 않는 목록은 DB에 닿지 않고, 그사이 누가 바꿨으면 새로고침을 안내한다', async () => {
    const stale = { ok: false, error: '화면이 오래돼 순서를 바꾸지 못했습니다. 새로고침한 뒤 다시 눌러주세요.' };
    expect(await reorderAdminCategoriesAction({ operationId: 'nope', parentId, orderedIds })).toEqual(stale);
    expect(await reorderAdminCategoriesAction({ operationId, parentId: 'nope', orderedIds })).toEqual(stale);
    expect(await reorderAdminCategoriesAction({ operationId, parentId, orderedIds: [] })).toEqual(stale);
    expect(await reorderAdminCategoriesAction({ operationId, parentId, orderedIds: [orderedIds[0], orderedIds[0]] })).toEqual(stale);
    expect(await reorderAdminCategoriesAction({ operationId, parentId, orderedIds: ['nope'] })).toEqual(stale);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'category_changed' } });
    expect(await reorderAdminCategoriesAction({ operationId, parentId, orderedIds })).toEqual({ ok: false, error: '다른 사람이 먼저 바꿨습니다. 새로고침한 뒤 다시 해주세요.' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('상품 관리 권한이 없으면 DB에 닿지 않는다', async () => {
    mocks.getAuth.mockResolvedValue({ ...mocks.auth, isStaff: false, user: { id: 'user-1' }, role: 'user' });
    expect(await reorderAdminCategoriesAction({ operationId, parentId, orderedIds })).toEqual({ ok: false, error: '카테고리를 바꿀 권한이 없습니다. 상품 관리 권한이 있는 계정으로 다시 해주세요.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
