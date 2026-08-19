import { StatsRangeTabs } from '@/components/admin/StatsRangeTabs';
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

      <h3>리뷰</h3>
      <div className="admin-stats-summary">
        <div>
          <span>작성</span>
          <strong className="mono">{data.reviews.total.toLocaleString('ko-KR')}</strong>
        </div>
        <div>
          <span>답글 없음</span>
          <strong className="mono">{data.reviews.unanswered.toLocaleString('ko-KR')}</strong>
        </div>
        <div>
          <span>평균 평점</span>
          <strong className="mono">
            {data.reviews.averageRating === null ? '—' : data.reviews.averageRating.toFixed(2)}
          </strong>
        </div>
      </div>

      {data.reviews.total === 0 ? (
        <p className="admin-note">이 기간에 작성된 리뷰가 없습니다.</p>
      ) : (
        <ul className="admin-stats-share">
          {[5, 4, 3, 2, 1].map((score) => {
            const count = data.reviews.distribution[score - 1] ?? 0;
            return (
              <li key={score}>
                <span>{score}점</span>
                <strong className="mono">{count.toLocaleString('ko-KR')}</strong>
                <span className="mono">
                  {adminPercentLabel(adminRatingShare(count, data.reviews.total))}
                </span>
                <span>{score === 1 || score === 2 ? '불만' : score === 3 ? '보통' : '만족'}</span>
              </li>
            );
          })}
        </ul>
      )}

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

    </section>
  );
}
