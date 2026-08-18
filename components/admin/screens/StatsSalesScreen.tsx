import { StatsRangeTabs } from '@/components/admin/StatsRangeTabs';
import { ConsoleGrid, type ConsoleGridColumn } from '@/components/admin/console';
import {
  adminPaymentMethodLabel,
  adminPercentLabel,
  adminShareOfTotal,
  type AdminSalesReport,
  type AdminStatsFilters,
} from '@/lib/admin/stats';
import { krw } from '@/lib/format';

const DAILY_COLUMNS: ConsoleGridColumn[] = [
  { key: 'date', label: '일자(KST)', width: '130px' },
  { key: 'orderCount', label: '주문수', align: 'end', width: '90px' },
  { key: 'revenue', label: '매출', align: 'end', width: '130px' },
  { key: 'aov', label: '객단가', align: 'end', width: '130px' },
];

const GOODS_COLUMNS: ConsoleGridColumn[] = [
  { key: 'name', label: '굿즈' },
  { key: 'ip', label: 'IP', width: '140px' },
  { key: 'qty', label: '수량', align: 'end', width: '90px' },
  { key: 'revenue', label: '금액', align: 'end', width: '130px' },
];

const TICKET_COLUMNS: ConsoleGridColumn[] = [
  { key: 'event', label: '이벤트' },
  { key: 'orderCount', label: '예매 건수', align: 'end', width: '110px' },
  { key: 'ticketCount', label: '티켓 수', align: 'end', width: '100px' },
  { key: 'revenue', label: '매출', align: 'end', width: '130px' },
];

/**
 * 판매분석 — 조회 전용 (#258).
 *
 * 굿즈와 티켓을 한 표에 섞지 않는다. 굿즈는 재고·배송 축이고 티켓은 이벤트·회차
 * 축이라, 합쳐 놓으면 "매출은 늘었는데 무엇이 늘었는지"를 읽을 수 없다.
 *
 * 결제수단별 비중은 카드와 무통장을 가른다 — 무통장 도입(#256) 뒤 이 숫자가
 * 재고 선점 시간(15분 vs 24시간)의 실제 비용을 보여 주는 유일한 자리다.
 */
export function StatsSalesScreen({
  data,
  filters,
}: {
  data: AdminSalesReport;
  filters: AdminStatsFilters;
}) {
  const totalRevenue = data.daily.reduce((sum, row) => sum + row.revenue, 0);
  const totalOrders = data.daily.reduce((sum, row) => sum + row.orderCount, 0);

  return (
    <section className="admin-console admin-stats">
      <StatsRangeTabs base="/admin/stats/sales" filters={filters} />

      <div className="admin-stats-summary">
        <div><span>기간 매출</span><strong className="mono">{krw(totalRevenue)}</strong></div>
        <div><span>주문수</span><strong className="mono">{totalOrders.toLocaleString('ko-KR')}</strong></div>
        <div>
          <span>객단가</span>
          <strong className="mono">
            {krw(totalOrders > 0 ? Math.floor(totalRevenue / totalOrders) : 0)}
          </strong>
        </div>
      </div>

      <h3>결제수단별 비중</h3>
      {data.paymentMethods.length === 0 ? (
        <p className="admin-note">이 기간에 확정된 주문이 없습니다.</p>
      ) : (
        <ul className="admin-stats-share">
          {data.paymentMethods.map((row) => (
            <li key={row.method}>
              <span>{adminPaymentMethodLabel(row.method)}</span>
              <strong className="mono">{krw(row.revenue)}</strong>
              <span className="mono">{adminPercentLabel(adminShareOfTotal(row.revenue, totalRevenue))}</span>
              <span>{row.orderCount.toLocaleString('ko-KR')}건</span>
            </li>
          ))}
        </ul>
      )}

      <h3>일별 매출</h3>
      <ConsoleGrid
        caption="일별 매출"
        columns={DAILY_COLUMNS}
        emptyLabel="이 기간에 확정된 주문이 없습니다."
        rows={data.daily.map((row) => ({
          id: row.date,
          cells: [
            <span className="mono" key="date">{row.date}</span>,
            row.orderCount.toLocaleString('ko-KR'),
            <span className="mono" key="revenue">{krw(row.revenue)}</span>,
            <span className="mono" key="aov">{krw(row.averageOrderValue)}</span>,
          ],
        }))}
      />

      <h3>굿즈별 판매 순위{filters.ipId ? ` · ${filters.ipId}` : ''}</h3>
      <ConsoleGrid
        caption="굿즈별 판매 순위"
        columns={GOODS_COLUMNS}
        emptyLabel="이 기간에 판매된 굿즈가 없습니다."
        rows={data.goods.map((row) => ({
          id: row.goodId,
          cells: [
            row.name,
            row.ipId,
            row.qty.toLocaleString('ko-KR'),
            <span className="mono" key="revenue">{krw(row.revenue)}</span>,
          ],
        }))}
      />

      <h3>티켓 매출</h3>
      <ConsoleGrid
        caption="티켓 매출"
        columns={TICKET_COLUMNS}
        emptyLabel="이 기간에 확정된 예매가 없습니다."
        rows={data.tickets.map((row) => ({
          id: row.eventId,
          cells: [
            row.eventTitle,
            row.orderCount.toLocaleString('ko-KR'),
            row.ticketCount.toLocaleString('ko-KR'),
            <span className="mono" key="revenue">{krw(row.revenue)}</span>,
          ],
        }))}
      />
    </section>
  );
}
