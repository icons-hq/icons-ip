/* eslint-disable @next/next/no-img-element -- Public catalog thumbnails reserve fixed dimensions and keep the stored aspect ratio. */
import Link from 'next/link';
import { Image as ImageIcon, LayoutGrid, MessageSquare, Star, TrendingUp, type LucideIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { publicMediaUrl } from '@/lib/media';
import { reviewRatingComparisonText, type ReviewRatingHistoryResult } from '@/lib/admin/review-rating-history';
import { REVIEW_INSIGHTS_PATH, REVIEW_INSIGHT_FOCUSES, REVIEW_INSIGHT_LABELS, reviewInsightHref, type ReviewInsightFilters, type ReviewInsightFocus, type ReviewInsights } from '@/lib/admin/review-insights';
import { FIELD_LABEL_CLASS } from './cs-kit-classes';
import { ConsolePagination } from '../console/ConsolePagination';
import { AdminCountCard, type AdminCountTone } from '../console/AdminCountCard';

const rate=(value: number | null) => value===null ? '—' : `${value.toFixed(1)}%`;
const rating=(value: number | null) => value===null ? '—' : value.toFixed(2);
const FOCUS_ICONS: Record<ReviewInsightFocus, LucideIcon> = { all: LayoutGrid, photo: ImageIcon, coverage: TrendingUp, rating: Star, unanswered: MessageSquare };
/* 지금 손댈 수 있는 진단(미답글·평점 미달)만 주의색이고, 나머지 진단은 기본 모양이다. */
const FOCUS_TONES: Record<ReviewInsightFocus, AdminCountTone> = { all: 'default', photo: 'default', coverage: 'default', rating: 'warning', unanswered: 'warning' };

function Stat({ label, value, tone, notes }: { label: string; value: string; tone?: 'danger'; notes: string[] }) {
  return <div className="flex min-w-0 flex-col gap-0.5"><span className="text-xs text-muted-foreground">{label}</span><strong className={`text-xl leading-tight font-semibold tabular-nums ${tone === 'danger' ? 'text-destructive' : 'text-foreground'}`}>{value}</strong>{notes.map(note => <small className="text-xs text-muted-foreground wrap-anywhere" key={note}>{note}</small>)}</div>;
}

/** 내 스토어 전체 값보다 낮은 상품의 수치. 색만으로 말하지 않도록 글자를 함께 붙인다. */
function BelowAverage({ value, base, children }: { value: number | null; base: number | null; children: string }) {
  const below = value !== null && base !== null && value < base;
  return <dd className={`mt-1 text-base font-semibold tabular-nums ${below ? 'text-warning' : ''}`}>{children}{below ? <small className="ml-1.5 text-xs font-normal">평균 미만</small> : null}</dd>;
}

/* 템플릿 룩(ADR-0028): 요약 카드 → 진단 주제 → 기준 → 상품 목록 카드. 조회 키(focus·q·sort·size·page)는 그대로다. */
export function ReviewInsightsScreen({ data,filters,history = { kind: 'error' } }: { data: ReviewInsights; filters: ReviewInsightFilters; history?: ReviewRatingHistoryResult }) {
  const past = history.kind === 'ready' ? history.data.observation : null;
  const observedAt = past ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(past.observedAt)) : null;
  return <div className="flex min-w-0 flex-col gap-4" data-review-insights="">
    {/* 스토어 전체 현황은 한 카드에 모은다 — 박스가 층층이 쌓이면 어디부터 볼지 알 수 없다. */}
    <section aria-label="스토어 리뷰 현황" className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border bg-card p-4 text-card-foreground md:grid-cols-3 xl:grid-cols-6">
      <Stat label="새로 작성된 리뷰" notes={['어제부터 현재까지']} value={`${data.summary.newReviews.toLocaleString('ko-KR')}건`} />
      <Stat label="새로 작성된 3점 이하 리뷰" notes={['어제부터 현재까지']} tone={data.summary.newLowReviews > 0 ? 'danger' : undefined} value={`${data.summary.newLowReviews.toLocaleString('ko-KR')}건`} />
      <Stat label="내 상품 평균 평점" notes={['상품별 평균의 평균', reviewRatingComparisonText(data.summary.averageRating, history, 'averageRating')]} value={rating(data.summary.averageRating)} />
      <Stat label="내 상품 최근 6개월 평균 평점" notes={['상품별 평균의 평균', reviewRatingComparisonText(data.summary.sixMonthRating, history, 'sixMonthRating')]} value={rating(data.summary.sixMonthRating)} />
      <Stat label="내 스토어 사진 리뷰 비중" notes={[]} value={rate(data.summary.photoRate)} />
      <Stat label="배송완료 상품주문 대비 작성률" notes={[]} value={rate(data.summary.coverageRate)} />
    </section>
    {/* 진단 이름이 길어 다섯 칸은 폭이 충분할 때만 쓴다(건수 카드의 라벨은 한 줄로 잘린다). 분기점은 rem이어야 sm:보다 뒤에 나온다 — px 임의값은 앞에 나와 무시된다. */}
    <nav className="grid grid-cols-1 gap-2 sm:grid-cols-3 min-[87.5rem]:grid-cols-5" aria-label="리뷰 분석 주제">{REVIEW_INSIGHT_FOCUSES.map(focus => <AdminCountCard active={filters.focus===focus && focus!=='all'} count={data.counts[focus]} current="page" href={reviewInsightHref(filters,{focus,page:1})} icon={FOCUS_ICONS[focus]} key={focus} label={REVIEW_INSIGHT_LABELS[focus]} tone={FOCUS_TONES[focus]} unit="개" />)}</nav>
    <details className="rounded-xl border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground"><summary className="cursor-pointer text-sm font-medium text-foreground">집계 기준과 진단 조건 <span className="ml-1 text-xs font-normal text-muted-foreground tabular-nums">{data.asOf} 기준 · 한국시간</span></summary><ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
      <li>상품과 IP가 현재 공개·미보관인 상품을 집계하며 품절 상품도 포함합니다. 평점·사진 비중·미답글은 어제까지 작성된 현재 공개 리뷰 기준입니다. 삭제·블라인드와 공개 상태 변경은 다음 조회에 반영됩니다.</li>
      <li>사진 리뷰 비중은 사진이 있는 리뷰 수 ÷ 전체 공개 리뷰 수입니다. 내 스토어 전체 비중보다 낮은 상품을 표시합니다. 리뷰가 없는 상품은 사진 비중 진단에서 제외합니다.</li>
      <li>작성률은 {data.cohortFrom}~{data.asOf} 배송완료 주문의 상품 중 리뷰가 작성된 비율입니다. 같은 주문의 동일 상품은 옵션·입력 문구와 관계없이 1건입니다. 블라인드한 리뷰도 작성 사실에 포함하며 취소된 주문은 제외합니다.</li>
      <li>주문 대비 리뷰가 적은 상품은 내 스토어 전체 작성률보다 낮은 상품입니다. 배송완료 기록이 없는 상품은 제외합니다. 3점 이하 신규 리뷰와 상품 평균 4.6 미만은 서로 다른 지표입니다.</li>
      <li>평점은 리뷰가 있는 상품별 평균을 다시 평균합니다. 내 스토어 기준은 검색어와 무관하며 진단 건수·목록에만 검색 조건을 적용합니다.</li>
      <li>3개월 전 비교는 현재 기준일에서 달력 3개월을 뺀 같은 날짜의 첫 성공 관측값을 사용합니다. 현재 평점은 지금 공개 상태로 다시 집계하며 과거 평점은 관측 당시 상태를 보존합니다. 날짜를 놓친 기록은 다른 날이나 현재 데이터로 채우지 않습니다.</li>
      {history.kind === 'ready' ? <li>비교 기준일: 현재 {history.data.asOf} / 3개월 전 {history.data.comparisonAsOf}. {past ? <>과거 관측 시각: {observedAt} 한국시간. 전체 평점 {rating(past.averageRating)} (상품 {past.ratedProductCount.toLocaleString('ko-KR')}개, 공개 리뷰 {past.reviewCount.toLocaleString('ko-KR')}건), 최근 6개월 평점 {rating(past.sixMonthRating)} (상품 {past.sixMonthRatedProductCount.toLocaleString('ko-KR')}개, 공개 리뷰 {past.sixMonthReviewCount.toLocaleString('ko-KR')}건; {past.sixMonthFrom}~{past.asOf}).</> : reviewRatingComparisonText(data.summary.averageRating, history, 'averageRating')}</li> : <li>과거 비교를 불러오지 못했습니다. 현재 평점과 상품 목록은 조회한 값입니다.</li>}
    </ul></details>
    <section aria-label="리뷰 관리하면 좋을 상품" className="flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground"><header className="flex flex-wrap items-end justify-between gap-4 border-b p-4"><h2 className="text-base font-semibold text-foreground">리뷰 관리하면 좋을 상품 <span className="text-sm font-normal text-muted-foreground">(총 {data.total.toLocaleString('ko-KR')}개)</span></h2>
      <form action={REVIEW_INSIGHTS_PATH} className="flex flex-wrap items-end gap-2" method="get"><input type="hidden" name="focus" value={filters.focus}/><label className="flex w-48 min-w-0 flex-col gap-1.5"><span className={FIELD_LABEL_CLASS}>상품명·상품번호</span><Input name="q" defaultValue={filters.query} maxLength={100}/></label><label className="flex min-w-0 flex-col gap-1.5"><span className={FIELD_LABEL_CLASS}>정렬</span><NativeSelect className="max-w-full" name="sort" defaultValue={filters.sort}><option value="analysis">분석 결과순</option><option value="reviews">리뷰 많은순</option><option value="rating">평점 낮은순</option></NativeSelect></label><label className="flex min-w-0 flex-col gap-1.5"><span className={FIELD_LABEL_CLASS}>목록수</span><NativeSelect className="max-w-full" name="size" defaultValue={String(filters.pageSize)}><option value="20">20개씩</option><option value="50">50개씩</option><option value="100">100개씩</option></NativeSelect></label><Button type="submit" variant="soft">조회</Button></form></header>
      {!data.rows.length ? <p className="py-16 text-center text-sm text-muted-foreground">조건에 맞는 상품이 없습니다.</p> : <ul className="flex flex-col divide-y px-4">{data.rows.map(row=><li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-4 py-5 xl:grid-cols-[5.5rem_minmax(8.75rem,1fr)_minmax(20rem,1fr)_auto] xl:gap-6" key={row.id}>
        <div className="grid size-18 place-items-center overflow-hidden rounded-lg border bg-muted text-muted-foreground xl:size-22">{row.imagePath ? <img className="size-full object-contain" src={publicMediaUrl(row.imagePath) ?? ''} alt=""/> : <ImageIcon aria-hidden="true" className="size-8" />}</div>
        <div className="flex min-w-0 flex-col gap-1.5 text-sm wrap-anywhere"><Link className="font-medium text-foreground underline-offset-4 hover:underline" href={`/admin/catalog/goods?goodId=${encodeURIComponent(row.id)}`}>{row.name}</Link><small className="text-xs text-muted-foreground tabular-nums">{row.id}</small><strong className="font-semibold text-foreground tabular-nums">₩{row.price.toLocaleString('ko-KR')}</strong><span className="text-xs text-muted-foreground tabular-nums">평점 {rating(row.averageRating)} · 리뷰 {row.reviewCount.toLocaleString('ko-KR')}개</span></div>
        <dl className="col-span-full grid grid-cols-2 gap-4 xl:col-span-1"><div><dt className="text-xs text-muted-foreground">사진 리뷰 비중</dt><BelowAverage base={data.summary.photoRate} value={row.photoRate}>{rate(row.photoRate)}</BelowAverage></div><div><dt className="text-xs text-muted-foreground">배송완료 대비 작성률</dt><BelowAverage base={data.summary.coverageRate} value={row.coverageRate}>{rate(row.coverageRate)}</BelowAverage></div><div><dt className="text-xs text-muted-foreground">미작성 상품주문</dt><dd className="mt-1 text-base font-semibold tabular-nums">{(row.deliveredCount-row.reviewedCount).toLocaleString('ko-KR')}건</dd></div><div><dt className="text-xs text-muted-foreground">미답글 리뷰</dt><dd className={`mt-1 text-base font-semibold tabular-nums ${row.unansweredCount > 0 ? 'text-warning' : ''}`}>{row.unansweredCount.toLocaleString('ko-KR')}건</dd></div></dl>
        <Link className={`${buttonVariants({ size: 'sm', variant: row.unansweredCount > 0 ? 'soft' : 'outline' })} col-span-full xl:col-span-1`} data-slot="button" href={`/admin/cs/reviews?field=good&query=${encodeURIComponent(row.name)}&status=visible`}>리뷰 조회 및 관리</Link>
      </li>)}</ul>}
      <div className="border-t p-4"><ConsolePagination label="리뷰 분석 페이지" page={data.page} pageSize={data.pageSize} total={data.total} unit="개" hrefForPage={page => reviewInsightHref(filters, { page })} /></div>
    </section>
  </div>;
}
