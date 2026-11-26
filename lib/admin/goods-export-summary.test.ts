import { describe, expect, it } from 'vitest';
import { goodsExportFilterParts, goodsExportFilterText } from './goods-export-summary';
import { normalizeGoodsListFilters } from './goods-list';

const filters = (values: Record<string, string> = {}) => normalizeGoodsListFilters(values);

describe('엑셀 내보내기가 되읽는 검색 조건', () => {
  it('아무 조건도 걸지 않아도 기본 조건(보관 제외)은 늘 보인다', () => {
    expect(goodsExportFilterText(filters())).toBe('보관 제외');
    expect(goodsExportFilterParts(filters({ status: 'all' }))).toEqual(['보관 포함 전체']);
    expect(goodsExportFilterParts(filters({ status: 'draft' }))).toEqual(['초안']);
    expect(goodsExportFilterParts(filters({ status: 'published' }))).toEqual(['공개']);
    expect(goodsExportFilterParts(filters({ status: 'archived' }))).toEqual(['보관']);
  });

  it('IP·판매상태 조건을 이름으로 한 줄에 잇는다(조사 예시 그대로)', () => {
    expect(goodsExportFilterText(filters({ ipId: 'maple', stock: 'out_of_stock' }), { ip: '메이플스토리' })).toBe('보관 제외 · IP 메이플스토리 · 품절');
    expect(goodsExportFilterParts(filters({ stock: 'low' }))).toEqual(['보관 제외', '소량 재고']);
    expect(goodsExportFilterParts(filters({ stock: 'stopped' }))).toEqual(['보관 제외', '판매중지']);
  });

  it('이름을 읽지 못한 IP·카테고리·출고지는 번호 대신 지정이라고만 말한다', () => {
    const text = goodsExportFilterText(filters({ ipId: 'maple', categoryId: '3f2c8e1a-0000-4000-8000-000000000001', originId: '3f2c8e1a-0000-4000-8000-000000000002' }));
    expect(text).toBe('보관 제외 · IP 지정 · 카테고리 지정 · 출고지 지정');
    expect(text).not.toContain('maple');
    expect(text).not.toContain('3f2c8e1a');
  });

  it('카테고리·출고지는 읽어 둔 이름으로 말한다', () => {
    expect(goodsExportFilterParts(
      filters({ categoryId: '3f2c8e1a-0000-4000-8000-000000000001', originId: '3f2c8e1a-0000-4000-8000-000000000002' }),
      { category: '키링', origin: '김포' },
    )).toEqual(['보관 제외', '카테고리 키링', '출고지 김포']);
  });

  it('검색어는 고른 검색 대상 이름과 함께, 기간은 기준 날짜 이름과 함께 말한다', () => {
    expect(goodsExportFilterParts(filters({ q: ' 머그 ' }))).toEqual(['보관 제외', '검색어 “머그”']);
    expect(goodsExportFilterParts(filters({ q: 'MP-1', field: 'code' }))).toEqual(['보관 제외', '상품 자동코드·옵션 자동코드 “MP-1”']);
    expect(goodsExportFilterParts(filters({ from: '2026-11-01', to: '2026-11-25' }))).toEqual(['보관 제외', '상품등록일 2026-11-01 ~ 2026-11-25']);
    expect(goodsExportFilterParts(filters({ from: '2026-11-01', dateField: 'updated' }))).toEqual(['보관 제외', '상품수정일 2026-11-01부터']);
    expect(goodsExportFilterParts(filters({ to: '2026-11-25' }))).toEqual(['보관 제외', '상품등록일 2026-11-25까지']);
  });

  it('판매 준비·결제수단·판매 유형·이미지·판매 제한·판매기간 조건도 빠뜨리지 않는다', () => {
    expect(goodsExportFilterParts(filters({
      readiness: 'image_missing', payment: 'bank', saleType: 'preorder', image: 'without', restriction: 'adult', salePeriod: 'scheduled',
    }))).toEqual(['보관 제외', '대표 이미지 미입력', '무통장입금 가능', '예약판매 옵션 포함', '대표 이미지 없음', '성인 상품', '판매 예정']);
    expect(goodsExportFilterParts(filters({ readiness: 'ready', payment: 'card', saleType: 'stock', image: 'with', restriction: 'none', salePeriod: 'ended' })))
      .toEqual(['보관 제외', '설정 준비 완료', '카드 결제 가능', '일반 재고 상품', '대표 이미지 있음', '판매 제한 없음', '판매 종료']);
    expect(goodsExportFilterParts(filters({ readiness: 'review_required', payment: 'none' }))).toEqual(['보관 제외', '확인할 상품 전체', '결제수단 없음']);
  });

  it('쪽·정렬·쪽 크기는 내보내기 범위가 아니라 말하지 않는다', () => {
    expect(goodsExportFilterParts(filters({ page: '3', sort: 'name_asc', pageSize: '100' }))).toEqual(['보관 제외']);
  });
});
