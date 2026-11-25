const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) throw error; },
}));

import { searchErpItemPickerAction } from './erp-item-picker-actions';

const staff = { isConfigured: true, user: { id: 'staff', email: null }, role: 'staff', isStaff: true, operatorAccess: legacyOperatorAccessFixture() };
/* 부매니저(MD)는 상품 관리 권한으로 ERP 품목을 고른다. 물류 담당은 상품 관리 권한이 없다. */
const deputy = { isConfigured: true, user: { id: 'deputy', email: null }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('deputy') };
const logistics = { isConfigured: true, user: { id: 'logistics', email: null }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('logistics') };
const member = { isConfigured: true, user: { id: 'member', email: null }, role: 'user', isStaff: false };
const signedOut = { isConfigured: true, user: null, role: null, isStaff: false };
const DENIED = { ok: false, error: 'ERP 품목을 고르려면 상품 관리 권한이 필요합니다.' };
const FAILED = { ok: false, error: 'ERP 품목을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.' };

const dbRow = (code: string, extra: Record<string, unknown> = {}) => ({
  code, name: `품목 ${code}`, category: '문구 > 키링', sale_price: 12000, barcode: '0880000000123', mapped_category_id: null,
  imported_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', ...extra,
});
const page = (total: number, codes: string[]) => ({ data: { total, items: codes.map((code) => dbRow(code)) }, error: null });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(staff);
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
});

describe('ERP 품목 선택창 조회', () => {
  it('미로그인은 상품 화면으로 돌아오게 로그인으로 보내고, 상품 관리 권한이 없으면 DB에 닿지 않는다', async () => {
    mocks.auth.mockResolvedValue(signedOut);
    await expect(searchErpItemPickerAction({ query: '', page: 1 })).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fcatalog%2Fgoods');
    for (const auth of [member, logistics]) {
      mocks.auth.mockResolvedValue(auth);
      expect(await searchErpItemPickerAction({ query: '키링', page: 1 })).toEqual(DENIED);
    }
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('상품 관리 권한이 있으면 정리한 검색어로 20개씩 읽고, 선택창에 필요한 값만 돌려준다', async () => {
    mocks.auth.mockResolvedValue(deputy);
    mocks.rpc.mockResolvedValue(page(41, ['000123']));
    expect(await searchErpItemPickerAction({ query: '  아크릴\n키링 ', page: 2 })).toEqual({ ok: true, data: {
      rows: [{ code: '000123', name: '품목 000123', category: '문구 > 키링', salePrice: 12000, barcode: '0880000000123', mappedCategoryId: null }],
      total: 41, page: 2, pageSize: 20,
    } });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_list_erp_items', { p_query: '아크릴 키링', p_offset: 20, p_limit: 20 });
  });

  it('검색어가 없거나 조건이 깨져 있으면 첫 쪽 전체를 읽는다', async () => {
    mocks.rpc.mockResolvedValue(page(0, []));
    for (const input of [{ query: '   ', page: 0 }, { query: 42, page: '3' }, null, 'x', [1]]) {
      expect(await searchErpItemPickerAction(input)).toEqual({ ok: true, data: { rows: [], total: 0, page: 1, pageSize: 20 } });
    }
    for (const call of mocks.rpc.mock.calls) expect(call).toEqual(['admin_list_erp_items', { p_query: null, p_offset: 0, p_limit: 20 }]);
    /* 검색어는 100자까지, 쪽은 DB 함수가 받는 범위(건너뛰기 1,000,000줄) 안으로 줄인다. 결과가 없으면 첫 쪽으로 돌아온다. */
    mocks.rpc.mockClear();
    await searchErpItemPickerAction({ query: '가'.repeat(150), page: 9_999_999 });
    expect(mocks.rpc.mock.calls).toEqual([
      ['admin_list_erp_items', { p_query: '가'.repeat(100), p_offset: 999_980, p_limit: 20 }],
      ['admin_list_erp_items', { p_query: '가'.repeat(100), p_offset: 0, p_limit: 20 }],
    ]);
  });

  it('그사이 품목이 줄어 고른 쪽이 비면 마지막 쪽을 다시 읽는다', async () => {
    mocks.rpc.mockResolvedValueOnce(page(21, [])).mockResolvedValueOnce(page(21, ['Z-9']));
    const result = await searchErpItemPickerAction({ query: '', page: 5 });
    expect(result).toMatchObject({ ok: true, data: { total: 21, page: 2, rows: [{ code: 'Z-9' }] } });
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_offset)).toEqual([80, 20]);
  });

  it('DB가 권한으로 거절하면 권한 안내를, 그 밖의 오류·깨진 응답·연결 예외는 다시 검색하라는 안내를 돌려준다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'operator_capability_required' } });
    expect(await searchErpItemPickerAction({ query: '', page: 1 })).toEqual(DENIED);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid_erp_item_list' } });
    expect(await searchErpItemPickerAction({ query: '', page: 1 })).toEqual(FAILED);
    mocks.rpc.mockResolvedValueOnce({ data: { total: 1, items: [{ code: '', name: '깨진 줄' }] }, error: null });
    expect(await searchErpItemPickerAction({ query: '', page: 1 })).toEqual(FAILED);
    mocks.rpc.mockRejectedValueOnce(new Error('network details'));
    expect(await searchErpItemPickerAction({ query: '', page: 1 })).toEqual(FAILED);
  });
});
