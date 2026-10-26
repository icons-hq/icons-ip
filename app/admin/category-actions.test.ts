import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAdminCategoryAction, saveAdminCategoryErpMappingAction, setAdminCategoryActivationAction } from './category-actions';
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

  it('does not enable ERP without real evidence', async () => {
    const result = await setAdminCategoryActivationAction({}, form({ erpEnabled: 'on' }));
    expect(result).toMatchObject({ errors: { form: 'ERP 실제 분류와 검증 근거를 입력해주세요.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* 리드 지시(LG-3) — 고객 카테고리 공개를 켜거나 끄면 공개 메가메뉴·카테고리 시트가 300초 셸 캐시를 기다리지 않고 바로 바뀐다. */
  it('고객 카테고리 공개 전환이 성공하면 공개 메뉴 캐시 태그를 즉시 만료한다', async () => {
    mocks.getAuth.mockResolvedValue({ ...mocks.auth, role: 'admin' });
    const evidence = { customerEvidenceSource: '운영 분류표', customerEvidenceReference: 'LG-3', customerEvidenceVerifiedAt: '2026-10-26T00:00:00Z' };
    await expect(setAdminCategoryActivationAction({}, form({ customerEnabled: 'on', ...evidence }))).resolves.toEqual({
      message: '카테고리 활성화 상태를 저장했습니다.', changed: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_category_activation', expect.objectContaining({ target_customer_enabled: true }));
    expect(mocks.updateTag).toHaveBeenCalledWith(STOREFRONT_MEGA_MENU_CACHE_TAG);

    /* 끄는 쪽도 같다. */
    mocks.updateTag.mockReset();
    await setAdminCategoryActivationAction({}, form({}));
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_set_category_activation', expect.objectContaining({ target_customer_enabled: false }));
    expect(mocks.updateTag).toHaveBeenCalledWith(STOREFRONT_MEGA_MENU_CACHE_TAG);
  });

  it('공개 전환이 실패하거나 검증에서 멈추면 메뉴 캐시를 건드리지 않는다', async () => {
    mocks.getAuth.mockResolvedValue({ ...mocks.auth, role: 'admin' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'category_activation_unready' } });
    const evidence = { customerEvidenceSource: '운영 분류표', customerEvidenceReference: 'LG-3', customerEvidenceVerifiedAt: '2026-10-26T00:00:00Z' };
    await expect(setAdminCategoryActivationAction({}, form({ customerEnabled: 'on', ...evidence }))).resolves.toMatchObject({
      errors: { form: '실제 분류·ERP 값과 운영 확인 근거를 채운 뒤 활성화해주세요.' },
    });
    await setAdminCategoryActivationAction({}, form({ customerEnabled: 'on' }));
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it('stores ERP mapping values only after field validation', async () => {
    const categoryId = '00000000-0000-4000-8000-000000047499';
    await expect(saveAdminCategoryErpMappingAction({}, form({ categoryId, erpCode: 'ERP-01', erpName: '문구', source: 'ERP sheet', verifiedAt: '2026-09-10T00:00:00Z' }))).resolves.toEqual({
      message: 'ERP 분류 매핑을 저장했습니다.', changed: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_category_erp_mapping', expect.objectContaining({ target_category_id: categoryId, target_erp_code: 'ERP-01' }));
  });

  it('blocks non-staff before RPC', async () => {
    mocks.getAuth.mockResolvedValue({ ...mocks.auth, isStaff: false, user: { id: 'user-1' }, role: 'user' });
    await expect(saveAdminCategoryAction({}, form({ code: 'paper', name: '문구' }))).resolves.toMatchObject({ errors: { form: '관리자 권한이 필요합니다.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

it('configured deputy can save categories but cannot change ERP mappings or activation', async () => {
  mocks.getAuth.mockResolvedValue({ ...mocks.auth, operatorAccess: configuredOperatorAccessFixture('deputy') });
  expect((await saveAdminCategoryAction({}, form({ code: 'paper', name: '합성 문구', sortOrder: '1' }))).message).toContain('등록했습니다');
  mocks.rpc.mockClear();
  expect((await saveAdminCategoryErpMappingAction({}, form())).errors?.form).toContain('권한');
  expect((await setAdminCategoryActivationAction({}, form())).errors?.form).toContain('권한');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
