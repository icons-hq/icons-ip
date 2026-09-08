import { describe, expect, it } from 'vitest';
import { goodsListHref, goodEditorHref, normalizeGoodsListFilters } from './goods-list';

describe('goods list navigation', () => {
  it('normalizes hostile and repeated filters and keeps stable list URLs', () => {
    expect(normalizeGoodsListFilters({q:' 스탠드 ',ipId:'hwasan',page:'2',status:'draft',stock:'soldout'}))
      .toEqual({query:'스탠드',ipId:'hwasan',page:2,status:'draft',stock:'soldout'});
    expect(normalizeGoodsListFilters({q:['one','two'],ipId:'../escape',page:'1.5',status:'oops',stock:'oops'}))
      .toEqual({query:'',ipId:'',page:1,status:'active',stock:'all'});
  });
  it('preserves every filter when opening an editor or moving pages', () => {
    const filters=normalizeGoodsListFilters({q:'상품&코드',ipId:'hwasan',status:'published',stock:'low',page:'3'});
    const editor=new URL(goodEditorHref(filters,'g100'),'https://icons.test');
    expect(Object.fromEntries(editor.searchParams)).toEqual({q:'상품&코드',ipId:'hwasan',status:'published',stock:'low',page:'3',goodId:'g100'});
    const next=new URL(goodsListHref(filters,4),'https://icons.test');
    expect(next.searchParams.get('page')).toBe('4');
    expect(next.searchParams.has('goodId')).toBe(false);
  });
});
