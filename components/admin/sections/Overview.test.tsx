import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminInsights } from '@/lib/admin/insights.server';
import type { AdminWorkQueueData } from '@/lib/admin/work-queue';
import { RecentOrders } from '../RecentOrders';
import { OrderPipeline } from '../charts/OrderPipeline';
import { OverviewSection } from './Overview';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

const insights: AdminInsights = {
  revenue: { current: 690000, previous: 400000 },
  paymentCount: { current: 12, previous: 9 },
  avgPayment: { current: 57500, previous: 44444 },
  signupCount: { current: 8, previous: 5 },
  dailyRevenue: [{ date: '2026-08-18', goods: 690000, tickets: 0 }],
  pipeline: [{ status: 'paid', count: 3 }],
  recentOrders: [],
  topIps: [],
};

describe('OverviewSection', () => {
  it('한눈에 보는 지표 카드를 그대로 유지한다', () => {
    const html = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} />);

    expect(html).toContain('30일 매출');
    expect(html).toContain('30일 신규 가입');
    expect(html).toContain('href="/admin/guide">판매자센터 운영 가이드');
    expect(html).not.toContain('업무 집계');
  });

  /*
   * 대시보드는 "지금 어떤가"를 보는 자리로 남기고, 같은 지표를 기간·축으로
   * 파고드는 일은 통계 리포트가 맡는다(#258). 링크가 없으면 운영자가 여기서
   * 더 깊이 보려다 못 찾는다.
   */
  it('세 통계 리포트로 가는 길을 연다', () => {
    const html = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} />);

    expect(html).toContain('href="/admin/stats/sales"');
    expect(html).toContain('href="/admin/stats/claims"');
    expect(html).toContain('href="/admin/stats/customers"');
  });
  it('집계 실패와 확인된 0건을 구분하고 리뷰 바로가기에 정확한 필터를 전달한다', () => {
    const html = renderToStaticMarkup(<OverviewSection insights={null} reports={[]} summary={{
      claims: { cancel: null, return: 0, exchange: 0 }, goods: { published: 0, soldout: null }, reviews: { total: 0, lowRating: 0, awaitingReply: 0 },
    }} />);
    expect(html).toContain('취소요청</span><strong>확인 필요');
    expect(html).toContain('aria-label="반품요청 0건"');
    expect(html).toContain('반품요청</span><strong>0</strong>');
    expect(html).toContain('href="/admin/cs/reviews?low=1&amp;page=1"');
    expect(html).toContain('href="/admin/cs/reviews?reply=without&amp;page=1"');
  });

  it('홈 배치를 바꾸어도 결제 지표의 의미와 모든 업무 바로가기를 보존한다', () => {
    const workQueue: AdminWorkQueueData = {
      checkedAt: '2026-10-16T00:00:00Z',
      counts: {
        orders: { state: 'ready', count: 3 },
        ready: { state: 'ready', count: 7 },
        delayed: { state: 'ready', count: 2 },
        inquiries: { state: 'ready', count: 4 },
        goods: { state: 'error', count: null },
      },
      goodsReasons: [],
    };
    const html = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} workQueue={workQueue} days={7} />);

    expect(html).toContain('결제 현황');
    expect(html).toContain('dateTime="2026-10-16T00:00:00Z"');
    expect(html).toContain('업무 집계 10. 16. 09:00 기준');
    expect(html).toContain('최근 7일 결제금액');
    expect(html).toContain('₩690,000');
    expect(html).not.toContain('정산예정');
    expect(html).not.toContain('오늘정산');
    expect(html).toContain('aria-label="발송 대기 7건"');
    expect(html).toContain('aria-label="발송 지연 2건"');
    expect(html).toContain('aria-label="미응답 문의 4건"');
    expect(html).toContain('aria-label="상품 검토 대기 확인 필요"');
    expect(html).toContain('href="/admin/sales/dispatch?tab=delayed');
    expect(html).toContain('href="/admin/cs/inquiries?status=open');
    expect(html).toContain('href="/admin/catalog/goods?');
    expect(html).toContain('readiness=review_required');
  });

  it('매출이 없는 기간에는 임의의 숫자 축 대신 빈 상태를 표시한다', () => {
    const empty = { ...insights, dailyRevenue: [{ date: '2026-08-18', goods: 0, tickets: 0 }] };
    const html = renderToStaticMarkup(<OverviewSection insights={empty} reports={[]} />);
    expect(html).toContain('최근 30일 결제 완료 매출이 없습니다.');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('recharts-responsive-container');
    const populated = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} />);
    expect(populated).not.toContain('최근 30일 결제 완료 매출이 없습니다.');
    expect(populated).toContain('recharts-responsive-container');
  });

  it('최근 주문에서도 원 단위 금액을 보존한다', () => {
    const html = renderToStaticMarkup(<RecentOrders orders={[{ id: 'exact-order', kind: 'good', buyerName: '운영연습', total: 13100, status: 'paid', createdAt: '2026-09-08T00:00:00Z' }]} />);
    expect(html).toContain('₩13,100');
    expect(html).not.toContain('₩1만');
  });

  it.each([
    ['pending', '결제 대기'],
    ['paid', '신규주문'],
    ['confirmed', '발주확인'],
    ['shipping', '배송중'],
    ['delivered', '배송완료'],
    ['done', '거래확정'],
    ['canceled', '취소'],
  ] as const)('주문 파이프라인과 최근 상품 주문의 %s를 %s로 표시한다', (status, label) => {
    const html = renderToStaticMarkup(<><OrderPipeline stages={[{ status, count: 1 }]} />
      <RecentOrders orders={[{ id: 'goods-order', kind: 'good', buyerName: '운영연습', total: 10000, status, createdAt: '2026-09-08T00:00:00Z' }]} /></>);

    expect(html.split(`>${label}</span>`)).toHaveLength(3);
    expect(html).not.toContain(`>${status}</span>`);
    expect(html).not.toContain('구매 확정');
    expect(html).toContain('상품 주문 상태 분포');
  });

  it.each([
    ['pending', '결제 대기'],
    ['paid', '결제 완료'],
    ['canceled', '취소'],
  ])('최근 티켓 주문의 %s는 상품 발주 상태와 구분한다', (status, label) => {
    const html = renderToStaticMarkup(<RecentOrders orders={[{ id: 'ticket-order', kind: 'ticket', buyerName: '예매자', total: 20000, status, createdAt: '2026-09-08T00:00:00Z' }]} />);

    expect(html).toContain(`>${label}</span>`);
    expect(html).toContain('티켓 ·');
    expect(html).not.toContain('신규주문');
    expect(html).not.toContain('발주확인');
    expect(html).not.toContain('거래확정');
  });
});
