import { ADMIN_VOCABULARY as V } from '@/lib/admin/vocabulary';
import { StatsComparison, StatsRateChange } from '@/components/admin/StatsComparison';
import { StatsRangeTabs } from '@/components/admin/StatsRangeTabs';
import { StatsSection, StatsSummaryGrid, StatsSummaryTile } from '@/components/admin/StatsSummary';
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
  { key: 'withdrawn', label: '요청 철회', align: 'end', width: '100px' },
  { key: 'open', label: '진행중', align: 'end', width: '90px' },
  { key: 'rate', label: '주문 1000건당', align: 'end', width: '130px' },
];

/* 처리 화면. 유형 칸이 그 목록으로 가는 링크다. */
const CLAIM_LISTS: Record<string, string> = {
  cancel: '/admin/sales/claims/cancels',
  return: '/admin/sales/claims/returns',
  exchange: '/admin/sales/claims/exchanges',
};

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
  comparison,
  now = new Date(),
}: {
  data: AdminClaimsReport;
  filters: AdminStatsFilters;
  now?: Date;
  comparison?: AdminClaimsReport | null;
}) {
  const openTotal = data.byType.reduce((total, row) => total + row.open, 0);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-stats-screen="claims">
      <StatsRangeTabs base="/admin/stats/claims" filters={filters} now={now} />

      <StatsSummaryGrid>
        <StatsSummaryTile label="확정 주문" value={data.orderCount.toLocaleString('ko-KR')}>{comparison ? <StatsRateChange current={data.orderCount} previous={comparison.orderCount} /> : null}</StatsSummaryTile>
        <StatsSummaryTile label={`${V.claimRequest} 접수`} value={data.claimCount.toLocaleString('ko-KR')}>{comparison ? <StatsRateChange current={data.claimCount} polarity="lower" previous={comparison.claimCount} /> : null}</StatsSummaryTile>
        <StatsSummaryTile label="진행중" tone={openTotal > 0 ? 'warning' : undefined} value={openTotal.toLocaleString('ko-KR')} />
        <StatsSummaryTile label="환불 완료" value={data.refunds.completedCount.toLocaleString('ko-KR')}>{comparison ? <StatsRateChange current={data.refunds.completedCount} polarity="none" previous={comparison.refunds.completedCount} /> : null}</StatsSummaryTile>
        <StatsSummaryTile label="접수→환불 평균" value={data.refunds.averageHours === null ? '—' : `${data.refunds.averageHours}시간`}>{comparison && data.refunds.averageHours !== null && comparison.refunds.averageHours !== null ? <StatsRateChange current={data.refunds.averageHours} polarity="lower" previous={comparison.refunds.averageHours} /> : null}</StatsSummaryTile>
        <StatsSummaryTile label="72시간 내 환불" value={`${data.refunds.within72h.toLocaleString('ko-KR')}건`}>{comparison ? <StatsRateChange current={data.refunds.within72h} previous={comparison.refunds.within72h} /> : null}</StatsSummaryTile>
      </StatsSummaryGrid>

      {comparison ? <StatsComparison filters={filters} now={now} rows={[
        { label: '클레임 접수', current: data.claimCount, previous: comparison.claimCount, unit: '건', polarity: 'lower' },
        { label: '환불 완료', current: data.refunds.completedCount, previous: comparison.refunds.completedCount, unit: '건', polarity: 'none' },
      ]} /> : null}
      <StatsSection title={`유형별 접수와 ${V.claimRate}`}>
        <ConsoleGrid
          caption={`유형별 ${V.claimRequest}`}
          columns={TYPE_COLUMNS}
          emptyLabel={`이 기간에 접수된 ${V.claimRequest}이 없습니다.`}
          rows={data.byType.map((row) => ({
            id: row.claimType,
            href: CLAIM_LISTS[row.claimType],
            cells: [
              adminClaimTypeLabel(row.claimType),
              row.total.toLocaleString('ko-KR'),
              row.completed.toLocaleString('ko-KR'),
              row.rejected.toLocaleString('ko-KR'),
              row.withdrawn.toLocaleString('ko-KR'),
              /* 진행중은 지금 밀린 일감이다 — 다른 집계 숫자와 달리 밝힌다. */
              row.open > 0 ? <strong className="font-semibold text-warning tabular-nums" key="open">{row.open.toLocaleString('ko-KR')}</strong> : '0',
              row.ratePerMille === null ? '—' : row.ratePerMille.toFixed(1),
            ],
          }))}
        />
      </StatsSection>

      <StatsSection title="사유 분포">
        <ConsoleGrid
          caption={`${V.claimRequest} 사유 분포`}
          columns={REASON_COLUMNS}
          emptyLabel={`이 기간에 접수된 ${V.claimRequest}이 없습니다.`}
          rows={data.byReason.map((row) => ({
            id: `${row.claimType}:${row.reasonType}:${row.staffReasonCode ?? ''}`,
            cells: [
              adminClaimTypeLabel(row.claimType),
              adminClaimReasonLabel(row.reasonType, row.staffReasonCode ?? null),
              row.total.toLocaleString('ko-KR'),
            ],
          }))}
        />
      </StatsSection>
    </div>
  );
}
