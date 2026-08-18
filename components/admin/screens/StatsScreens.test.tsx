import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  AdminClaimsReport,
  AdminCustomerReport,
  AdminSalesReport,
  AdminStatsFilters,
} from '@/lib/admin/stats';
import { StatsClaimsScreen } from './StatsClaimsScreen';
import { StatsCustomersScreen } from './StatsCustomersScreen';
import { StatsSalesScreen } from './StatsSalesScreen';

const filters: AdminStatsFilters = { days: 30, ipId: '' };

const sales: AdminSalesReport = {
  daily: [
    { date: '2026-08-16', orderCount: 1, revenue: 13000, averageOrderValue: 13000 },
    { date: '2026-08-17', orderCount: 2, revenue: 56000, averageOrderValue: 28000 },
  ],
  paymentMethods: [
    { method: 'card', orderCount: 2, revenue: 46000 },
    { method: 'bank_transfer', orderCount: 1, revenue: 23000 },
  ],
  goods: [
    { goodId: 'g1', name: '통계 굿즈 A', ipId: 'stats-ip', qty: 3, revenue: 30000 },
  ],
  tickets: [
    { eventId: 'e1', eventTitle: '팝업 이벤트', orderCount: 1, ticketCount: 2, revenue: 40000 },
  ],
};

describe('StatsSalesScreen', () => {
  it('기간 합계와 객단가를 요약으로 먼저 보여준다', () => {
    const html = renderToStaticMarkup(<StatsSalesScreen data={sales} filters={filters} />);

    expect(html).toContain('69,000');
    expect(html).toContain('23,000');
  });

  /* 무통장 도입(#256) 뒤 재고 선점 시간의 실제 비용을 보여 주는 유일한 자리다. */
  it('카드와 무통장을 이름과 구성비로 가른다', () => {
    const html = renderToStaticMarkup(<StatsSalesScreen data={sales} filters={filters} />);

    expect(html).toContain('신용·체크카드');
    expect(html).toContain('무통장 입금');
    expect(html).toContain('66.7%');
    expect(html).toContain('33.3%');
  });

  /* 굿즈는 재고·배송 축, 티켓은 이벤트 축이다. 합치면 무엇이 늘었는지 못 읽는다. */
  it('굿즈 순위와 티켓 매출을 나눠 그린다', () => {
    const html = renderToStaticMarkup(<StatsSalesScreen data={sales} filters={filters} />);

    expect(html).toContain('굿즈별 판매 순위');
    expect(html).toContain('티켓 매출');
    expect(html).toContain('팝업 이벤트');
  });

  it('데이터가 없어도 빈 상태를 말한다', () => {
    const html = renderToStaticMarkup(
      <StatsSalesScreen
        data={{ daily: [], paymentMethods: [], goods: [], tickets: [] }}
        filters={filters}
      />,
    );

    expect(html).toContain('이 기간에 확정된 주문이 없습니다');
    expect(html).toContain('이 기간에 판매된 굿즈가 없습니다');
  });
});

const claims: AdminClaimsReport = {
  orderCount: 3,
  claimCount: 2,
  byType: [
    { claimType: 'cancel', total: 1, completed: 1, rejected: 0, open: 0, ratePerMille: 333.3 },
    { claimType: 'return', total: 1, completed: 0, rejected: 0, open: 1, ratePerMille: 333.3 },
  ],
  byReason: [
    { claimType: 'cancel', reasonType: 'change_of_mind', total: 1 },
    { claimType: 'return', reasonType: 'defect', total: 1 },
  ],
  refunds: { completedCount: 1, averageHours: 10, within72h: 1 },
};

describe('StatsClaimsScreen', () => {
  it('유형·사유·환급 소요를 한 화면에 둔다', () => {
    const html = renderToStaticMarkup(<StatsClaimsScreen data={claims} filters={filters} />);

    expect(html).toContain('취소');
    expect(html).toContain('반품');
    expect(html).toContain('단순 변심');
    expect(html).toContain('하자·오배송');
    expect(html).toContain('10시간');
  });

  /* 판매가 없던 기간의 클레임율은 0%가 아니라 값 없음이다. */
  it('클레임율 분모가 없으면 비율 대신 값 없음을 적는다', () => {
    const html = renderToStaticMarkup(
      <StatsClaimsScreen
        data={{
          ...claims,
          orderCount: 0,
          byType: [{ claimType: 'cancel', total: 1, completed: 0, rejected: 0, open: 1, ratePerMille: null }],
          refunds: { completedCount: 0, averageHours: null, within72h: 0 },
        }}
        filters={filters}
      />,
    );

    expect(html).toContain('—');
    expect(html).not.toContain('0.0%');
  });
});

const customers: AdminCustomerReport = {
  signups: [{ date: '2026-08-16', total: 2 }],
  signupTotal: 2,
  buyerCount: 2,
  repeatBuyerCount: 1,
  inquiries: { total: 2, unanswered: 1, averageFirstResponseHours: 4 },
};

describe('StatsCustomersScreen', () => {
  it('가입·구매·문의 지표를 함께 보여준다', () => {
    const html = renderToStaticMarkup(
      <StatsCustomersScreen data={customers} filters={filters} />,
    );

    expect(html).toContain('신규 가입');
    expect(html).toContain('50.0%');
    expect(html).toContain('4시간');
  });

  /*
   * 기간 내 정의라는 것이 라벨에 없으면 7일 창의 낮은 재구매율을 이탈로 읽는다.
   */
  it('재구매율이 기간 내 정의임을 라벨로 밝힌다', () => {
    const html = renderToStaticMarkup(
      <StatsCustomersScreen data={customers} filters={filters} />,
    );

    expect(html).toContain('기간 내 재구매율');
  });

  /* 리뷰 도메인(#254)이 아직 없다는 사실을 화면이 숨기지 않는다. */
  it('리뷰 지표가 아직 없다는 것을 말한다', () => {
    const html = renderToStaticMarkup(
      <StatsCustomersScreen data={customers} filters={filters} />,
    );

    expect(html).toContain('리뷰 지표');
  });
});
