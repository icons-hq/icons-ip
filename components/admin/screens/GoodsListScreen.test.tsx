import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { GoodsListScreen } from './GoodsListScreen';
import { GoodsListFiltersForm } from './GoodsListFiltersForm';
import { GOODS_READINESS_REASONS, unknownGoodsReadiness } from '@/lib/admin/goods-readiness';
import { goodEditorHref, normalizeGoodsListFilters } from '@/lib/admin/goods-list';

describe('goods list screen', () => {
  it('상품 관리 권한과 현재 세션이 있으면 판매가·재고수량·판매상태를 목록에서 바로 고치고, IP 필터에서는 IP 전체 즉시할인을 연다', () => {
    const identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
    const good = { id: 'good-a', code: 'A', name: '상품 A', ipId: 'maple', ipTitle: '메이플', publishedAt: null, archivedAt: null, stock: 'ok' as const, stockQty: 7,
      activeStockQty: 7, lowStockOptionCount: 0, noticeComplete: true, priceMin: 10000, priceMax: 10000, basePrice: 10000, activeVariantCount: 1,
      inlineStock: { variantId: 'b9000000-0000-4000-8000-000000000010', stockQty: 7 } };
    const multi = { ...good, id: 'good-b', activeVariantCount: 3, inlineStock: null, compareAtPrice: 15000 };
    const discounted = { ...good, id: 'good-c', activeDiscountEndsAt: '2026-10-30T00:00:00Z' };
    const data = { filters: normalizeGoodsListFilters({ ipId: 'maple' }), goods: [good, multi, discounted], ips: [{ id: 'maple', title: '메이플', archivedAt: null }], total: 3 };
    const html = renderToStaticMarkup(<GoodsListScreen data={data} canIssueMarketingLinks bulkIdentity={identity} />);
    for (const label of ['판매가 바로 수정', '판매상태 바로 수정', '재고수량 바로 수정']) expect(html).toContain(`aria-label="${label}"`);
    // 판매가 바로 수정은 편집기의 판매가와 같은 뜻일 때만: 상품 할인·진행 중인 즉시할인 상품은 이유만 보인다.
    expect(html.match(/판매가 바로 수정/g)).toHaveLength(1);
    expect(html).toContain('상품 할인 중 · 판매가는 상품 수정에서 변경'); expect(html).toContain('#good-section-price');
    expect(html).toContain('할인을 중지한 뒤 판매가를 바꿀 수 있습니다');
    expect(html.match(/재고수량 바로 수정/g)).toHaveLength(2);
    expect(html).toContain('옵션별 재고 수정');
    expect(html).toContain('IP 전체 즉시할인');
    const readOnly = renderToStaticMarkup(<GoodsListScreen data={data} bulkIdentity={identity} />);
    expect(readOnly).not.toContain('바로 수정'); expect(readOnly).not.toContain('IP 전체 즉시할인');
  });
  it('shows server status counts independently of the filtered total and exposes real list controls', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({ status: 'draft', from: '2026-10-01', pageSize: '50', image: 'without' }), goods: [], ips: [], total: 3, pageSize: 50, counts: { all: 20, active: 15, draft: 3, published: 12, archived: 5 } }} />);
    expect(html).toContain('상품등록일');
    expect(html).toContain('상품수정일');
    expect(html).toContain('name="from"');
    expect(html).toContain('name="originId"');
    expect(html).toContain('name="image"');
    expect(html).toContain('aria-label="상품 목록수"');
    expect(html).toContain('전시중<strong>12');
    expect(html).toContain('전체<strong>20');
    expect(html).toContain('상품목록 <span>(총 <strong>3</strong>개)');
    expect(html).not.toContain('wc-admin-kit__page-header');
    expect(html).toContain('create=1');
    expect(html).toContain('상품 일괄등록·수정');
    expect(html).toContain('href="/admin/catalog/groups">그룹상품 조회/수정</a>');
    expect(html).toContain('from=2026-10-01');
  });
  it('상세 조건을 하단 검색 동작 앞에 유지하고 지정된 조건이 있으면 펼친다', () => {
    const render = (values: Record<string, string>) => renderToStaticMarkup(<GoodsListFiltersForm data={{
      filters: normalizeGoodsListFilters(values), goods: [], ips: [], total: 0,
      origins: [{ id: '11111111-1111-4111-8111-111111111111', name: '기본 출고지', active: true }],
    }} />);
    const active = render({ image: 'without', payment: 'bank', saleType: 'preorder', restriction: 'adult', originId: '11111111-1111-4111-8111-111111111111' });
    expect(active).toContain('class="admin-goods-search__advanced" open=""');
    expect(active).toContain('value="without" selected=""');
    expect(active).toContain('value="bank" selected=""');
    expect(active).toContain('value="preorder" selected=""');
    expect(active).toContain('value="adult" selected=""');
    expect(active).toContain('value="11111111-1111-4111-8111-111111111111" selected=""');
    expect(active.indexOf('name="image"')).toBeLessThan(active.indexOf('type="submit"'));
    expect(active).toContain('href="/admin/catalog/goods">초기화');
    expect(render({})).not.toContain('class="admin-goods-search__advanced" open=""');
  });
  it('판매상태 줄에 판매기간(판매대기·종료) 필터를 둔다', () => {
    const html = renderToStaticMarkup(<GoodsListFiltersForm data={{ filters: normalizeGoodsListFilters({ salePeriod: 'ended' }), goods: [], ips: [], total: 0 }} />);
    expect(html).toContain('aria-label="판매기간"');
    expect(html).toContain('name="salePeriod"');
    expect(html).toContain('<option value="scheduled">판매대기 (시작 전)</option>');
    expect(html).toContain('<option value="ended" selected="">판매기간 종료</option>');
    expect(html.indexOf('name="salePeriod"')).toBeLessThan(html.indexOf('admin-goods-search__advanced'));
  });
  it('상품번호 열: 고객에게 보이는 상품은 고객 화면을 새 탭으로, 아니면 편집기 미리보기로 연다. 상품명은 지금처럼 수정 화면이다', () => {
    const base = { code: 'A', name: '상품 A', ipId: 'maple', ipTitle: '메이플', archivedAt: null, stock: 'ok' as const, stockQty: 1, activeStockQty: 1, lowStockOptionCount: 0, noticeComplete: true };
    const filters = normalizeGoodsListFilters({ q: '상품' });
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters, total: 2, ips: [], goods: [
      { ...base, id: 'good-public', publishedAt: '2026-10-01T00:00:00Z', customerVisible: true },
      { ...base, id: 'good-draft', publishedAt: null, customerVisible: false },
    ] }} />);
    expect(html).toContain('>상품번호</th>');
    expect(html).toMatch(/<a class="admin-goods-worklist__good-id" href="\/shop\/good-public" target="_blank" rel="noopener noreferrer">good-public/);
    expect(html).toContain(`href="${goodEditorHref(filters, 'good-draft').replaceAll('&', '&amp;')}#good-preview"`);
    expect(html).toContain('공개 전 · 미리보기');
    // 상품명(첫 열)은 수정 화면으로 간다.
    expect(html).toContain(`<a class="admin-console-grid-link" href="${goodEditorHref(filters, 'good-public').replaceAll('&', '&amp;')}">`);
    // 상품번호는 열로 옮겼으므로 접힌 추가 정보에 다시 두지 않는다.
    expect(html).not.toContain('<dt>상품번호</dt>');
  });
  it('빈 상품 목록에서도 지역 배송 정책 만료를 알린다', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{ filters: normalizeGoodsListFilters({}), goods: [], ips: [], total: 0 }}
      shippingRegionExpiry={{ warnings: [{ originName: "김포", carrierLabel: "한진택배", id: 'policy', name: '지역 정책', version: 1, endsAt: '2026-09-27T00:00:00Z', status: 'expired' }] }} />);
    expect(html).toContain('정책 만료');
    expect(html).toContain('href="/admin/settings/shipping-regions"');
  });
  it('renders catalog filters and twenty-row paging with a precise edit link', () => {
    const html=renderToStaticMarkup(<GoodsListScreen data={{
      filters:normalizeGoodsListFilters({q:'ICONS',ipId:'hwasan',page:'2'}),total:1000,
      ips:[{id:'hwasan',title:'화산강림',archivedAt:null}],
      goods:[{id:'g100',code:'ICONS-100',name:'운영 상품',ipId:'hwasan',ipTitle:'화산강림',publishedAt:null,archivedAt:null,stock:'ok',noticeComplete: true, stockQty:0,activeStockQty:0,lowStockOptionCount:0}],
    }}/>);
    expect(html).toContain('admin-console-grid-table');
    expect(html).toContain('상품코드'); expect(html).toContain('상품명');
    expect(html).toContain('ERP 코드·품명');
    expect(html).toContain('바코드');
    expect(html).toContain('name="categoryId"'); expect(html).toContain('name="readiness"');
    expect(html).toContain('name="q"'); expect(html).toContain('name="ipId"');
    expect(html).toContain('name="status"'); expect(html).toContain('name="stock"');
    expect(html).toContain('goodId=g100'); expect(html).toContain('page=3');
    expect(html).toContain('임시저장'); expect(html).toContain('품절');
    expect(html).toContain('1,000');
  });
  it('모든 옵션을 중지한 상품은 재고 10개를 보존하면서 판매 불가와 부족 경보를 표시한다', () => {
    const html = renderToStaticMarkup(<GoodsListScreen data={{
      filters: normalizeGoodsListFilters({}), total: 1, ips: [],
      goods: [{ id: 'stopped', code: 'STOPPED', name: '중지 상품', ipId: 'ip', ipTitle: 'IP',
        publishedAt: '2026-09-10', archivedAt: null, stock: 'ok', noticeComplete: true,
        stockQty: 10, activeStockQty: 0, lowStockOptionCount: 1, priceMin: 12345, priceMax: 17890,
        readiness: { ...unknownGoodsReadiness(), state: 'blocked', operation: 'active', availableQty: 0, reasons: [{ code: 'no_active_options', ...GOODS_READINESS_REASONS.no_active_options, kind: 'blocking' }] } }],
    }} />);
    const body = html.split('<tbody')[1]?.split('</tbody>')[0] ?? '';
    expect(body).toContain('10개');
    expect(body).toContain('0개');
    expect(body).toContain('사용 중인 옵션 없음');
    expect(body).toContain('판매 준비 중');
    expect(body).toContain('12,345~17,890원');
    expect(body).toContain('#good-section-variants');
    expect(body).toContain('부족 1개 옵션');
  });
});
