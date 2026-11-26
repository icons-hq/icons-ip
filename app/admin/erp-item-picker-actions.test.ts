const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* rpc: ERP 품목 목록 조회. identities·from: 그 품목을 이미 쓰는 옵션을 찾는 조회(옵션의 ERP 코드·바코드, 옵션·상품 이름). */
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn(), identities: vi.fn(), from: vi.fn() }));
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
  mocks.identities.mockResolvedValue({ data: [], error: null });
  mocks.from.mockImplementation(() => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }));
  mocks.client.mockResolvedValue({
    rpc: (name: string, args: unknown) => name === 'admin_list_goods_variant_external_identities' ? { in: (column: string, values: string[]) => mocks.identities(column, values, args) } : mocks.rpc(name, args),
    from: mocks.from,
  });
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

  /*
   * F1(2026-11-26 QA-B, 화면 규칙 2): ERP 코드·바코드는 옵션 전체에서 하나뿐이어야 저장된다. 다른 상품의 옵션이 쓰는 품목이 [선택]으로 보여
   * 고른 뒤 상품 전체 저장이 거절됐다. 조회가 줄마다 그 품목을 이미 쓰는 옵션을 싣고, 화면이 고르기 전에 막는다.
   */
  it('줄마다 그 품목을 이미 쓰는 옵션을 싣는다 — ERP 코드가 겹치는 옵션이 먼저, 없으면 바코드가 겹치는 옵션', async () => {
    mocks.rpc.mockResolvedValue({ data: { total: 3, items: [dbRow('ERP-A002', { barcode: '8800000000021' }), dbRow('ERP-A003', { barcode: '8800000000038' }), dbRow('ERP-A004', { barcode: null })] }, error: null });
    mocks.identities.mockImplementation(async (column: string) => column === 'erp_code'
      ? { data: [{ variant_id: 'variant-g5', good_id: 'g5', erp_code: 'erp-a002', barcode: null }], error: null }
      : { data: [{ variant_id: 'variant-g7', good_id: 'g7', erp_code: null, barcode: '8800000000038' }], error: null });
    mocks.from.mockImplementation((table: string) => ({ select: () => ({ in: async () => ({ error: null, data: table === 'goods'
      ? [{ id: 'g5', name: 'QA 키링' }, { id: 'g7', name: 'QA 머그' }] : [{ id: 'variant-g5', name: '기본 옵션' }, { id: 'variant-g7', name: '화이트' }] }) }) }));
    const result = await searchErpItemPickerAction({ query: '키링', page: 1 });
    expect(result).toMatchObject({ ok: true, data: { rows: [
      { code: 'ERP-A002', usedBy: { variantId: 'variant-g5', goodName: 'QA 키링', optionName: '기본 옵션', via: 'erpCode' } },
      { code: 'ERP-A003', usedBy: { variantId: 'variant-g7', goodName: 'QA 머그', optionName: '화이트', via: 'barcode' } },
      { code: 'ERP-A004' },
    ] } });
    expect(result.ok && 'usedBy' in result.data.rows[2]).toBe(false);
    /* 옵션 편집이 쓰는 조회를 그대로 쓴다. 글자 크기만 다른 값도 찾도록 원문·소문자·대문자를 함께 묻고, 바코드가 없는 품목은 바코드로 묻지 않는다. */
    expect(mocks.identities.mock.calls).toEqual([
      ['erp_code', ['ERP-A002', 'erp-a002', 'ERP-A003', 'erp-a003', 'ERP-A004', 'erp-a004'], { target_good_id: null }],
      ['barcode', ['8800000000021', '8800000000038'], { target_good_id: null }],
    ]);
    expect(mocks.from.mock.calls.map(([table]) => table).sort()).toEqual(['goods', 'goods_variants']);
  });

  it('쓰는 옵션이 없으면 이름 조회를 하지 않고, 확인하지 못하면 막지 않고 품목만 돌려준다(저장할 때의 검사는 그대로다)', async () => {
    mocks.rpc.mockResolvedValue(page(1, ['000123']));
    expect(await searchErpItemPickerAction({ query: '', page: 1 })).toMatchObject({ ok: true, data: { rows: [{ code: '000123' }] } });
    expect(mocks.from).not.toHaveBeenCalled();
    for (const failure of [async () => ({ data: null, error: { message: 'staff_required' } }), async () => { throw new Error('network'); }]) {
      mocks.identities.mockImplementation(failure);
      const result = await searchErpItemPickerAction({ query: '', page: 1 });
      expect(result).toEqual({ ok: true, data: { rows: [{ code: '000123', name: '품목 000123', category: '문구 > 키링', salePrice: 12000, barcode: '0880000000123', mappedCategoryId: null }], total: 1, page: 1, pageSize: 20 } });
    }
    /* 품목이 없는 쪽은 아무것도 묻지 않는다. */
    mocks.identities.mockClear(); mocks.rpc.mockResolvedValue(page(0, []));
    await searchErpItemPickerAction({ query: '없는 품목', page: 1 });
    expect(mocks.identities).not.toHaveBeenCalled();
  });
});
