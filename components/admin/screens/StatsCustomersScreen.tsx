import { StatsRangeTabs } from '@/components/admin/StatsRangeTabs';
import { ConsoleGrid, type ConsoleGridColumn } from '@/components/admin/console';
import {
  adminPercentLabel,
  adminRepeatRate,
  type AdminCustomerReport,
  type AdminStatsFilters,
} from '@/lib/admin/stats';

const SIGNUP_COLUMNS: ConsoleGridColumn[] = [
  { key: 'date', label: '일자(KST)', width: '130px' },
  { key: 'total', label: '신규 가입', align: 'end', width: '110px' },
];

/**
 * 고객현황 — 조회 전용 (#258).
 *
 * 재구매율은 **기간 내** 정의다. 기간을 넘는 재구매는 이 숫자로 잡히지 않으므로
 * 라벨에 기간을 붙여 둔다 — 그 구분이 없으면 7일 창의 낮은 재구매율을 이탈로
 * 읽는다.
 *
 * 리뷰 지표(평점 분포)는 여기 없다. 리뷰 도메인(#254)이 아직 main에 없어서
 * 조회할 테이블이 없다 — 그 브랜치가 들어온 뒤 이 화면에 한 절을 더한다.
 */
export function StatsCustomersScreen({
  data,
  filters,
}: {
  data: AdminCustomerReport;
  filters: AdminStatsFilters;
}) {
  return (
    <section className="admin-console admin-stats">
      <StatsRangeTabs base="/admin/stats/customers" filters={filters} />

      <div className="admin-stats-summary">
        <div>
          <span>신규 가입</span>
          <strong className="mono">{data.signupTotal.toLocaleString('ko-KR')}</strong>
        </div>
        <div>
          <span>구매 고객</span>
          <strong className="mono">{data.buyerCount.toLocaleString('ko-KR')}</strong>
        </div>
        <div>
          <span>기간 내 재구매</span>
          <strong className="mono">{data.repeatBuyerCount.toLocaleString('ko-KR')}</strong>
        </div>
        <div>
          <span>기간 내 재구매율</span>
          <strong className="mono">
            {adminPercentLabel(adminRepeatRate(data.repeatBuyerCount, data.buyerCount))}
          </strong>
        </div>
      </div>

      <h3>문의</h3>
      <div className="admin-stats-summary">
        <div>
          <span>접수</span>
          <strong className="mono">{data.inquiries.total.toLocaleString('ko-KR')}</strong>
        </div>
        <div>
          <span>미답변</span>
          <strong className="mono">{data.inquiries.unanswered.toLocaleString('ko-KR')}</strong>
        </div>
        <div>
          <span>평균 1차 응답</span>
          <strong className="mono">
            {data.inquiries.averageFirstResponseHours === null
              ? '—'
              : `${data.inquiries.averageFirstResponseHours}시간`}
          </strong>
        </div>
      </div>

      <h3>신규 가입 추이</h3>
      <ConsoleGrid
        caption="신규 가입 추이"
        columns={SIGNUP_COLUMNS}
        emptyLabel="이 기간에 신규 가입이 없습니다."
        rows={data.signups.map((row) => ({
          id: row.date,
          cells: [
            <span className="mono" key="date">{row.date}</span>,
            row.total.toLocaleString('ko-KR'),
          ],
        }))}
      />

      <p className="admin-note">
        리뷰 지표(평점 분포·리뷰 수)는 리뷰 도메인이 들어온 뒤 이 화면에 더합니다.
      </p>
    </section>
  );
}
