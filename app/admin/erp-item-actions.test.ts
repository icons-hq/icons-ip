const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn(), range: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) throw error; },
}));

import {
  commitErpLinkedGoodsAction,
  deleteErpItemsAction,
  importErpItemsAction,
  previewErpLinkedGoodsAction,
  readErpItemFileAction,
  searchErpItemsAction,
  setErpCategoryMappingAction,
  setErpCategoryMappingsAction,
} from './erp-item-actions';

const staff = { isConfigured: true, user: { id: 'staff', email: null }, role: 'staff', isStaff: true, operatorAccess: legacyOperatorAccessFixture() };
/* 1027T-016: 부매니저(MD)는 상품 관리 권한으로 ERP 품목을 읽고 반입한다. 삭제 권한(platform.manage)은 없다. */
const deputy = { isConfigured: true, user: { id: 'deputy', email: null }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('deputy') };
const logistics = { isConfigured: true, user: { id: 'logistics', email: null }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture('logistics') };
const member = { isConfigured: true, user: { id: 'member', email: null }, role: 'user', isStaff: false };
const signedOut = { isConfigured: true, user: null, role: null, isStaff: false };
const CATEGORY_ID = '00000000-0000-4000-8000-000000071111';
const loginRedirect = 'NEXT_REDIRECT:/login?next=%2Fadmin%2Fcatalog%2Ferp-items';

function fileForm(name: string, content: string | Uint8Array<ArrayBuffer>) {
  const form = new FormData();
  form.set('file', new File([content], name));
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(staff);
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
});

