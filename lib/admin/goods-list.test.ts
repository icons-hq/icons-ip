import { describe, expect, it } from 'vitest';
import { goodsListHref, goodEditorHref, normalizeGoodsListFilters } from './goods-list';

describe('goods list navigation', () => {
  it('validates detail filters and retains them through editor, paging and export links', () => {
    const filters = normalizeGoodsListFilters({ field: 'code', q: 'GOODS', dateField: 'updated', from: '2026-10-01', to: '2026-10-12', sort: 'price_desc', pageSize: '50', originId: '00000000-0000-4000-8000-000000042201', payment: 'bank', saleType: 'preorder', image: 'without', restriction: 'adult' });
    expect(filters).toMatchObject({ field: 'code', dateField: 'updated', from: '2026-10-01', to: '2026-10-12', sort: 'price_desc', pageSize: 50, payment: 'bank', saleType: 'preorder', image: 'without', restriction: 'adult' });
    const editor = new URL(goodEditorHref(filters, 'g100'), 'https://icons.test');
    for (const key of ['field', 'dateField', 'from', 'to', 'sort', 'originId', 'payment', 'saleType', 'image', 'restriction'] as const) expect(editor.searchParams.get(key)).toBe(filters[key]);
    expect(editor.searchParams.get('pageSize')).toBe('50');
    expect(normalizeGoodsListFilters({ from: '2026-02-30', to: '2026-10-12', sort: 'random', pageSize: '1000', originId: 'bad', payment: 'bad' })).toMatchObject({ from: null, sort: 'created_desc', pageSize: 20, originId: '', payment: 'all' });
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
