import { StatsComparison, StatsRateChange } from '@/components/admin/StatsComparison';
import { adminSalesTrend } from '@/lib/admin/stats';
import { StatsRangeTabs } from '@/components/admin/StatsRangeTabs';
import { STATS_NOTE, StatsChangeBadge, StatsSection, StatsSummaryGrid, StatsSummaryTile, statsChangeDirection, statsDateLabel } from '@/components/admin/StatsSummary';
import { ConsoleGrid, type ConsoleGridColumn } from '@/components/admin/console';
import {
  adminPercentLabel,
  adminRatingShare,
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
 * 리뷰 평균은 공개 표면(`good_review_stats`)과 같은 기준이다 — 블라인드된 리뷰는
 * 빠진다. 두 곳이 다른 평균을 말하면 운영자가 구매자 화면을 신뢰하지 못한다.
 */
export function StatsCustomersScreen({
  data,
  filters,
  comparison,
  now = new Date(),
}: {
  data: AdminCustomerReport;
  filters: AdminStatsFilters;
  now?: Date;
  comparison?: AdminCustomerReport | null;
}) {
  const repeatRate = adminRepeatRate(data.repeatBuyerCount, data.buyerCount);
  const previousRepeatRate = comparison ? adminRepeatRate(comparison.repeatBuyerCount, comparison.buyerCount) : null;
  const repeatRateChange = repeatRate !== null && previousRepeatRate !== null ? Math.round((repeatRate - previousRepeatRate) * 10) / 10 : null;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-stats-screen="customers">
      <StatsRangeTabs base="/admin/stats/customers" filters={filters} now={now} />

      <StatsSummaryGrid>
        <StatsSummaryTile label="신규 가입" value={data.signupTotal.toLocaleString('ko-KR')}>{comparison ? <StatsRateChange current={data.signupTotal} previous={comparison.signupTotal} /> : null}</StatsSummaryTile>
        <StatsSummaryTile label="구매 고객" value={data.buyerCount.toLocaleString('ko-KR')}>{comparison ? <StatsRateChange current={data.buyerCount} previous={comparison.buyerCount} /> : null}</StatsSummaryTile>
        <StatsSummaryTile label="기간 내 재구매" value={data.repeatBuyerCount.toLocaleString('ko-KR')}>{comparison ? <StatsRateChange current={data.repeatBuyerCount} previous={comparison.repeatBuyerCount} /> : null}</StatsSummaryTile>
        <StatsSummaryTile label="기간 내 재구매율" value={adminPercentLabel(repeatRate)}>{repeatRateChange === null ? null : <StatsChangeBadge direction={statsChangeDirection(repeatRateChange, 0)}>{`${repeatRateChange > 0 ? '+' : ''}${repeatRateChange.toFixed(1)}%p`}</StatsChangeBadge>}</StatsSummaryTile>
      </StatsSummaryGrid>

      {comparison ? <StatsComparison filters={filters} now={now} rows={[
        { label: '신규 가입', current: data.signupTotal, previous: comparison.signupTotal, unit: '명' },
        { label: '구매 고객', current: data.buyerCount, previous: comparison.buyerCount, unit: '명' },
        { label: '기간 내 재구매', current: data.repeatBuyerCount, previous: comparison.repeatBuyerCount, unit: '명' },
      ]} /> : null}
      <StatsSection title="문의">
        <StatsSummaryGrid>
          <StatsSummaryTile label="접수" value={data.inquiries.total.toLocaleString('ko-KR')} />
          <StatsSummaryTile href={data.inquiries.unanswered > 0 ? '/admin/cs/inquiries?status=open' : undefined} label="미답변" tone={data.inquiries.unanswered > 0 ? 'warning' : undefined} value={data.inquiries.unanswered.toLocaleString('ko-KR')} />
          <StatsSummaryTile label="평균 1차 응답" value={data.inquiries.averageFirstResponseHours === null
            ? '—'
            : `${data.inquiries.averageFirstResponseHours}시간`} />
        </StatsSummaryGrid>
      </StatsSection>

      <StatsSection title="리뷰">
        <StatsSummaryGrid>
          <StatsSummaryTile label="작성" value={data.reviews.total.toLocaleString('ko-KR')} />
          <StatsSummaryTile href={data.reviews.unanswered > 0 ? '/admin/cs/reviews?reply=without&status=visible' : undefined} label="답글 없음" tone={data.reviews.unanswered > 0 ? 'warning' : undefined} value={data.reviews.unanswered.toLocaleString('ko-KR')} />
          <StatsSummaryTile label="평균 평점" value={data.reviews.averageRating === null ? '—' : data.reviews.averageRating.toFixed(2)} />
        </StatsSummaryGrid>

        {data.reviews.total === 0 ? (
          <p className={STATS_NOTE}>이 기간에 작성된 리뷰가 없습니다.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {[5, 4, 3, 2, 1].map((score) => {
              const count = data.reviews.distribution[score - 1] ?? 0;
              const share = adminRatingShare(count, data.reviews.total);
              const unhappy = score <= 2;
              return (
                <li className="grid grid-cols-[2.5rem_minmax(0,1fr)_3rem_3.5rem_2.5rem] items-center gap-x-3 px-4 py-2.5" key={score}>
                  <span className="font-medium">{score}점</span>
                  {/* 숫자만으로는 비율이 안 들어온다. 불만 구간만 색을 켠다. */}
                  <span aria-hidden="true" className="h-2 min-w-0 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${unhappy ? 'bg-destructive' : 'bg-muted-foreground/40'}`} style={{ width: `${share ?? 0}%` }} /></span>
                  <strong className="text-right font-semibold tabular-nums">{count.toLocaleString('ko-KR')}</strong>
                  <span className="text-right text-muted-foreground tabular-nums">{adminPercentLabel(share)}</span>
                  <span className={`text-right text-xs ${unhappy ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{unhappy ? '불만' : score === 3 ? '보통' : '만족'}</span>
                </li>
              );
            })}
          </ul>
        )}
      </StatsSection>

      <StatsSection title="신규 가입 추이">
        <ConsoleGrid
          caption="신규 가입 추이"
          columns={SIGNUP_COLUMNS}
          emptyLabel="이 기간에 신규 가입이 없습니다."
          rows={adminSalesTrend(data.signups.map(row => ({ date: row.date, orderCount: row.total, revenue: 0, averageOrderValue: 0 })), filters, now).map((row) => ({
            id: row.date,
            cells: [
              <span className="tabular-nums" key="date">{statsDateLabel(row.date)}</span>,
              row.orderCount.toLocaleString('ko-KR'),
            ],
          }))}
        />
      </StatsSection>
    </div>
  );
}
