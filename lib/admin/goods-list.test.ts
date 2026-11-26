import { describe, expect, it } from 'vitest';
import { parseGoodsVariantSupply, preorderUnavailableLabel } from '@/lib/goods-preorders';
import { GOODS_READINESS_REASONS, goodReadinessReasonAnchor, type GoodsReadinessReasonCode } from './goods-readiness';
import { GOODS_LIST_DATE_FIELDS, GOODS_LIST_PREORDER_NOT_OPEN_LABEL, GOODS_LIST_SEARCH_FIELDS, GOODS_LIST_SEARCH_HINTS, GOODS_LIST_SORT_OPTIONS, GOODS_LIST_STOCK_OPTIONS, goodsConsoleFilterValues, goodsListHref, goodsListPreorderSaleLabel, goodsListSalePeriodLabel, goodsListSearchChoices, goodEditorHref, normalizeGoodsListFilters } from './goods-list';

describe('goods list navigation', () => {
  it('상품번호(시스템 순번)와 상품 URL을 다른 검색 대상으로 두고, 예전 상품번호순 주소는 새 상품번호순으로 연다(S36-009·S36-X02)', () => {
    expect(GOODS_LIST_SEARCH_FIELDS.map(item => [item.value, item.label])).toEqual([
      ['all', '전체'], ['name', '상품명'], ['number', '상품번호'], ['id', '상품 URL'], ['code', '상품 자동코드·옵션 자동코드'], ['erp', 'ERP 코드·품명'], ['barcode', '바코드'],
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
  it('상품 URL(영문 내부 값)은 검색 대상으로 고르는 항목에서 빼고, 저장해 둔 주소(field=id)는 그대로 열어 그 조건을 보인다', () => {
    expect(goodsListSearchChoices().map(item => item.value)).toEqual(['all', 'name', 'number', 'code', 'erp', 'barcode']);
    for (const field of ['all', 'name', 'number', 'code', 'erp', 'barcode'] as const) expect(goodsListSearchChoices(field).some(item => item.value === 'id')).toBe(false);
    expect(goodsListSearchChoices('id').map(item => [item.value, item.label])).toEqual(GOODS_LIST_SEARCH_FIELDS.map(item => [item.value, item.label]));
    // 주소 계약은 그대로다: field=id는 정규화·목록 주소·내보내기 조건에 그대로 실린다.
    const filters = normalizeGoodsListFilters({ field: 'id', q: 'good-a' });
    expect(new URL(goodsListHref(filters), 'https://icons.test').searchParams.get('field')).toBe('id');
    expect(goodsConsoleFilterValues(filters).field).toBe('id');
    // '전체' 검색은 지금처럼 이 값도 찾는다.
    expect(GOODS_LIST_SEARCH_HINTS.all.title).toContain('상품 URL');
  });
  it('기간 조건의 날짜 이름은 게시 상태 값과 같은 말이다(공개일)', () => {
    expect(GOODS_LIST_DATE_FIELDS.map(item => [item.value, item.label])).toEqual([['created', '상품등록일'], ['updated', '상품수정일'], ['published', '공개일']]);
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
    expect(width('상품명, 상품번호, 상품 자동코드, ERP 코드·품명, 바코드')).toBeGreaterThan(254);
    expect(GOODS_LIST_SEARCH_HINTS.all.title).toContain('ERP 품명');
    expect(GOODS_LIST_SEARCH_HINTS.all.title).toContain('바코드');
    expect(GOODS_LIST_SEARCH_HINTS.erp.placeholder).toContain('ERP 코드·품명');
    expect(GOODS_LIST_SEARCH_HINTS.erp.title).toContain('ERP 품명');
    expect(GOODS_LIST_SEARCH_HINTS.barcode.placeholder).toContain('바코드');
    expect(GOODS_LIST_SEARCH_HINTS.number.title).toContain('쉼표나 공백');
  });
  it('validates detail filters and retains them through editor, paging and export links', () => {
    const filters = normalizeGoodsListFilters({ field: 'code', q: 'GOODS', dateField: 'updated', from: '2026-10-01', to: '2026-10-12', sort: 'price_desc', pageSize: '100', originId: '00000000-0000-4000-8000-000000042201', payment: 'bank', saleType: 'preorder', image: 'without', restriction: 'adult' });
    expect(filters).toMatchObject({ field: 'code', dateField: 'updated', from: '2026-10-01', to: '2026-10-12', sort: 'price_desc', pageSize: 100, payment: 'bank', saleType: 'preorder', image: 'without', restriction: 'adult' });
    const editor = new URL(goodEditorHref(filters, 'g100'), 'https://icons.test');
    for (const key of ['field', 'dateField', 'from', 'to', 'sort', 'originId', 'payment', 'saleType', 'image', 'restriction'] as const) expect(editor.searchParams.get(key)).toBe(filters[key]);
    expect(editor.searchParams.get('pageSize')).toBe('100');
    expect(normalizeGoodsListFilters({ from: '2026-02-30', to: '2026-10-12', sort: 'random', pageSize: '1000', originId: 'bad', payment: 'bad' })).toMatchObject({ from: null, sort: 'created_desc', pageSize: 50, originId: '', payment: 'all' });
  });
  it('시작일과 종료일이 뒤바뀌어 오면 기간 조건을 버리지 않고 바로잡아 건다', () => {
    const swapped = normalizeGoodsListFilters({ dateField: 'updated', from: '2026-10-12', to: '2026-10-01' });
    expect(swapped).toMatchObject({ dateField: 'updated', from: '2026-10-01', to: '2026-10-12' });
    const href = new URL(goodsListHref(swapped), 'https://icons.test');
    expect([href.searchParams.get('from'), href.searchParams.get('to')]).toEqual(['2026-10-01', '2026-10-12']);
    expect(goodsConsoleFilterValues(swapped)).toMatchObject({ from: '2026-10-01', to: '2026-10-12' });
    // 같은 날·한쪽만 있는 기간은 그대로다.
    expect(normalizeGoodsListFilters({ from: '2026-10-05', to: '2026-10-05' })).toMatchObject({ from: '2026-10-05', to: '2026-10-05' });
    expect(normalizeGoodsListFilters({ from: '2026-10-12' })).toMatchObject({ from: '2026-10-12', to: null });
    expect(normalizeGoodsListFilters({ to: '2026-10-01' })).toMatchObject({ from: null, to: '2026-10-01' });
  });
  it('판매기간(판매 예정·판매 종료) 필터를 정규화하고 목록·편집기·내보내기 조건에 그대로 싣는다', () => {
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
      .toMatchObject({query:'스탠드',ipId:'hwasan',page:2,status:'draft',stock:'soldout',categoryId:'',readiness:'all',pageSize:50,sort:'created_desc',from:null,to:null});
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
  /* 목록의 준비 사유 링크는 편집기 판매 준비 카드의 같은 사유와 같은 자리로 간다. 사유 표의 대상(target)만 따르면 세 사유가 그 칸이 아닌 기본 정보로 간다. */
  it('준비 사유를 주면 상품 수정에서 그 사유의 칸으로 가는 주소를 만든다(편집기와 같은 자리)', () => {
    const filters = normalizeGoodsListFilters({});
    const anchor = (code: GoodsReadinessReasonCode) => goodEditorHref(filters, 'g100', { code, target: GOODS_READINESS_REASONS[code].target }).split('#')[1];
    expect(anchor('stopped')).toBe('good-section-information');
    expect(anchor('image_missing')).toBe('good-section-images');
    expect(anchor('category_missing')).toBe('good-section-category');
    for (const code of Object.keys(GOODS_READINESS_REASONS) as GoodsReadinessReasonCode[])
      expect(anchor(code), code).toBe(goodReadinessReasonAnchor({ code, target: GOODS_READINESS_REASONS[code].target }));
    /* 영역 이름으로 부르던 곳(옵션별 재고 수정 링크)은 그대로다. */
    expect(goodEditorHref(filters, 'g100', 'variants')).toContain('#good-section-variants');
    expect(goodEditorHref(filters, 'g100')).not.toContain('#');
  });
});

describe('goodsListPreorderSaleLabel', () => {
  const at = '2026-11-25T03:00:00.000Z';
  const preorder = (state: string, availableQty = 0, extra: Record<string, unknown> = {}) => ({ mode: 'preorder', availableQty, policyId: 'a1000000-0000-4000-8000-000000000001', policyRevision: 1, state,
    startsAt: state === 'scheduled' ? '2026-12-02T02:00:00.000Z' : '2026-11-20T02:00:00.000Z', endsAt: state === 'closed' ? '2026-11-24T14:59:00.000Z' : '2026-12-13T14:59:00.000Z',
    expectedShipDate: '2026-12-14', calculatedAt: at, nextChangeAt: state === 'scheduled' ? '2026-12-02T02:00:00.000Z' : null, ...extra });
  const stock = { mode: 'stock', availableQty: 0, policyId: null, policyRevision: null, state: 'stock', startsAt: null, endsAt: null, expectedShipDate: null, calculatedAt: at, nextChangeAt: null };
  it('예약판매만 있고 주문받을 물량이 없으면 예약 상태를 돌려준다 — 접수 전만 고객 화면의 판매 예정 대신 예약 접수 전이다', () => {
    /* '판매 예정' 건수 칸·판매기간 조건은 판매기간 시작 전만 센다. 접수 전 예약판매를 같은 이름으로 부르면 배지가 붙은 상품이 그 칸에 없다. */
    expect(goodsListPreorderSaleLabel([preorder('scheduled'), preorder('scheduled')])).toBe('예약 접수 전');
    expect(GOODS_LIST_PREORDER_NOT_OPEN_LABEL).toBe('예약 접수 전');
    /* 고객 화면 문구는 그대로다 — 목록에서만 이름을 옮긴다. */
    expect(preorderUnavailableLabel([{ stockQty: 0, supply: parseGoodsVariantSupply(preorder('scheduled'))! }], true)).toBe('판매 예정');
    expect(goodsListPreorderSaleLabel([preorder('open')])).toBe('예약 물량 마감');
    expect(goodsListPreorderSaleLabel([preorder('closed')])).toBe('예약 접수 종료');
    expect(goodsListPreorderSaleLabel([preorder('stopped')])).toBe('예약 접수 중지');
  });
  it('일반 재고 옵션이 섞였거나, 물량이 남았거나, 예약 상태를 읽지 못하면 null(배지는 품절 그대로)이다', () => {
    expect(goodsListPreorderSaleLabel([preorder('scheduled'), stock])).toBeNull();
    expect(goodsListPreorderSaleLabel([preorder('open', 5)])).toBeNull();
    expect(goodsListPreorderSaleLabel([preorder('scheduled'), null])).toBeNull();
    expect(goodsListPreorderSaleLabel([])).toBeNull();
  });
});

describe('goodsListSalePeriodLabel', () => {
  const now = Date.parse('2026-11-25T03:00:00.000Z');
  it('판매기간 시작 전은 판매 예정, 끝난 뒤는 판매 종료, 판매 중이거나 기간이 없으면 null이다(고객 화면과 같은 판정)', () => {
    expect(goodsListSalePeriodLabel('2026-11-27T02:00:00.000Z', '2026-12-06T12:00:00.000Z', now)).toBe('판매 예정');
    expect(goodsListSalePeriodLabel('2026-11-01T00:00:00.000Z', '2026-11-25T03:00:00.000Z', now)).toBe('판매 종료');
    expect(goodsListSalePeriodLabel('2026-11-01T00:00:00.000Z', '2026-12-06T12:00:00.000Z', now)).toBeNull();
    expect(goodsListSalePeriodLabel(null, null, now)).toBeNull();
  });
});
