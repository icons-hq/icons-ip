import { StatsRangeTabs } from '@/components/admin/StatsRangeTabs';
import { ConsoleGrid, type ConsoleGridColumn } from '@/components/admin/console';
import {
  adminClaimReasonLabel,
  adminClaimTypeLabel,
  type AdminClaimsReport,
  type AdminStatsFilters,
} from '@/lib/admin/stats';

const TYPE_COLUMNS: ConsoleGridColumn[] = [
  { key: 'claimType', label: '유형', width: '110px' },
  { key: 'total', label: '접수', align: 'end', width: '90px' },
  { key: 'completed', label: '완료', align: 'end', width: '90px' },
  { key: 'rejected', label: '거절', align: 'end', width: '90px' },
  { key: 'open', label: '진행중', align: 'end', width: '90px' },
  { key: 'rate', label: '주문 1000건당', align: 'end', width: '130px' },
];

const REASON_COLUMNS: ConsoleGridColumn[] = [
  { key: 'claimType', label: '유형', width: '110px' },
  { key: 'reason', label: '사유' },
  { key: 'total', label: '건수', align: 'end', width: '90px' },
];

/**
 * 클레임 통계 — 조회 전용 (#258).
 *
 * 접수 건수만 보면 판매가 늘어난 달과 품질이 나빠진 달을 구분할 수 없다. 그래서
 * 같은 기간의 확정 주문수를 분모로 함께 보여 준다. 판매가 없던 기간은 비율 자리에
 * 0%가 아니라 `—`가 뜬다 — "클레임 없음"과 "판매 없음"은 다른 사실이다.
 *
 * 환급 소요는 접수부터 환불 완료까지다. 배송·반품 정책이 약속한 "반환받은 날부터
 * 3영업일"과 기산점이 다르므로 SLA 준수율이라고 부르지 않는다.
 */
export function StatsClaimsScreen({
  data,
  filters,
}: {
  data: AdminClaimsReport;
  filters: AdminStatsFilters;
}) {
  return (
    <section className="admin-console admin-stats">
      <StatsRangeTabs base="/admin/stats/claims" filters={filters} />

      <div className="admin-stats-summary">
        <div>
          <span>확정 주문</span>
          <strong className="mono">{data.orderCount.toLocaleString('ko-KR')}</strong>
        </div>
        <div>
          <span>클레임 접수</span>
          <strong className="mono">{data.claimCount.toLocaleString('ko-KR')}</strong>
        </div>
        <div>
          <span>환불 완료</span>
          <strong className="mono">{data.refunds.completedCount.toLocaleString('ko-KR')}</strong>
        </div>
        <div>
          <span>접수→환불 평균</span>
          <strong className="mono">
            {data.refunds.averageHours === null ? '—' : `${data.refunds.averageHours}시간`}
          </strong>
        </div>
        <div>
          <span>72시간 내 환불</span>
          <strong className="mono">{data.refunds.within72h.toLocaleString('ko-KR')}건</strong>
        </div>
      </div>

      <h3>유형별 접수와 클레임율</h3>
      <ConsoleGrid
        caption="유형별 클레임"
        columns={TYPE_COLUMNS}
        emptyLabel="이 기간에 접수된 클레임이 없습니다."
        rows={data.byType.map((row) => ({
          id: row.claimType,
          cells: [
            adminClaimTypeLabel(row.claimType),
            row.total.toLocaleString('ko-KR'),
            row.completed.toLocaleString('ko-KR'),
            row.rejected.toLocaleString('ko-KR'),
            row.open.toLocaleString('ko-KR'),
            <span className="mono" key="rate">
              {row.ratePerMille === null ? '—' : row.ratePerMille.toFixed(1)}
            </span>,
          ],
        }))}
      />

      <h3>사유 분포</h3>
      <ConsoleGrid
        caption="클레임 사유 분포"
        columns={REASON_COLUMNS}
        emptyLabel="이 기간에 접수된 클레임이 없습니다."
        rows={data.byReason.map((row) => ({
          id: `${row.claimType}:${row.reasonType}`,
          cells: [
            adminClaimTypeLabel(row.claimType),
            adminClaimReasonLabel(row.reasonType),
            row.total.toLocaleString('ko-KR'),
          ],
        }))}
      />
    </section>
  );
}
