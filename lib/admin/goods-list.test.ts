import { describe, expect, it } from 'vitest';
import { GOODS_LIST_SEARCH_FIELDS, GOODS_LIST_SEARCH_HINTS, GOODS_LIST_SORT_OPTIONS, GOODS_LIST_STOCK_OPTIONS, goodsConsoleFilterValues, goodsListHref, goodEditorHref, normalizeGoodsListFilters } from './goods-list';

describe('goods list navigation', () => {
  it('상품번호(시스템 순번)와 상품 URL을 다른 검색 대상으로 두고, 예전 상품번호순 주소는 새 상품번호순으로 연다(S36-009·S36-X02)', () => {
    expect(GOODS_LIST_SEARCH_FIELDS.map(item => [item.value, item.label])).toEqual([
      ['all', '전체'], ['name', '상품명'], ['number', '상품번호'], ['id', '상품 URL'], ['code', '판매자상품코드·관리코드'], ['erp', 'ERP 코드·품명'], ['barcode', '바코드'],
    ]);
    const filters = normalizeGoodsListFilters({ field: 'number', q: '12, 15', sort: 'number_asc' });
    expect(filters).toMatchObject({ field: 'number', query: '12, 15', sort: 'number_asc' });
    expect(goodsConsoleFilterValues(filters)).toMatchObject({ field: 'number', sort: 'number_asc' });
    expect(new URL(goodsListHref(filters), 'https://icons.test').searchParams.get('field')).toBe('number');
    expect(GOODS_LIST_SORT_OPTIONS.find(option => option.value === 'number_asc')?.label).toBe('상품번호순');
    expect(GOODS_LIST_SORT_OPTIONS.some(option => (option.value as string) === 'id_asc')).toBe(false);
    expect(normalizeGoodsListFilters({ sort: 'id_asc' }).sort).toBe('number_asc');
    for (const sort of ['constructor', 'toString', '__proto__']) expect(normalizeGoodsListFilters({ sort }).sort).toBe('created_desc');
    expect(normalizeGoodsListFilters({ field: 'id' }).field).toBe('id');
  });
  it('검색어 칸 안내는 검색 대상마다 따로 있고, 전체 안내는 ERP 품명·바코드까지 말한다(TKT-074)', () => {
    for (const item of GOODS_LIST_SEARCH_FIELDS) {
      expect(GOODS_LIST_SEARCH_HINTS[item.value].placeholder.length).toBeGreaterThan(0);
      expect(GOODS_LIST_SEARCH_HINTS[item.value].title.length).toBeGreaterThan(0);
    }
    expect(GOODS_LIST_SEARCH_HINTS.all.placeholder).toBe('상품명·번호·코드·ERP 품명·바코드');
    // 1440 화면의 검색어 칸(약 254px, text-sm)에 잘리지 않게 입력 칸 안내를 짧게 쓴다(리뷰 T17a-RV ③). 자세한 안내는 말풍선에 있다.
    // 한글 14px·영숫자 8.5px·문장부호·공백 4.5px로 어림한 폭이 240px 이하다.
    const width = (text: string) => [...text].reduce((sum, ch) => sum + (/[가-힣]/.test(ch) ? 14 : /[A-Za-z0-9]/.test(ch) ? 8.5 : 4.5), 0);
    for (const item of GOODS_LIST_SEARCH_FIELDS) expect(width(GOODS_LIST_SEARCH_HINTS[item.value].placeholder)).toBeLessThanOrEqual(240);
    expect(width('상품명, 상품번호, 판매자상품코드, ERP 코드·품명, 바코드')).toBeGreaterThan(254);
    expect(GOODS_LIST_SEARCH_HINTS.all.title).toContain('ERP 품명');
    expect(GOODS_LIST_SEARCH_HINTS.all.title).toContain('바코드');
    expect(GOODS_LIST_SEARCH_HINTS.erp.placeholder).toContain('ERP 코드·품명');
    expect(GOODS_LIST_SEARCH_HINTS.erp.title).toContain('ERP 품명');
    expect(GOODS_LIST_SEARCH_HINTS.barcode.placeholder).toContain('바코드');
    expect(GOODS_LIST_SEARCH_HINTS.number.title).toContain('쉼표나 공백');
  });
  it('validates detail filters and retains them through editor, paging and export links', () => {
    const filters = normalizeGoodsListFilters({ field: 'code', q: 'GOODS', dateField: 'updated', from: '2026-10-01', to: '2026-10-12', sort: 'price_desc', pageSize: '50', originId: '00000000-0000-4000-8000-000000042201', payment: 'bank', saleType: 'preorder', image: 'without', restriction: 'adult' });
    expect(filters).toMatchObject({ field: 'code', dateField: 'updated', from: '2026-10-01', to: '2026-10-12', sort: 'price_desc', pageSize: 50, payment: 'bank', saleType: 'preorder', image: 'without', restriction: 'adult' });
    const editor = new URL(goodEditorHref(filters, 'g100'), 'https://icons.test');
    for (const key of ['field', 'dateField', 'from', 'to', 'sort', 'originId', 'payment', 'saleType', 'image', 'restriction'] as const) expect(editor.searchParams.get(key)).toBe(filters[key]);
    expect(editor.searchParams.get('pageSize')).toBe('50');
    expect(normalizeGoodsListFilters({ from: '2026-02-30', to: '2026-10-12', sort: 'random', pageSize: '1000', originId: 'bad', payment: 'bad' })).toMatchObject({ from: null, sort: 'created_desc', pageSize: 20, originId: '', payment: 'all' });
  });
  it('판매기간(판매대기·판매기간 종료) 필터를 정규화하고 목록·편집기·내보내기 조건에 그대로 싣는다', () => {
    const filters = normalizeGoodsListFilters({ salePeriod: 'scheduled' });
    expect(filters.salePeriod).toBe('scheduled');
    expect(new URL(goodsListHref(filters), 'https://icons.test').searchParams.get('salePeriod')).toBe('scheduled');
    expect(new URL(goodEditorHref(filters, 'g100'), 'https://icons.test').searchParams.get('salePeriod')).toBe('scheduled');
    expect(goodsConsoleFilterValues(filters)).toMatchObject({ salePeriod: 'scheduled' });
    expect(goodsConsoleFilterValues(normalizeGoodsListFilters({ salePeriod: 'ended' })).salePeriod).toBe('ended');
    for (const value of ['open', 'unlimited', '', 'all']) {
      const normalized = normalizeGoodsListFilters({ salePeriod: value });
      expect(normalized.salePeriod).toBe('all');
      expect(goodsListHref(normalized)).not.toContain('salePeriod');
      expect(goodsConsoleFilterValues(normalized).salePeriod).toBe('all');
    }
  });
  it('판매상태 필터는 품절(out_of_stock)·판매중지(stopped)를 따로 받고, 이전 값 soldout(둘 다)도 저장된 주소 그대로 연다(MD-0026)', () => {
    for (const stock of ['out_of_stock', 'stopped', 'soldout'] as const) {
      const filters = normalizeGoodsListFilters({ stock });
      expect(filters.stock).toBe(stock);
      expect(new URL(goodsListHref(filters), 'https://icons.test').searchParams.get('stock')).toBe(stock);
      expect(new URL(goodEditorHref(filters, 'g100'), 'https://icons.test').searchParams.get('stock')).toBe(stock);
    }
    expect(GOODS_LIST_STOCK_OPTIONS.map(option => option.value)).toEqual(['all', 'ok', 'low', 'out_of_stock', 'stopped', 'soldout']);
    expect(GOODS_LIST_STOCK_OPTIONS.find(option => option.value === 'out_of_stock')?.label).toBe('품절');
    expect(GOODS_LIST_STOCK_OPTIONS.find(option => option.value === 'stopped')?.label).toBe('판매중지');
    for (const stock of ['sold_out', 'STOPPED', 'empty']) expect(normalizeGoodsListFilters({ stock }).stock).toBe('all');
  });
  it('normalizes hostile and repeated filters and keeps stable list URLs', () => {
    expect(normalizeGoodsListFilters({q:' 스탠드 ',ipId:'hwasan',page:'2',status:'draft',stock:'soldout'}))
      .toMatchObject({query:'스탠드',ipId:'hwasan',page:2,status:'draft',stock:'soldout',categoryId:'',readiness:'all',pageSize:20,sort:'created_desc',from:null,to:null});
    expect(normalizeGoodsListFilters({q:['one','two'],ipId:'../escape',page:'1.5',status:'oops',stock:'oops'}))
      .toMatchObject({query:'',ipId:'',page:1,status:'active',stock:'all',categoryId:'',readiness:'all',field:'all',originId:'',payment:'all',saleType:'all',image:'all',restriction:'all'});
  });
  it('preserves every filter when opening an editor or moving pages', () => {
    const filters=normalizeGoodsListFilters({q:'상품&코드',ipId:'hwasan',status:'published',stock:'low',page:'3',categoryId:'00000000-0000-4000-8000-000000000001',readiness:'kc_required'});
    const editor=new URL(goodEditorHref(filters,'g100'),'https://icons.test');
    expect(Object.fromEntries(editor.searchParams)).toEqual({q:'상품&코드',ipId:'hwasan',status:'published',stock:'low',page:'3',categoryId:'00000000-0000-4000-8000-000000000001',readiness:'kc_required',goodId:'g100'});
    const next=new URL(goodsListHref(filters,4),'https://icons.test');
    expect(next.searchParams.get('page')).toBe('4');
    expect(next.searchParams.has('goodId')).toBe(false);
    expect(goodEditorHref(filters, 'g100', 'kc')).toContain('#good-operation-kc');
  });
});
