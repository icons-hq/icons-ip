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
  loadGoodsExportRows: mocks.rows,
  loadGoodsImportBatch: mocks.batch,
  goodsImportErrorMessage: () => '재고 변경',
}));
import { GET } from './route';
import { emptyGoodsWorkbookRow } from '@/lib/admin/goods-workbook';
import { parseGoodsWorkbook } from '@/lib/admin/goods-workbook-file';
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
  });
  it('exports the exact filters and produces re-uploadable values', async () => {
    mocks.rows.mockResolvedValue([values]);
    const response = await GET(
      new Request(
        'http://localhost/api/admin/goods-workbook?mode=export&q=CODE&ipId=ip&status=draft&stock=low&part=2',
      ),
    );
    expect(mocks.rows).toHaveBeenCalledWith(
      { query: 'CODE', ipId: 'ip', status: 'draft', stock: 'low', page: 1 },
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