describe('ERP 품목 제안 검색', () => {
  it('운영자가 아니면 DB에 닿지 않고, 세션이 끝나도 상품 편집 화면을 로그인으로 옮기지 않는다', async () => {
    for (const auth of [member, signedOut]) {
      mocks.auth.mockResolvedValue(auth);
      expect(await searchErpItemsAction('키링')).toEqual({ ok: false, error: 'ERP 품목은 운영자만 관리할 수 있습니다.' });
    }
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('2자 미만이면 검색하지 않고 빈 결과를 준다', async () => {
    expect(await searchErpItemsAction(' 키 ')).toEqual({ ok: true, items: [] });
    expect(await searchErpItemsAction(42)).toEqual({ ok: true, items: [] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('정리한 검색어와 제안 상한으로 RPC를 부르고, 형식이 다른 행은 버린다', async () => {
    mocks.rpc.mockResolvedValue({ data: [
      { code: '000123', name: '아크릴 키링', category: '문구 > 키링', sale_price: 12000, barcode: '0088', mapped_category_id: CATEGORY_ID },
      { code: '', name: '깨진 행' },
    ], error: null });
    expect(await searchErpItemsAction('  아크릴\n키링 ')).toEqual({ ok: true, items: [
      { code: '000123', name: '아크릴 키링', category: '문구 > 키링', salePrice: 12000, barcode: '0088', mappedCategoryId: CATEGORY_ID },
    ] });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_erp_items', { p_query: '아크릴 키링', p_limit: 8 });
  });

  it('검색 오류와 연결 예외는 조용한 실패 결과로 돌려준다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'private' } });
    expect(await searchErpItemsAction('키링')).toEqual({ ok: false, error: 'ERP 품목을 불러오지 못했습니다.' });
    mocks.rpc.mockRejectedValueOnce(new Error('network details'));
    expect(await searchErpItemsAction('키링')).toEqual({ ok: false, error: 'ERP 품목을 불러오지 못했습니다.' });
  });
});

describe('ERP 품목 파일 읽기', () => {
  it('미로그인은 ERP 품목 화면으로 복귀하게 하고, 일반 회원은 폼 오류를 받는다', async () => {
    mocks.auth.mockResolvedValue(signedOut);
    await expect(readErpItemFileAction(fileForm('items.csv', 'a'))).rejects.toThrow(loginRedirect);
    mocks.auth.mockResolvedValue(member);
    expect(await readErpItemFileAction(fileForm('items.csv', 'a'))).toEqual({ ok: false, error: 'ERP 품목은 운영자만 관리할 수 있습니다.' });
  });

  it('파일 형식·크기를 먼저 확인한다', async () => {
    expect(await readErpItemFileAction(new FormData())).toMatchObject({ ok: false, error: '반입할 파일을 선택해주세요.' });
    expect(await readErpItemFileAction(fileForm('items.xls', 'a'))).toMatchObject({ ok: false, error: expect.stringContaining('XLSX로 다시 저장') });
    expect(await readErpItemFileAction(fileForm('items.pdf', 'a'))).toMatchObject({ ok: false, error: 'XLSX 또는 CSV 파일을 올려주세요.' });
    expect(await readErpItemFileAction(fileForm('items.csv', new Uint8Array(900 * 1024 + 1)))).toMatchObject({ ok: false, error: expect.stringContaining('900KB') });
  });

  it('CSV를 문자열 표로 읽어 돌려준다', async () => {
    expect(await readErpItemFileAction(fileForm('품목.csv', '품번,품명\n000123,"키링, 세트"\n'))).toEqual({
      ok: true, fileName: '품목.csv', sheetName: null, numericColumns: [], warnings: [],
      table: [['품번', '품명'], ['000123', '키링, 세트']],
    });
  });

  it('글자로 읽을 수 없는 텍스트 파일은 CSV UTF-8로 다시 저장하라고 안내한다', async () => {
    expect(await readErpItemFileAction(fileForm('items.txt', new Uint8Array([0x41, ...Array.from({ length: 40 }, () => 0xff)])))).toEqual({
      ok: false, error: "파일의 글자를 읽지 못했습니다. 엑셀에서 'CSV UTF-8(쉼표로 분리)'로 저장하거나 XLSX로 올려 주세요.",
    });
  });

  it('XLSX가 깨졌으면 한국어 안내만 돌려준다', async () => {
    expect(await readErpItemFileAction(fileForm('items.xlsx', 'not a zip'))).toEqual({ ok: false, error: 'ZIP 형식을 읽을 수 없습니다.' });
  });
});

describe('ERP 품목 반입', () => {
  it('미로그인·일반 회원·잘못된 묶음은 DB에 닿지 않는다', async () => {
    mocks.auth.mockResolvedValue(signedOut);
    await expect(importErpItemsAction([])).rejects.toThrow(loginRedirect);
    mocks.auth.mockResolvedValue(member);
    expect(await importErpItemsAction([{ code: 'A', name: 'B' }])).toMatchObject({ ok: false });
    mocks.auth.mockResolvedValue(staff);
    for (const value of [null, [], Array.from({ length: 501 }, () => ({ code: 'A', name: 'B' }))]) {
      expect(await importErpItemsAction(value)).toMatchObject({ ok: false });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('행을 다시 검증해 지정한 열만 보내고, 화면 거부와 DB 거부를 행 순서로 합친다', async () => {
    mocks.rpc.mockResolvedValue({ data: { inserted: 1, updated: 0, unchanged: 0, rejected: [{ row: 2, code: 'B', reason: 'duplicate_code' }, { row: 9, code: 'Z', reason: 'mystery' }] }, error: null });
    const result = await importErpItemsAction([
      { row: 4, code: ' 000123 ', name: '키링', salePrice: 12000, barcode: '0088' },
      { row: 3, code: '', name: '빈 코드' },
      { row: 2, code: 'B', name: '중복' },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_import_erp_items', { p_rows: [
      { row: 4, code: '000123', name: '키링', sale_price: 12000, barcode: '0088' },
      { row: 2, code: 'B', name: '중복' },
    ] });
    expect(result).toEqual({ ok: true, inserted: 1, updated: 0, unchanged: 0, rejected: [
      { row: 2, code: 'B', reason: 'duplicate_code' },
      { row: 3, code: '', reason: 'missing_code' },
      { row: 9, code: 'Z', reason: 'invalid_row' },
    ] });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/erp-items');
  });

  it('모든 행이 화면 검증에서 거부되면 RPC를 부르지 않는다', async () => {
    expect(await importErpItemsAction([{ row: 2, code: 'A', name: '' }])).toEqual({ ok: true, inserted: 0, updated: 0, unchanged: 0, rejected: [{ row: 2, code: 'A', reason: 'missing_name' }] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('권한·상한·결과 형식 오류를 안내 문구로 바꾼다', async () => {
    const rows = [{ code: 'A', name: 'B' }];
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'staff_required' } });
    expect(await importErpItemsAction(rows)).toEqual({ ok: false, error: 'ERP 품목은 운영자만 관리할 수 있습니다.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid_erp_item_rows' } });
    expect(await importErpItemsAction(rows)).toEqual({ ok: false, error: '한 번에 5,000행까지 반입할 수 있습니다.' });
    mocks.rpc.mockResolvedValueOnce({ data: { inserted: 'x' }, error: null });
    expect(await importErpItemsAction(rows)).toMatchObject({ ok: false, error: expect.stringContaining('반입 결과를 확인하지 못했습니다') });
    mocks.rpc.mockRejectedValueOnce(new Error('socket'));
    expect(await importErpItemsAction(rows)).toMatchObject({ ok: false, error: expect.stringContaining('다시 반입하면 이어서 반영됩니다') });
  });
});

describe('ERP 분류 연결', () => {
  it('미로그인·일반 회원·잘못된 입력은 DB에 닿지 않는다', async () => {
    mocks.auth.mockResolvedValue(signedOut);
    await expect(setErpCategoryMappingAction({ erpCategory: '문구', categoryId: CATEGORY_ID })).rejects.toThrow(loginRedirect);
    mocks.auth.mockResolvedValue(member);
    expect(await setErpCategoryMappingAction({ erpCategory: '문구', categoryId: CATEGORY_ID })).toMatchObject({ ok: false });
    mocks.auth.mockResolvedValue(staff);
    expect(await setErpCategoryMappingAction({ erpCategory: '  ', categoryId: CATEGORY_ID })).toEqual({ ok: false, error: 'ERP 분류 이름을 확인해주세요.' });
    expect(await setErpCategoryMappingAction({ erpCategory: '문구', categoryId: 'leaf' })).toEqual({ ok: false, error: '연결할 고객 카테고리를 다시 골라주세요.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('연결·해제·같은 연결을 구분해 안내한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { changed: true }, error: null });
    expect(await setErpCategoryMappingAction({ erpCategory: ' 문구 > 키링 ', categoryId: CATEGORY_ID }))
      .toEqual({ ok: true, changed: true, categoryId: CATEGORY_ID, message: 'ERP 분류를 고객 카테고리에 연결했습니다.' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_set_erp_category_mapping', { p_erp_category: '문구 > 키링', p_category_id: CATEGORY_ID });
    mocks.rpc.mockResolvedValueOnce({ data: { changed: true }, error: null });
    expect(await setErpCategoryMappingAction({ erpCategory: '문구 > 키링', categoryId: '' }))
      .toMatchObject({ ok: true, categoryId: null, message: 'ERP 분류 연결을 해제했습니다.' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_set_erp_category_mapping', { p_erp_category: '문구 > 키링', p_category_id: null });
    mocks.rpc.mockResolvedValueOnce({ data: { changed: false }, error: null });
    expect(await setErpCategoryMappingAction({ erpCategory: '문구 > 키링', categoryId: null })).toMatchObject({ ok: true, changed: false, message: '이미 같은 연결입니다.' });
    expect(mocks.revalidate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['category_archived', '보관된 카테고리에는 연결할 수 없습니다.'],
    ['category_not_leaf', '하위 카테고리가 있는 분류에는 연결할 수 없습니다. 마지막 단계 카테고리를 골라주세요.'],
    ['category_not_found', '카테고리를 찾지 못했습니다. 새로고침한 뒤 다시 골라주세요.'],
    ['staff_required', 'ERP 품목은 운영자만 관리할 수 있습니다.'],
    ['other', 'ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.'],
  ])('DB 거절 %s 를 안내 문구로 바꾼다', async (message, expected) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message } });
    expect(await setErpCategoryMappingAction({ erpCategory: '문구', categoryId: CATEGORY_ID })).toEqual({ ok: false, error: expected });
  });
});

describe('ERP 분류 일괄 연결', () => {
  const entries = [{ erpCategory: ' 문구 >  키링 ', categoryId: CATEGORY_ID }, { erpCategory: '문구', categoryId: null }];

  it('미로그인·일반 회원·잘못된 묶음은 DB에 닿지 않는다', async () => {
    mocks.auth.mockResolvedValue(signedOut);
    await expect(setErpCategoryMappingsAction(entries)).rejects.toThrow(loginRedirect);
    mocks.auth.mockResolvedValue(member);
    expect(await setErpCategoryMappingsAction(entries)).toEqual({ ok: false, error: 'ERP 품목은 운영자만 관리할 수 있습니다.' });
    mocks.auth.mockResolvedValue(staff);
    const invalid = '연결할 ERP 분류를 다시 골라주세요. 한 번에 500개까지 저장할 수 있습니다.';
    for (const value of [null, 'x', [], [null], [{ erpCategory: 7, categoryId: null }], [{ erpCategory: '  ', categoryId: null }], [{ erpCategory: 'x'.repeat(201), categoryId: null }], [{ erpCategory: '문구', categoryId: 'leaf' }], [{ erpCategory: '문구' }], Array.from({ length: 501 }, (_, index) => ({ erpCategory: `분류 ${index}`, categoryId: null }))]) {
      expect(await setErpCategoryMappingsAction(value)).toEqual({ ok: false, error: invalid });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('정리한 이름과 카테고리로 RPC를 부르고, 저장·같음·거절 건수를 안내한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { changed: 1, unchanged: 0, rejected: [{ index: 1, reason: 'category_archived', erp_category: '문구' }] }, error: null });
    expect(await setErpCategoryMappingsAction(entries)).toEqual({
      ok: true, changed: 1, unchanged: 0,
      rejected: [{ erpCategory: '문구', error: '보관된 카테고리에는 연결할 수 없습니다.' }],
      message: 'ERP 분류 1건의 연결을 저장했습니다. 1건은 저장하지 못했습니다. 표에서 사유를 확인해주세요.',
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_set_erp_category_mappings', { p_entries: [{ erp_category: '문구 > 키링', category_id: CATEGORY_ID }, { erp_category: '문구', category_id: null }] });
    expect(mocks.revalidate).toHaveBeenCalledOnce();
  });

  it('거절 행은 화면이 보낸 원래 이름으로 돌려주어 정리 전 행을 찾게 한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { changed: 0, unchanged: 0, rejected: [{ index: 0, reason: 'category_not_leaf' }] }, error: null });
    expect(await setErpCategoryMappingsAction(entries.slice(0, 1))).toMatchObject({ ok: true, rejected: [{ erpCategory: ' 문구 >  키링 ' }] });
  });

  it('바뀐 행이 없으면 다시 그리지 않고, 해제만 있으면 해제라고 말한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { changed: 0, unchanged: 2, rejected: [] }, error: null });
    expect(await setErpCategoryMappingsAction(entries)).toMatchObject({ ok: true, changed: 0, message: '2건은 이미 같은 연결입니다.' });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: { changed: 1, unchanged: 0, rejected: [] }, error: null });
    expect(await setErpCategoryMappingsAction([{ erpCategory: '문구', categoryId: null }])).toMatchObject({ ok: true, message: 'ERP 분류 1건의 연결을 해제했습니다.' });
  });

  it('권한·결과 형식·연결 오류를 안내 문구로 바꾼다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'staff_required' } });
    expect(await setErpCategoryMappingsAction(entries)).toEqual({ ok: false, error: 'ERP 품목은 운영자만 관리할 수 있습니다.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'boom' } });
    expect(await setErpCategoryMappingsAction(entries)).toEqual({ ok: false, error: 'ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: { changed: 'x' }, error: null });
    expect(await setErpCategoryMappingsAction(entries)).toEqual({ ok: false, error: '저장 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해주세요.' });
    expect(mocks.revalidate).toHaveBeenCalledOnce();
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await setErpCategoryMappingsAction(entries)).toEqual({ ok: false, error: 'ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.' });
  });
});

describe('ERP 품목 삭제', () => {
  it('미로그인·일반 회원·잘못된 선택은 DB에 닿지 않는다', async () => {
    mocks.auth.mockResolvedValue(signedOut);
    await expect(deleteErpItemsAction(['000123'])).rejects.toThrow(loginRedirect);
    mocks.auth.mockResolvedValue(member);
    expect(await deleteErpItemsAction(['000123'])).toEqual({ ok: false, error: 'ERP 품목은 운영자만 관리할 수 있습니다.' });
    mocks.auth.mockResolvedValue(staff);
    for (const value of [null, [], [''], [42], ['A'.repeat(121)], Array.from({ length: 501 }, (_, index) => `C${index}`)]) {
      expect(await deleteErpItemsAction(value)).toMatchObject({ ok: false, error: expect.stringContaining('지울 ERP 품목') });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('고른 ERP 코드를 중복 없이 그대로 보내고, 지운 건수와 이미 없던 건수를 안내한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { requested: 2, deleted: 2, missing: 0 }, error: null });
    expect(await deleteErpItemsAction(['000123', 'K-2', '000123'])).toEqual({ ok: true, deleted: 2, missing: 0, message: 'ERP 품목 2건을 지웠습니다.' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_delete_erp_items', { p_codes: ['000123', 'K-2'] });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/erp-items');
    mocks.rpc.mockResolvedValueOnce({ data: { requested: 2, deleted: 1, missing: 1 }, error: null });
    expect(await deleteErpItemsAction([' 000123 ', 'GONE'])).toMatchObject({ ok: true, deleted: 1, missing: 1, message: 'ERP 품목 1건을 지웠습니다. 1건은 이미 지워진 품목입니다.' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_delete_erp_items', { p_codes: [' 000123 ', 'GONE'] });
  });

  it('권한·결과 형식·연결 오류를 안내 문구로 바꾼다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'staff_required' } });
    expect(await deleteErpItemsAction(['A'])).toEqual({ ok: false, error: 'ERP 품목 삭제는 계정 주매니저·통합 매니저만 할 수 있습니다.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'private' } });
    expect(await deleteErpItemsAction(['A'])).toEqual({ ok: false, error: 'ERP 품목을 지우지 못했습니다. 다시 시도해주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: { deleted: 'x' }, error: null });
    expect(await deleteErpItemsAction(['A'])).toEqual({ ok: false, error: '삭제 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해주세요.' });
    mocks.rpc.mockRejectedValueOnce(new Error('socket'));
    expect(await deleteErpItemsAction(['A'])).toEqual({ ok: false, error: 'ERP 품목을 지우지 못했습니다. 다시 시도해주세요.' });
  });
});

describe('MD 반입 권한(1027T-016)', () => {
  it('부매니저는 제안 검색·반입·분류 연결을 하고, 품목 삭제는 DB에 닿기 전에 막힌다', async () => {
    mocks.auth.mockResolvedValue(deputy);
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await searchErpItemsAction('키링')).toEqual({ ok: true, items: [] });
    mocks.rpc.mockResolvedValueOnce({ data: { inserted: 1, updated: 0, unchanged: 0, rejected: [] }, error: null });
    expect(await importErpItemsAction([{ row: 2, code: '000123', name: '아크릴 키링' }])).toMatchObject({ ok: true, inserted: 1 });
    mocks.rpc.mockResolvedValueOnce({ data: { changed: true }, error: null });
    expect(await setErpCategoryMappingAction({ erpCategory: '문구 > 키링', categoryId: CATEGORY_ID })).toMatchObject({ ok: true, changed: true });
    mocks.rpc.mockClear();
    expect(await deleteErpItemsAction(['000123'])).toEqual({ ok: false, error: 'ERP 품목 삭제는 계정 주매니저·통합 매니저만 할 수 있습니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('상품 관리 권한이 없는 물류출고관리는 읽기·반입·비교를 못 한다', async () => {
    mocks.auth.mockResolvedValue(logistics);
    expect(await searchErpItemsAction('키링')).toEqual({ ok: false, error: 'ERP 품목은 운영자만 관리할 수 있습니다.' });
    expect(await importErpItemsAction([{ row: 2, code: '000123', name: '아크릴 키링' }])).toEqual({ ok: false, error: 'ERP 품목은 운영자만 관리할 수 있습니다.' });
    expect(await previewErpLinkedGoodsAction(null)).toEqual({ ok: false, error: 'ERP 품목은 운영자만 관리할 수 있습니다.' });
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

const VARIANT = '00000000-0000-4000-8000-000000071201';
const OPERATION = '00000000-0000-4000-8000-000000071301';
const previewRow = (field: 'price' | 'barcode', extra: Record<string, unknown> = {}) => ({
  key: `${VARIANT}:${field}`, field, goodId: 'erp-good', goodName: '아크릴 키링', goodCode: 'G-1', published: true,
  variantId: VARIANT, optionName: '기본 옵션', isDefault: true, erpCode: '000123', erpName: '아크릴 키링',
  current: field === 'price' ? 10000 : null, next: field === 'price' ? 11000 : '8801234567890',
  status: 'apply', reason: null, warning: null, ...extra,
});
const previewData = (rows: unknown[] = [previewRow('price'), previewRow('barcode')]) => ({
  operationId: OPERATION, expiresAt: '2026-11-13T01:15:00Z', scopeCount: 2, linked: 3, total: rows.length, truncated: false, rows,
});

describe('연결 상품 반영 미리보기(1027T-X04)', () => {
  it('방금 반입한 ERP 코드만 중복 없이 보내고, 새 operation id로 미리보기를 받는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: previewData(), error: null });
    const result = await previewErpLinkedGoodsAction(['000123', 'K-2', '000123']);
    expect(result).toMatchObject({ ok: true, preview: { operationId: OPERATION, linked: 3, total: 2 } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_preview_erp_linked_goods', { p_operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/), p_codes: ['000123', 'K-2'] });
    mocks.rpc.mockResolvedValueOnce({ data: previewData([]), error: null });
    expect(await previewErpLinkedGoodsAction(null)).toMatchObject({ ok: true, preview: { total: 0, rows: [] } });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_preview_erp_linked_goods', expect.objectContaining({ p_codes: null }));
  });

  it('잘못된 범위·권한·결과 형식은 비교 실패로 알린다', async () => {
    for (const value of [[], [''], [42], ['A'.repeat(121)], Array.from({ length: 5001 }, (_, index) => `C${index}`)]) {
      expect(await previewErpLinkedGoodsAction(value)).toMatchObject({ ok: false, error: expect.stringContaining('비교할 ERP 품목') });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'operator_capability_required' } });
    expect(await previewErpLinkedGoodsAction(null)).toEqual({ ok: false, error: 'ERP 품목은 운영자만 관리할 수 있습니다.' });
    /* 건너뛰는 행인데 사유가 없으면 형식이 깨진 결과다. 반영 버튼을 열지 않는다. */
    mocks.rpc.mockResolvedValueOnce({ data: previewData([previewRow('price', { status: 'skip', reason: null })]), error: null });
    expect(await previewErpLinkedGoodsAction(null)).toEqual({ ok: false, error: '연결 상품과 비교하지 못했습니다. 다시 시도해주세요.' });
    mocks.rpc.mockRejectedValueOnce(new Error('socket'));
    expect(await previewErpLinkedGoodsAction(null)).toEqual({ ok: false, error: '연결 상품과 비교하지 못했습니다. 다시 시도해주세요.' });
  });
});

describe('연결 상품 반영 확정(1027T-X04)', () => {
  it('고른 행 키만 보내고, 반영했으면 ERP 화면과 상품 화면을 다시 그린다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { state: 'completed', operationId: OPERATION, applied: { price: 1, barcode: 1, goods: 1 }, failed: [] }, error: null });
    const result = await commitErpLinkedGoodsAction({ operationId: OPERATION, keys: [`${VARIANT}:price`, `${VARIANT}:barcode`, `${VARIANT}:price`] });
    expect(result).toEqual({ ok: true, receipt: expect.objectContaining({ state: 'completed' }), message: '상품 1개에 판매가 1건·바코드 1건을 반영했습니다.' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_commit_erp_linked_goods', { p_operation_id: OPERATION, p_keys: [`${VARIANT}:price`, `${VARIANT}:barcode`] });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/erp-items');
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/goods');
  });

  it('바뀐 미리보기·막힌 상품·일부만 고른 판매가를 운영자 문구로 알린다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { state: 'rejected', operationId: OPERATION, error: 'erp_goods_apply_changed' }, error: null });
    expect(await commitErpLinkedGoodsAction({ operationId: OPERATION, keys: [`${VARIANT}:price`] })).toMatchObject({
      ok: true, message: '미리보기 뒤 상품이나 ERP 값이 바뀌어 아무것도 반영하지 않았습니다. 다시 비교해주세요.' });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: { state: 'completed', operationId: OPERATION, applied: { price: 0, barcode: 0, goods: 0 },
      failed: [{ key: `${VARIANT}:price`, field: 'price', goodId: 'erp-good', goodName: '아크릴 키링', optionName: '기본 옵션', error: 'goods_notice_required' }] }, error: null });
    expect(await commitErpLinkedGoodsAction({ operationId: OPERATION, keys: [`${VARIANT}:price`] })).toMatchObject({
      ok: true, message: '1건은 상품 저장 규칙에 막혀 반영하지 못했습니다. 아래 사유를 확인해주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'erp_goods_apply_partial_price', details: '아크릴 키링' } });
    expect(await commitErpLinkedGoodsAction({ operationId: OPERATION, keys: [`${VARIANT}:price`] })).toEqual({
      ok: false, error: '같은 상품(‘아크릴 키링’)의 판매가 행을 일부만 고르면 옵션 판매 금액이 상품 판매가보다 낮아집니다. 그 상품의 판매가 행을 함께 고르거나 함께 빼 주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'erp_goods_apply_busy' } });
    expect(await commitErpLinkedGoodsAction({ operationId: OPERATION, keys: [`${VARIANT}:price`] })).toEqual({ ok: false, error: '다른 작업이 같은 상품을 저장하고 있습니다. 잠시 뒤 다시 반영해주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'erp_goods_apply_unavailable' } });
    expect(await commitErpLinkedGoodsAction({ operationId: OPERATION, keys: [`${VARIANT}:price`] })).toEqual({ ok: false, error: '이 미리보기를 찾을 수 없습니다. 다시 비교해주세요.' });
  });

  it('잘못된 operation·키는 DB에 닿지 않고, 결과를 못 받으면 같은 미리보기로 다시 반영하라고 한다', async () => {
    for (const input of [{ operationId: 'nope', keys: [`${VARIANT}:price`] }, { operationId: OPERATION, keys: [] }, { operationId: OPERATION, keys: ['x:price'] },
      { operationId: OPERATION, keys: [`${VARIANT}:stock`] },
      { operationId: OPERATION, keys: Array.from({ length: 501 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}:price`) }]) {
      expect(await commitErpLinkedGoodsAction(input)).toEqual({ ok: false, error: '반영할 행을 다시 골라주세요.' });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockRejectedValueOnce(new Error('socket'));
    expect(await commitErpLinkedGoodsAction({ operationId: OPERATION, keys: [`${VARIANT}:price`] })).toEqual({
      ok: false, error: '반영 결과를 확인하지 못했습니다. 같은 미리보기에서 다시 반영하면 이미 반영한 행은 다시 바꾸지 않습니다.' });
  });
});
