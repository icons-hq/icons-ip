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
  importErpItemsAction,
  readErpItemFileAction,
  searchErpItemsAction,
  setErpCategoryMappingAction,
} from './erp-item-actions';

const staff = { isConfigured: true, user: { id: 'staff', email: null }, role: 'staff', isStaff: true };
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
      ok: false, error: '파일의 글자를 읽지 못했습니다. 엑셀에서 CSV UTF-8(쉼표로 분리)로 저장해 다시 올려주세요.',
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
    ['category_not_leaf', '하위 카테고리가 있는 분류에는 연결할 수 없습니다. 말단 카테고리를 골라주세요.'],
    ['category_not_found', '카테고리를 찾지 못했습니다. 새로고침한 뒤 다시 골라주세요.'],
    ['staff_required', 'ERP 품목은 운영자만 관리할 수 있습니다.'],
    ['other', 'ERP 분류 연결을 저장하지 못했습니다. 다시 시도해주세요.'],
  ])('DB 거절 %s 를 안내 문구로 바꾼다', async (message, expected) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message } });
    expect(await setErpCategoryMappingAction({ erpCategory: '문구', categoryId: CATEGORY_ID })).toEqual({ ok: false, error: expected });
  });
});
