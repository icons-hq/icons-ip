import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  rows: vi.fn(),
  batch: vi.fn(),
}));
vi.mock('@/lib/admin/guard.server', () => ({
  requireAdminScreenAccess: mocks.guard,
}));
vi.mock('@/lib/admin/goods-import.server', () => ({
  loadGoodsExportWorkbook: mocks.rows,
  loadGoodsImportBatch: mocks.batch,
  goodsImportErrorMessage: () => '재고 변경',
}));
import { GET } from './route';
import { emptyGoodsWorkbookRow } from '@/lib/admin/goods-workbook';
import { parseGoodsWorkbook, parseGoodsWorkbookWithKc } from '@/lib/admin/goods-workbook-file';
import { emptyGoodsCustomInputWorkbookRow, GOODS_CUSTOM_INPUT_WORKBOOK_SHEET } from '@/lib/admin/goods-custom-input-workbook';
import { emptyGoodsAfterSalesWorkbookRow, emptyGoodsSizeWorkbookRow } from '@/lib/admin/goods-guidance-workbook';
const values = {
  ...emptyGoodsWorkbookRow(),
  name: '테스트 상품',
  ipId: 'ip',
  code: '0001',
  price: '0',
  stockQty: '0',
};
describe('downloadable goods XLSX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ user: { id: 'staff' } });
  });
  it('requires staff before export data is read', async () => {
    mocks.guard.mockRejectedValue(new Error('forbidden'));
    await expect(
      GET(new Request('http://localhost/api/admin/goods-workbook?mode=export')),
    ).rejects.toThrow('forbidden');
    expect(mocks.rows).not.toHaveBeenCalled();
  });
  it('exports each failed product’s original A/S and size rows with their stale revisions for correction', async () => {
    const afterSales = { ...emptyGoodsAfterSalesWorkbookRow(), goodCode: values.code, mode: '편집', phone: '02-123-4567', guide: '원본 안내', revision: '3' };
    const size = { ...emptyGoodsSizeWorkbookRow(), goodCode: values.code, mode: '표시 중지', revision: '7' };
    mocks.batch.mockResolvedValue({ plan: [
      { kind: 'update', source: [{ values }], errors: [], afterSalesSource: [{ row: 6, values: afterSales }], sizeSource: [{ row: 12, values: size }] },
      { kind: 'new', source: [{ values: { ...values, code: 'SUCCESS' } }], errors: [], afterSalesSource: [{ row: 7, values: { ...afterSales, goodCode: 'SUCCESS' } }] },
    ], results: { 0: { status: 'failed' }, 1: { status: 'success' } } });
    const response = await GET(new Request('http://localhost/api/admin/goods-workbook?mode=failures&batch=mine'));
    const parsed = await parseGoodsWorkbookWithKc(Buffer.from(await response.arrayBuffer()));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.afterSalesRows).toEqual([{ row: 5, values: afterSales, errors: [] }]);
    expect(parsed.sizeRows).toEqual([{ row: 5, values: size, errors: [] }]);
  });
  it('includes authorized guidance snapshots in regular exports', async () => {
    const afterSales = { ...emptyGoodsAfterSalesWorkbookRow(), goodCode: values.code, mode: '전체 해제', revision: '4' };
    const size = { ...emptyGoodsSizeWorkbookRow(), goodCode: values.code, mode: '표시 중지', revision: '8' };
    mocks.rows.mockResolvedValue({ rows: [values], kcRows: [], customInputRows: [], afterSalesRows: [afterSales], sizeRows: [size] });
    const response = await GET(new Request('http://localhost/api/admin/goods-workbook?mode=export&part=1'));
    expect(await parseGoodsWorkbookWithKc(Buffer.from(await response.arrayBuffer()))).toMatchObject({
      afterSalesRows: [{ values: afterSales }], sizeRows: [{ values: size }],
    });
  });
  it('returns a real formatted template attachment with private caching', async () => {
    const response = await GET(
      new Request('http://localhost/api/admin/goods-workbook?mode=template'),
    );
    expect(response.headers.get('content-disposition')).toContain(
      'icons-goods-template.xlsx',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
    expect(book.getWorksheet('상품')?.getCell('A4').text).toBe('상품코드');
    expect(book.getWorksheet('작성 안내')).toBeTruthy();
    expect(book.getWorksheet(GOODS_CUSTOM_INPUT_WORKBOOK_SHEET)?.getCell('G4').text).toBe('정의 버전');
  });
  it('실패 파일에는 실패 상품의 원본 직접입력 행·빈 새 ID·오래된 버전만 남긴다', async () => {
    const failedCustom = { ...emptyGoodsCustomInputWorkbookRow(), goodCode: values.code, mode: '편집', enabled: '예',
      name: 'TEST 새 문구', action: '사용', revision: '3' };
    mocks.batch.mockResolvedValue({
      plan: [
        { kind: 'update', source: [{ values }], errors: [], customInputSource: [{ row: 5, values: failedCustom }] },
        { kind: 'new', source: [{ values: { ...values, code: 'SUCCESS' } }], errors: [],
          customInputSource: [{ row: 6, values: { ...failedCustom, goodCode: 'SUCCESS', name: 'TEST 성공 문구' } }] },
      ],
      results: { 0: { status: 'failed' }, 1: { status: 'success' } },
    });
    const response = await GET(new Request('http://localhost/api/admin/goods-workbook?mode=failures&batch=mine'));
    const parsed = await parseGoodsWorkbookWithKc(Buffer.from(await response.arrayBuffer()));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.customInputRows).toEqual([{ row: 5, values: failedCustom, errors: [] }]);
  });
  it('일반 내보내기는 조회한 직접입력 정의의 ID와 사용 중지 상태를 유지한다', async () => {
    const custom = { ...emptyGoodsCustomInputWorkbookRow(), goodCode: values.code, mode: '편집', enabled: '아니오',
      fieldId: '00000000-0000-4000-8000-000000010001', name: 'TEST 문구', action: '중지', revision: '9' };
    mocks.rows.mockResolvedValue({ rows: [values], kcRows: [], customInputRows: [custom] });
    const response = await GET(new Request('http://localhost/api/admin/goods-workbook?mode=export&part=1'));
    expect((await parseGoodsWorkbookWithKc(Buffer.from(await response.arrayBuffer()))).customInputRows).toEqual([{ row: 5, values: custom, errors: [] }]);
  });
  it('exports the exact filters and produces re-uploadable values', async () => {
    mocks.rows.mockResolvedValue({ rows: [values], kcRows: [] });
    const response = await GET(
      new Request(
        'http://localhost/api/admin/goods-workbook?mode=export&q=CODE&ipId=ip&status=draft&stock=low&categoryId=00000000-0000-4000-8000-000000000001&readiness=kc_required&part=2',
      ),
    );
    expect(mocks.rows).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'CODE', ipId: 'ip', status: 'draft', stock: 'low', page: 1, categoryId: '00000000-0000-4000-8000-000000000001', readiness: 'kc_required' }),
      2,
    );
    expect(
      (await parseGoodsWorkbook(Buffer.from(await response.arrayBuffer())))[0]
        .values,
    ).toEqual(values);
  });
  it('includes every option row from failed products while excluding successes', async () => {
    mocks.batch.mockResolvedValue({
      plan: [
        { kind: 'update', source: [{ values }, { values }], errors: [] },
        { kind: 'new', source: [{ values }], errors: [] },
      ],
      results: { 0: { status: 'failed' }, 1: { status: 'success' } },
    });
    const response = await GET(
      new Request(
        'http://localhost/api/admin/goods-workbook?mode=failures&batch=mine',
      ),
    );
    expect(mocks.batch).toHaveBeenCalledWith('mine', 'staff');
    expect(
      await parseGoodsWorkbook(Buffer.from(await response.arrayBuffer())),
    ).toHaveLength(2);
  });
});
