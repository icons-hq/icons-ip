import 'server-only';
import ExcelJS from 'exceljs';
import { loadGoodsRelations } from './goods-relations.server';
import { GOODS_RELATION_KINDS, type GoodsRelation, type GoodsRelationFilters } from './goods-relations';
import { GOODS_RELATIONS_EXPORT_LIMIT, goodsRelationKindLabel, goodsRelationStateLabel, type GoodsRelationsExport } from './goods-relations-export';
import { kstDateTimeText } from './list-export';

export class GoodsRelationsExportError extends Error {
  constructor(readonly code: 'limit' | 'changed') {
    super(code === 'limit' ? `최대 ${GOODS_RELATIONS_EXPORT_LIMIT.toLocaleString('ko-KR')}개 편성을 받을 수 있습니다. 검색 조건을 좁혀주세요.` : '내려받는 동안 편성이나 상품 정보가 변경됐습니다. 다시 조회한 뒤 내려받아 주세요.');
  }
}

/** Read every matching page twice. This is a change check, not a retained DB snapshot. */
export async function loadGoodsRelationsExport(filters: GoodsRelationFilters): Promise<GoodsRelationsExport> {
  const startedAt = new Date().toISOString();
  async function collect() {
    const rows: GoodsRelation[] = [];
    const seen = new Set<string>();
    let total: number | null = null;
    for (let page = 1; ; page++) {
      const result = await loadGoodsRelations({ ...filters, page, pageSize: 100 });
      if (result.total > GOODS_RELATIONS_EXPORT_LIMIT) throw new GoodsRelationsExportError('limit');
      total ??= result.total;
      const expectedLength = Math.min(100, Math.max(0, total - (page - 1) * 100));
      if (result.total !== total || result.filters.page !== page || result.filters.pageSize !== 100
        || result.rows.length !== expectedLength || result.rows.some(row => seen.has(row.id))) throw new GoodsRelationsExportError('changed');
      for (const row of result.rows) {
        if (seen.has(row.id)) throw new GoodsRelationsExportError('changed');
        seen.add(row.id); rows.push(row);
      }
      if (rows.length === total) return rows;
    }
  }
  const first = await collect(), second = await collect();
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new GoodsRelationsExportError('changed');
  return { filters, rows: second, startedAt, verifiedAt: new Date().toISOString() };
}

export async function buildGoodsRelationsWorkbook(snapshot: GoodsRelationsExport) {
  const book = new ExcelJS.Workbook();
  const includesOtherComposition = snapshot.filters.kind === 'other_composition' || snapshot.rows.some(row => row.kind === 'other_composition');
  book.creator = 'ICONS'; book.created = new Date(snapshot.verifiedAt);
  function sheet(name: string, headers: string[], values: (string | number)[][]) {
    const page = book.addWorksheet(name);
    page.columns = headers.map(header => ({ header, width: /ID|번호/.test(header) ? 38 : /제목|상품명|내용/.test(header) ? 36 : 23 }));
    page.views = [{ state: 'frozen', ySplit: 1 }];
    page.getRow(1).font = { name: '맑은 고딕', bold: true, size: 11 };
    page.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF2EC' } };
    for (const value of values) page.addRow(value).eachCell(cell => { cell.numFmt = typeof cell.value === 'number' ? '#,##0' : '@'; });
    page.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, page.rowCount), column: headers.length } };
  }
  sheet('연관상품 편성', ['편성 ID', '노출 제목', '유형', '전시상태', '전시 사용', '대표 상품번호', '대표 상품코드', '대표 상품명', '구성 상품수', '공개 상품수', '시작 (KST)', '종료 (KST)', '등록 (KST)', '수정 (KST)', '편성 버전'], snapshot.rows.map(row => {
    const representative = row.goods.find(good => good.id === row.representativeGoodId)!;
    return [row.id, row.title, goodsRelationKindLabel(row), goodsRelationStateLabel(row.state), row.enabled ? '사용' : '중지', representative.id, representative.code, representative.name, row.goods.length, row.goods.filter(good => good.public).length,
      kstDateTimeText(row.startsAt) || '제한 없음', kstDateTimeText(row.endsAt) || '제한 없음', kstDateTimeText(row.createdAt), kstDateTimeText(row.updatedAt), row.revision];
  }));
  sheet('구성 상품', ['편성 ID', '노출 제목', '구성 순서', '대표 여부', '상품번호', '상품코드', '상품명', '현재 공개 가능', ...(includesOtherComposition ? ['구성 표시값'] : [])], snapshot.rows.flatMap(row => row.goods.map((good, index) => [row.id, row.title, index + 1, good.id === row.representativeGoodId ? '대표' : '', good.id, good.code, good.name, good.public ? '가능' : '불가', ...(includesOtherComposition ? [row.kind === 'other_composition' ? good.compositionLabel ?? '' : ''] : [])])));
  sheet('조회 정보', ['항목', '내용'], [
    ['조회 범위', '현재 검색 조건의 전체 페이지'], ['검색어', snapshot.filters.query || '전체'],
    ['유형', snapshot.filters.kind === 'all' ? '전체' : GOODS_RELATION_KINDS.find(item => item.value === snapshot.filters.kind)!.label],
    ['전시상태', goodsRelationStateLabel(snapshot.filters.state)], ['정렬', '수정일 최신순, 같은 시각은 편성 ID 오름차순'],
    ['전체 편성 수', snapshot.rows.length], ['전체 구성 상품 행 수', snapshot.rows.reduce((sum, row) => sum + row.goods.length, 0)],
    ['조회 시작 (KST)', kstDateTimeText(snapshot.startedAt)], ['재조회 완료 (KST)', kstDateTimeText(snapshot.verifiedAt)],
    ['파일 한도', `${GOODS_RELATIONS_EXPORT_LIMIT.toLocaleString('ko-KR')}개 편성`],
    ['조회 방식', '전체 페이지를 두 번 읽어 순서·값·개수의 일치를 검사합니다. 저장된 시점 기록이나 단일 DB 스냅샷은 아닙니다.'],
    ['공개 기준', includesOtherComposition ? '다른 구성은 표시 설정이 켜져 있고 현재 상품 외에 공개 가능한 구성이 있어야 표시됩니다. 대표 상품의 공개 여부는 다른 구성의 노출을 제한하지 않습니다. 기존 유형은 대표 포함 공개 상품 2개 이상이어야 하며, 조회 뒤 상태와 기간은 달라질 수 있습니다.' : '전시중이어도 대표 상품을 포함해 현재 공개 가능한 상품이 2개 이상이어야 표시됩니다. 조회 뒤 상태와 기간은 달라질 수 있습니다.'],
    ['편집 범위', '서버에 저장된 값만 포함합니다. 파일을 수정해 다시 반입하는 양식이 아닙니다.'],
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
