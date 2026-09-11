import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAdminCategoryAction, saveAdminCategoryErpMappingAction, setAdminCategoryActivationAction } from './category-actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff-1' }, isStaff: true, role: 'staff' as const },
  getAuth: vi.fn(), createClient: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getAuth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
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
  });

  it('does not enable ERP without real evidence', async () => {
    const result = await setAdminCategoryActivationAction({}, form({ erpEnabled: 'on' }));
    expect(result).toMatchObject({ errors: { form: 'ERP 실제 분류와 검증 근거를 입력해주세요.' } });
    expect(mocks.rpc).not.toHaveBeenCalled();
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
