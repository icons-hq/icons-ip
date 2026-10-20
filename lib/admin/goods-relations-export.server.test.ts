import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoodsRelation, GoodsRelationFilters } from './goods-relations';
import { buildGoodsRelationsWorkbook, loadGoodsRelationsExport } from './goods-relations-export.server';
const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('./goods-relations.server', () => ({ loadGoodsRelations: list }));
const filters: GoodsRelationFilters = { query: '테스트 & 상품', kind: 'together', state: 'all', page: 4, pageSize: 20 };
const row = (index = 1): GoodsRelation => ({
  id: `99030000-0000-4000-8000-${String(index).padStart(12, '0')}`, kind: 'together', title: `편성${index}`, representativeGoodId: 'g-2', enabled: true,
  startsAt: '2026-10-13T15:00:00.000Z', endsAt: null, revision: 2, createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z', state: 'active',
  goods: [{ id: 'g-1', name: '=1+1', code: '000100', imagePath: null, public: true }, { id: 'g-2', name: '두번째', code: '002', imagePath: null, public: false }], visual: null,
});
function resolveRows(rows: GoodsRelation[]) {
  list.mockImplementation(async (input: GoodsRelationFilters) => ({ filters: input, total: rows.length, rows: rows.slice((input.page - 1) * 100, input.page * 100) }));
}
beforeEach(() => { list.mockReset(); });
describe('연관상품 전체 파일 조회', () => {
  it('현재 화면 페이지와 무관하게 같은 조건의 201개를 두 번 읽는다', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => row(index + 1)); resolveRows(rows);
    const result = await loadGoodsRelationsExport(filters);
    expect(result.rows).toEqual(rows); expect(list).toHaveBeenCalledTimes(6);
    for (let index = 0; index < 6; index++) expect(list).toHaveBeenNthCalledWith(index + 1, { ...filters, page: index % 3 + 1, pageSize: 100 });
  });
  it('0개도 두 번 확인하고 빈 파일로 제공한다', async () => {
    resolveRows([]); expect((await loadGoodsRelationsExport(filters)).rows).toEqual([]); expect(list).toHaveBeenCalledTimes(2);
  });
  it('상한 초과를 첫 조회에서 거절한다', async () => {
    list.mockResolvedValue({ total: 2001, rows: [], filters: { ...filters, page: 1, pageSize: 100 } });
    await expect(loadGoodsRelationsExport(filters)).rejects.toMatchObject({ code: 'limit' }); expect(list).toHaveBeenCalledTimes(1);
  });
  it.each(['title', 'public', 'order', 'revision'] as const)('개수는 같아도 %s 변경을 거절한다', async kind => {
    const before = row(), after = structuredClone(before);
    if (kind === 'title') after.title = '변경';
    if (kind === 'public') after.goods[1].public = true;
    if (kind === 'order') after.goods.reverse();
    if (kind === 'revision') after.revision++;
    list.mockImplementationOnce(async input => ({ total: 1, rows: [before], filters: input }))
      .mockImplementationOnce(async input => ({ total: 1, rows: [after], filters: input }));
    await expect(loadGoodsRelationsExport(filters)).rejects.toMatchObject({ code: 'changed' });
  });
  it.each(['count', 'short', 'duplicate', 'clamped'] as const)('페이지 사이 %s 불일치에서는 부분 파일을 반환하지 않는다', async kind => {
    list.mockImplementationOnce(async input => ({ total: 101, rows: Array.from({ length: 100 }, (_, i) => row(i + 1)), filters: input }))
      .mockImplementationOnce(async input => ({ total: kind === 'count' ? 100 : 101, rows: kind === 'short' ? [] : [row(kind === 'duplicate' ? 1 : 101)], filters: kind === 'clamped' ? { ...input, page: 1 } : input }));
    await expect(loadGoodsRelationsExport(filters)).rejects.toMatchObject({ code: 'changed' });
  });
  it('중간 권한/조회 오류를 빈 행으로 대체하지 않는다', async () => {
    list.mockImplementationOnce(async input => ({ total: 1, rows: [row()], filters: input })).mockRejectedValueOnce(new Error('forbidden'));
    await expect(loadGoodsRelationsExport(filters)).rejects.toThrow('forbidden');
  });
});
describe('연관상품 XLSX 원문 검증', () => {
  it('다른 구성의 선택적 표시값은 문자열로 내보내고 대표 공개 예외를 설명한다', async () => {
    const saved = { ...row(), kind: 'other_composition' as const, goods: row().goods.map((good, i) => ({ ...good, compositionLabel: i === 0 ? '=2개 세트' : null })) };
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildGoodsRelationsWorkbook({ filters: { ...filters, kind: 'other_composition' }, rows: [saved], startedAt: '2026-10-15T00:00:00Z', verifiedAt: '2026-10-15T00:01:00Z' }) as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.worksheets[0].getCell('C2').value).toBe('다른 구성 상품');
    expect(book.worksheets[1].getCell('I1').value).toBe('구성 표시값');
    expect(book.worksheets[1].getCell('I2').value).toBe('=2개 세트');
    expect(book.worksheets[1].getCell('I2').type).toBe(ExcelJS.ValueType.String);
    expect(book.worksheets[1].getCell('I3').value).toBe('');
    expect(book.worksheets[2].getCell('B13').value).toContain('대표 상품의 공개 여부는 다른 구성의 노출을 제한하지 않습니다');
  });
  it('편성/구성/조건의 세 시트, 순서·문자열 코드·KST와 수식 아닌 원문을 유지한다', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildGoodsRelationsWorkbook({ filters, rows: [row()], startedAt: '2026-10-13T15:10:00Z', verifiedAt: '2026-10-13T15:11:00Z' }) as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.worksheets.map(sheet => [sheet.name, sheet.rowCount])).toEqual([['연관상품 편성', 2], ['구성 상품', 3], ['조회 정보', 14]]);
    const grouping = book.worksheets[0], members = book.worksheets[1], info = book.worksheets[2];
    expect(grouping.getCell('F2').value).toBe('g-2'); expect(grouping.getCell('G2').value).toBe('002');
    expect(grouping.getCell('K2').value).toContain('2026-10-14 00:00');
    expect(members.getCell('F2').value).toBe('000100'); expect(members.getCell('G2').value).toBe('=1+1'); expect(members.getCell('G2').type).toBe(ExcelJS.ValueType.String);
    expect(members.getCell('D3').value).toBe('대표'); expect(members.getCell('H3').value).toBe('불가');
    expect(info.getCell('B3').value).toBe(filters.query); expect(info.getCell('B4').value).toBe('함께 사면 좋은 상품');
    expect(info.getCell('B12').value).toContain('단일 DB 스냅샷은 아닙니다');
  });
  it('최대 2,000편성/20,000구성 행을 파일로 다시 읽어 끝 행까지 확인한다', async () => {
    const rows = Array.from({ length: 2000 }, (_, index) => ({ ...row(index + 1), kind: 'similar' as const, goods: Array.from({ length: 10 }, (_, member) => ({ id: `g-${member + 1}`, code: `00${member}`, name: `상품${member}`, imagePath: null, public: true })) }));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildGoodsRelationsWorkbook({ filters: { ...filters, kind: 'all' }, rows, startedAt: '2026-10-14T00:00:00Z', verifiedAt: '2026-10-14T00:01:00Z' }) as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.worksheets[0].rowCount).toBe(2001); expect(book.worksheets[1].rowCount).toBe(20001);
    expect(book.worksheets[1].getCell('A20001').value).toBe(rows.at(-1)!.id); expect(book.worksheets[1].getCell('F20001').value).toBe('009');
  });
});
