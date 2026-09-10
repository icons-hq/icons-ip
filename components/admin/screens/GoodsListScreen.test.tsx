import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodsListScreen } from './GoodsListScreen';
import { normalizeGoodsListFilters } from '@/lib/admin/goods-list';

describe('goods list screen', () => {
  it('renders catalog filters and twenty-row paging with a precise edit link', () => {
    const html=renderToStaticMarkup(<GoodsListScreen data={{
      filters:normalizeGoodsListFilters({q:'ICONS',ipId:'hwasan',page:'2'}),total:1000,
      ips:[{id:'hwasan',title:'화산강림',archivedAt:null}],
      goods:[{id:'g100',code:'ICONS-100',name:'운영 상품',ipId:'hwasan',ipTitle:'화산강림',publishedAt:null,archivedAt:null,stock:'ok',noticeComplete: true, stockQty:0,activeStockQty:0,lowStockOptionCount:0}],
    }}/>);
    expect(html).toContain('admin-console-grid-table');
    expect(html).toContain('상품코드'); expect(html).toContain('상품명');
    expect(html).toContain('name="q"'); expect(html).toContain('name="ipId"');
    expect(html).toContain('name="status"'); expect(html).toContain('name="stock"');
    expect(html).toContain('goodId=g100'); expect(html).toContain('page=3');
    expect(html).toContain('초안'); expect(html).toContain('품절');
    expect(html).toContain('1,000');
  });
  it('모든 옵션을 중지한 상품은 재고 10개를 보존하면서 판매 불가와 부족 경보를 표시한다', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{
      filters: normalizeGoodsListFilters({}), total: 1, ips: [],
      goods: [{ id: 'stopped', code: 'STOPPED', name: '중지 상품', ipId: 'ip', ipTitle: 'IP',
        publishedAt: '2026-09-10', archivedAt: null, stock: 'ok', noticeComplete: true,
        stockQty: 10, activeStockQty: 0, lowStockOptionCount: 1 }],
    }} />);
    const body = html.split('<tbody')[1]?.split('</tbody>')[0] ?? '';
    expect(body).toContain('10개');
    expect(body).toContain('0개');
    expect(body).toContain('품절·판매 중지');
    expect(body).toContain('판매 준비 중');
    expect(body).toContain('부족 1개 옵션');
  });
});
