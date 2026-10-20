/* eslint-disable @next/next/no-img-element -- Public catalog thumbnails reserve fixed dimensions and keep the stored aspect ratio. */
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { publicMediaUrl } from '@/lib/media';
import { reviewRatingComparisonText, type ReviewRatingHistoryResult } from '@/lib/admin/review-rating-history';
import { REVIEW_INSIGHTS_PATH, REVIEW_INSIGHT_FOCUSES, REVIEW_INSIGHT_LABELS, reviewInsightHref, type ReviewInsightFilters, type ReviewInsights } from '@/lib/admin/review-insights';

const rate=(value: number | null) => value===null ? '—' : `${value.toFixed(1)}%`;
const rating=(value: number | null) => value===null ? '—' : value.toFixed(2);
export function ReviewInsightsScreen({ data,filters,history = { kind: 'error' } }: { data: ReviewInsights; filters: ReviewInsightFilters; history?: ReviewRatingHistoryResult }) {
  const past = history.kind === 'ready' ? history.data.observation : null;
  const observedAt = past ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(past.observedAt)) : null;
  return <section className="admin-review-insights wc-admin-kit">
    <div className="admin-review-insights__summary">
      <div><span>새로 작성된 리뷰</span><strong>{data.summary.newReviews.toLocaleString('ko-KR')}건</strong><small>어제부터 현재까지</small></div>
      <div><span>새로 작성된 3점 이하 리뷰</span><strong>{data.summary.newLowReviews.toLocaleString('ko-KR')}건</strong><small>어제부터 현재까지</small></div>
      <div><span>내 상품 평균 평점</span><strong>{rating(data.summary.averageRating)}</strong><small>상품별 평균의 평균</small><small>{reviewRatingComparisonText(data.summary.averageRating, history, 'averageRating')}</small></div>
      <div><span>내 상품 최근 6개월 평균 평점</span><strong>{rating(data.summary.sixMonthRating)}</strong><small>상품별 평균의 평균</small><small>{reviewRatingComparisonText(data.summary.sixMonthRating, history, 'sixMonthRating')}</small></div>
    </div>
    <nav className="admin-review-insights__topics" aria-label="리뷰 분석 주제">{REVIEW_INSIGHT_FOCUSES.map(focus=><Link key={focus} aria-current={filters.focus===focus ? 'page' : undefined} href={reviewInsightHref(filters,{focus,page:1})}><Icon name={focus==='rating' ? 'star' : focus==='photo' ? 'image' : focus==='unanswered' ? 'chat' : 'trendUp'} size={22}/><span>{REVIEW_INSIGHT_LABELS[focus]}<strong>{data.counts[focus].toLocaleString('ko-KR')}개</strong></span></Link>)}</nav>
    <div className="admin-review-insights__benchmarks"><p>내 스토어 사진 리뷰 비중 <strong>{rate(data.summary.photoRate)}</strong></p><p>배송완료 상품주문 대비 작성률 <strong>{rate(data.summary.coverageRate)}</strong></p><p>{data.asOf} 기준 · 한국시간</p></div>
    <details className="admin-review-insights__definitions"><summary>집계 기준과 진단 조건</summary><ul>
      <li>상품과 IP가 현재 공개·미보관인 상품을 집계하며 품절 상품도 포함합니다. 평점·사진 비중·미답글은 어제까지 작성된 현재 공개 리뷰 기준입니다. 삭제·블라인드와 공개 상태 변경은 다음 조회에 반영됩니다.</li>
      <li>사진 리뷰 비중은 사진이 있는 리뷰 수 ÷ 전체 공개 리뷰 수입니다. 내 스토어 전체 비중보다 낮은 상품을 표시합니다. 리뷰가 없는 상품은 사진 비중 진단에서 제외합니다.</li>
      <li>작성률은 {data.cohortFrom}~{data.asOf} 배송완료 주문의 상품 중 리뷰가 작성된 비율입니다. 같은 주문의 동일 상품은 옵션·입력 문구와 관계없이 1건입니다. 블라인드한 리뷰도 작성 사실에 포함하며 취소된 주문은 제외합니다.</li>
      <li>주문 대비 리뷰가 적은 상품은 내 스토어 전체 작성률보다 낮은 상품입니다. 배송완료 기록이 없는 상품은 제외합니다. 3점 이하 신규 리뷰와 상품 평균 4.6 미만은 서로 다른 지표입니다.</li>
      <li>평점은 리뷰가 있는 상품별 평균을 다시 평균합니다. 내 스토어 기준은 검색어와 무관하며 진단 건수·목록에만 검색 조건을 적용합니다.</li>
      <li>3개월 전 비교는 현재 기준일에서 달력 3개월을 뺀 같은 날짜의 첫 성공 관측값을 사용합니다. 현재 평점은 지금 공개 상태로 다시 집계하며 과거 평점은 관측 당시 상태를 보존합니다. 날짜를 놓친 기록은 다른 날이나 현재 데이터로 채우지 않습니다.</li>
      {history.kind === 'ready' ? <li>비교 기준일: 현재 {history.data.asOf} / 3개월 전 {history.data.comparisonAsOf}. {past ? <>과거 관측 시각: {observedAt} 한국시간. 전체 평점 {rating(past.averageRating)} (상품 {past.ratedProductCount.toLocaleString('ko-KR')}개, 공개 리뷰 {past.reviewCount.toLocaleString('ko-KR')}건), 최근 6개월 평점 {rating(past.sixMonthRating)} (상품 {past.sixMonthRatedProductCount.toLocaleString('ko-KR')}개, 공개 리뷰 {past.sixMonthReviewCount.toLocaleString('ko-KR')}건; {past.sixMonthFrom}~{past.asOf}).</> : reviewRatingComparisonText(data.summary.averageRating, history, 'averageRating')}</li> : <li>과거 비교를 불러오지 못했습니다. 현재 평점과 상품 목록은 조회한 값입니다.</li>}
    </ul></details>
    <section className="admin-review-insights__results"><header><h2>리뷰 관리하면 좋을 상품 <span>(총 {data.total.toLocaleString('ko-KR')}개)</span></h2>
      <form action={REVIEW_INSIGHTS_PATH} method="get"><input type="hidden" name="focus" value={filters.focus}/><label>상품명·상품번호<input name="q" defaultValue={filters.query} maxLength={100}/></label><label>정렬<select name="sort" defaultValue={filters.sort}><option value="analysis">분석 결과순</option><option value="reviews">리뷰 많은순</option><option value="rating">평점 낮은순</option></select></label><label>목록수<select name="size" defaultValue={filters.pageSize}><option value="20">20개씩</option><option value="50">50개씩</option><option value="100">100개씩</option></select></label><button type="submit">조회</button></form></header>
      {!data.rows.length ? <p className="admin-review-insights__empty">조건에 맞는 상품이 없습니다.</p> : <ul className="admin-review-insights__products">{data.rows.map(row=><li key={row.id}>
        <div className="admin-review-insights__image">{row.imagePath ? <img src={publicMediaUrl(row.imagePath) ?? ''} alt=""/> : <Icon name="image" size={40}/>}</div>
        <div><Link href={`/admin/catalog/goods?goodId=${encodeURIComponent(row.id)}`}>{row.name}</Link><small>{row.id}</small><strong>₩{row.price.toLocaleString('ko-KR')}</strong><span>평점 {rating(row.averageRating)} · 리뷰 {row.reviewCount.toLocaleString('ko-KR')}개</span></div>
        <dl><div><dt>사진 리뷰 비중</dt><dd>{rate(row.photoRate)}</dd></div><div><dt>배송완료 대비 작성률</dt><dd>{rate(row.coverageRate)}</dd></div><div><dt>미작성 상품주문</dt><dd>{(row.deliveredCount-row.reviewedCount).toLocaleString('ko-KR')}건</dd></div><div><dt>미답글 리뷰</dt><dd>{row.unansweredCount.toLocaleString('ko-KR')}건</dd></div></dl>
        <Link className="admin-review-insights__action" href={`/admin/cs/reviews?field=good&query=${encodeURIComponent(row.name)}&status=visible`}>리뷰 조회 및 관리</Link>
      </li>)}</ul>}
      <nav className="admin-review-insights__pagination" aria-label="리뷰 분석 페이지">{data.page>1 ? <Link href={reviewInsightHref(filters,{page:data.page-1})}>이전</Link> : <span>이전</span>}<span>{data.page} / {Math.max(1,Math.ceil(data.total/data.pageSize))}</span>{data.page*data.pageSize<data.total ? <Link href={reviewInsightHref(filters,{page:data.page+1})}>다음</Link> : <span>다음</span>}</nav>
    </section>
  </section>;
}
