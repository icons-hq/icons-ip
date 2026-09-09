import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodsListScreen } from './GoodsListScreen';
import { normalizeGoodsListFilters } from '@/lib/admin/goods-list';

describe('goods list screen', () => {
  it('renders catalog filters and twenty-row paging with a precise edit link', () => {
    const html=renderToStaticMarkup(<GoodsListScreen data={{
      filters:normalizeGoodsListFilters({q:'ICONS',ipId:'hwasan',page:'2'}),total:1000,
      ips:[{id:'hwasan',title:'화산강림',archivedAt:null}],
      goods:[{id:'g100',code:'ICONS-100',name:'운영 상품',ipId:'hwasan',ipTitle:'화산강림',publishedAt:null,archivedAt:null,stock:'ok',noticeComplete: true, stockQty:0}],
    }}/>);
    expect(html).toContain('admin-console-grid-table');
    expect(html).toContain('상품코드'); expect(html).toContain('상품명');
    expect(html).toContain('name="q"'); expect(html).toContain('name="ipId"');
    expect(html).toContain('name="status"'); expect(html).toContain('name="stock"');
    expect(html).toContain('goodId=g100'); expect(html).toContain('page=3');
    expect(html).toContain('초안'); expect(html).toContain('품절');
    expect(html).toContain('1,000');
  });
});
