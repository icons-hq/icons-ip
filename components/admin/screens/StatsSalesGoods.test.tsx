import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { normalizeAdminStatsFilters } from '@/lib/admin/stats';
import { StatsSalesGoods } from './StatsSalesGoods';
const filters = normalizeAdminStatsFilters({ from: '2026-10-01', to: '2026-10-12', ip: 'qa', compare: 'year', bucket: 'month' });
const now = new Date('2026-10-14T00:00:00Z');
const report = { rows: Array.from({ length: 20 }, (_, index) => ({ rank: index + 21, goodId: `qa-${index + 21}`, name: `검증 상품 ${index + 21}`, ipId: 'qa', qty: 1, revenue: 1000 })), totalCount: 45, page: 2, pageSize: 20, asOf: now.toISOString() };
describe('판매 상품 페이지', () => {
  it('실제 21위부터 표시하고 네 이동 링크의 필터·마지막 페이지를 유지한다', () => {
    const html = renderToStaticMarkup(<StatsSalesGoods report={report} filters={filters} now={now} />).replaceAll('&amp;', '&');
    expect(html).toContain('검증 상품 21'); expect(html).toContain('21–40 / 전체 45개');
    expect(html).toContain('2 / 3 페이지'); expect(html).toContain('상품 전체 포함 엑셀'); expect(html).toContain('최대 10,000개 상품');
    for (const label of ['처음', '이전', '다음', '마지막']) expect(html).toContain(`aria-label="상품 순위 ${label} 페이지"`);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    expect(hrefs.filter(href => href.includes('goodsPage=3'))).toHaveLength(2);
    for (const href of hrefs) {
      const url = new URL(href, 'https://example.test');
      expect(url.searchParams.get('from')).toBe('2026-10-01'); expect(url.searchParams.get('to')).toBe('2026-10-12');
      expect(url.searchParams.get('ip')).toBe('qa'); expect(url.searchParams.get('compare')).toBe('year'); expect(url.searchParams.get('bucket')).toBe('month');
    }
    const exportUrl = new URL(hrefs[0], 'https://example.test');
    expect(exportUrl.pathname).toBe('/api/admin/stats-workbook'); expect(exportUrl.searchParams.get('report')).toBe('sales'); expect(exportUrl.searchParams.has('goodsPage')).toBe(false);
  });
  it('0건은 오류나 이전·다음 이동 없이 명시한다', () => {
    const html = renderToStaticMarkup(<StatsSalesGoods report={{ ...report, rows: [], totalCount: 0, page: 1 }} filters={filters} now={now} />);
    expect(html).toContain('이 기간에 판매된 상품이 없습니다.'); expect(html).toContain('0–0 / 전체 0개');
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(4);
  });
  it.each(['current', 'comparison'] as const)('%s 기간이 상한을 넘으면 오류 다운로드 대신 조건축소 안내를 보인다', period => {
    const html = renderToStaticMarkup(<StatsSalesGoods report={{ ...report, totalCount: period === 'current' ? 10001 : 45 }} comparisonTotalCount={period === 'comparison' ? 10001 : 2} filters={filters} now={now} />);
    expect(html).not.toContain('/api/admin/stats-workbook');
    expect(html).toContain(period === 'current' ? '현재기간 상품이 10,000개를 초과' : '비교기간 상품이 10,000개를 초과');
    expect(html).toContain('기간 또는 IP 조건을 좁혀주세요'); expect(html).toContain('현재·비교기간 각각');
  });

});
