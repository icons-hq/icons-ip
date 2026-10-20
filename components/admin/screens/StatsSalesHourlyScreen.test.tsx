import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeAdminSalesHourlyFilters } from '@/lib/admin/stats-hourly';
import { salesHourlyFixture } from '@/lib/admin/stats-hourly.test-fixtures';
vi.mock('recharts', () => ({ ResponsiveContainer: () => null, LineChart: () => null, CartesianGrid: () => null, Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null }));
import { StatsSalesHourlyControls, StatsSalesHourlyScreen } from './StatsSalesHourlyScreen';

describe('시간대 판매 화면', () => {
  it('완료시간·조회시각·전체주문/IP상품 경계와 오늘/비교일 값을 표시한다', () => {
    const html = renderToStaticMarkup(<StatsSalesHourlyScreen report={salesHourlyFixture()} filters={normalizeAdminSalesHourlyFilters({})} />);
    expect(html).toContain('2026-10-14 07:31:45'); expect(html).toContain('2026-10-14 07:00:00'); expect(html).toContain('완료 7시간');
    expect(html).toContain('₩4,000'); expect(html).toContain('₩2,300'); expect(html).toContain('IP 조건은 상품 TOP10에만 적용됩니다.');
    expect(html).toContain('주문 생성시각'); expect(html).toContain('상품금액은 수량×단가−복수구매 할인이며 주문매출과 다릅니다.');
    expect(html).toContain('집계 완료'); expect(html).toContain('집계 대기'); expect(html).toContain('미도래');
    expect(html).toContain('23:00 ~ 24:00'); expect(html).toContain('주문 당시 상품명'); expect(html).toContain('시간대별'); expect(html).toContain('누적');
    expect(html).not.toContain('엑셀 다운로드'); expect(html).not.toContain('방문수');
  });
  it('오늘 완료시간 0은 오늘 0원/0건 관측으로 보이지 않는다', () => {
    const html = renderToStaticMarkup(<StatsSalesHourlyScreen report={salesHourlyFixture(0)} filters={normalizeAdminSalesHourlyFilters({})} />);
    expect(html).toContain('집계 마감까지 완료된 시간대가 없습니다.');
    expect(html).not.toContain('₩0'); expect(html).not.toContain('>0건<'); expect(html).toContain('—');
  });
  it('필터 재조회는 이전 마감시각을 숨겨서 유지하지 않는다', () => {
    const filters = normalizeAdminSalesHourlyFilters({ compareDate: '2026-10-07', ip: 'hourly-ip', cutoff: '2026-10-14T00:00:00+09:00' });
    const html = renderToStaticMarkup(<StatsSalesHourlyControls report={salesHourlyFixture(0)} filters={filters} error="잘못된 조건" />);
    expect(html).toContain('name="compareDate"'); expect(html).toContain('value="2026-10-07"'); expect(html).toContain('name="ip"');
    expect(html).not.toContain('name="cutoff"'); expect(html).toContain('role="alert"'); expect(html).toContain('최신 현황 조회');
  });
});
