/* eslint-disable @next/next/no-img-element -- Public catalog thumbnails reserve fixed dimensions and keep the stored aspect ratio. */
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { CalendarDays, Camera, Image as ImageIcon, MessageSquareText, PackageCheck, Star } from 'lucide-react';
import { AdminCountCard } from '@/components/admin/console/AdminCountCard';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/admin/kit/ui/table';
import { publicMediaUrl } from '@/lib/media';
import { reviewRatingComparisonText, type ReviewRatingHistoryResult } from '@/lib/admin/review-rating-history';
import { REVIEW_INSIGHTS_PATH, REVIEW_INSIGHT_FOCUSES, REVIEW_INSIGHT_LABELS, reviewInsightHref, type ReviewInsightFilters, type ReviewInsights } from '@/lib/admin/review-insights';
import { FIELD_LABEL_CLASS, KIT_SEGMENT_CLASS, KIT_SEGMENT_ITEM_CLASS } from './cs-kit-classes';
import { ConsolePagination } from '../console/ConsolePagination';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleTableHeader } from '../console/ConsoleListCard';

const rate=(value: number | null) => value===null ? '—' : `${value.toFixed(1)}%`;
const rating=(value: number | null) => value===null ? '—' : value.toFixed(2);
/** 건수 카드는 숫자를 받는다 — 표와 같은 자릿수로 반올림해 넘긴다. */
const rounded=(value: number | null, digits: number) => value===null ? null : Number(value.toFixed(digits));
/** 탭 '평점 4.6 미만 상품'과 같은 기준이다(진단 건수는 서버가 같은 값으로 센다). */
const LOW_RATING_THRESHOLD = 4.6;

/** 다른 화면과 같은 건수 카드에 아래 한 줄 설명을 붙인다. */
function StatCard({ note, hint, ...card }: ComponentProps<typeof AdminCountCard> & { note?: string; hint?: string }) {
  return <div className="flex min-w-0 flex-col gap-1" title={hint}><AdminCountCard {...card} />{note ? <small className="px-1 text-xs leading-relaxed text-muted-foreground wrap-anywhere">{note}</small> : null}</div>;
}

/** 3개월 전 비교 문구. 아직 기록이 없는 정상 상태를 오류처럼 읽지 않게 말을 바꾼다(불러오기 실패·실제 증감은 그대로). */
function comparisonNote(current: number | null, history: ReviewRatingHistoryResult, field: 'averageRating' | 'sixMonthRating') {
  if (history.kind === 'ready' && ['before_collection_start', 'not_collected', 'outside_retention'].includes(history.data.status)) return '3개월 전 기록이 쌓이면 비교합니다';
  return reviewRatingComparisonText(current, history, field);
}

/** 내 스토어 전체 값보다 낮은 상품의 수치. 색은 숫자에만 쓰고, 색만으로 말하지 않도록 기준값을 글자로 함께 붙인다. */
function BelowAverage({ value, base, children, emphasize }: { value: number | null; base: number | null; children: string; emphasize: boolean }) {
  /* 지금 고른 진단 탭의 지표만 주의색으로 — 전체 탭에서 네 칸이 다 주황이면 평점 위험이 안 보인다. */
  const below = emphasize && value !== null && base !== null && value < base;
  return <><span className={`font-semibold tabular-nums ${below ? 'text-warning' : ''}`}>{children}</span>{below ? <small className="mt-0.5 block text-xs font-normal text-muted-foreground">평균 {rate(base)} 미만</small> : null}</>;
}

/** 평점 칸. 기준 미만이면 숫자가 주의색이고, 같은 줄에 기준을 글자로 말한다. */
function RatingValue({ value, reviewCount }: { value: number | null; reviewCount: number }) {
  const low = value !== null && value < LOW_RATING_THRESHOLD;
  const veryLow = value !== null && value <= 3;
  return <><span className={`font-semibold ${veryLow ? 'text-destructive' : low ? 'text-warning' : ''}`}>{rating(value)}</span><small className="mt-0.5 block text-xs text-muted-foreground">리뷰 {reviewCount.toLocaleString('ko-KR')}개{low ? ` · ${LOW_RATING_THRESHOLD} 미만` : ''}</small></>;
}

/* 템플릿 룩(ADR-0028): 스토어 현황 카드 → 상품 목록 카드(진단 주제 탭·표) → 집계 기준(접기). 조회 키(focus·q·sort·size·page)는 그대로다. */
export function ReviewInsightsScreen({ data,filters,history = { kind: 'error' } }: { data: ReviewInsights; filters: ReviewInsightFilters; history?: ReviewRatingHistoryResult }) {
  const past = history.kind === 'ready' ? history.data.observation : null;
  const observedAt = past ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(past.observedAt)) : null;
  return <div className="flex min-w-0 flex-col gap-4" data-review-insights="">
    {/* 스토어 전체 현황은 다른 화면과 같은 건수 카드다. 지금 손댈 숫자(3점 이하 새 리뷰)를 맨 앞에 두고, 칸이 잘리지 않게 이름을 줄인다. */}
    <section aria-label="스토어 리뷰 현황" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <StatCard count={data.summary.newLowReviews} label="3점 이하 새 리뷰" note="어제부터 현재까지" tone="danger" />
      <StatCard count={data.summary.newReviews} icon={MessageSquareText} label="새 리뷰" note="어제부터 현재까지" />
      <StatCard count={rounded(data.summary.averageRating, 2)} hint="상품별 평균의 평균" icon={Star} label="내 상품 평균 평점" note={comparisonNote(data.summary.averageRating, history, 'averageRating')} unit="점" />
      <StatCard count={rounded(data.summary.sixMonthRating, 2)} hint="상품별 평균의 평균" icon={CalendarDays} label="최근 6개월 평균 평점" note={comparisonNote(data.summary.sixMonthRating, history, 'sixMonthRating')} unit="점" />
      <StatCard count={rounded(data.summary.photoRate, 1)} icon={Camera} label="사진 리뷰 비중" unit="%" />
      <StatCard count={rounded(data.summary.coverageRate, 1)} icon={PackageCheck} label="배송완료 대비 작성률" unit="%" />
    </section>
    <section aria-label="리뷰 관리가 필요한 상품" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground">
      <header className="flex flex-wrap items-end justify-between gap-4"><h2 className="text-base font-semibold text-foreground">리뷰 관리가 필요한 상품 <span className="text-sm font-normal text-muted-foreground">(총 {data.total.toLocaleString('ko-KR')}개)</span></h2>
        <form action={REVIEW_INSIGHTS_PATH} className="flex flex-wrap items-end gap-2" method="get"><input type="hidden" name="focus" value={filters.focus}/><label className="flex w-48 min-w-0 flex-col gap-1.5"><span className={FIELD_LABEL_CLASS}>상품명·상품번호</span><Input name="q" defaultValue={filters.query} maxLength={100}/></label><label className="flex min-w-0 flex-col gap-1.5"><span className={FIELD_LABEL_CLASS}>정렬</span><NativeSelect className="max-w-full" name="sort" defaultValue={filters.sort}><option value="analysis">분석 결과순</option><option value="reviews">리뷰 많은순</option><option value="rating">평점 낮은순</option></NativeSelect></label><label className="flex min-w-0 flex-col gap-1.5"><span className={FIELD_LABEL_CLASS}>목록수</span><NativeSelect className="max-w-full" name="size" defaultValue={String(filters.pageSize)}><option value="20">20개씩</option><option value="50">50개씩</option><option value="100">100개씩</option></NativeSelect></label><Button type="submit" variant="soft">검색</Button></form></header>
      {/* 진단 주제는 숫자 카드가 아니라 목록을 거르는 탭이다 — 위 현황 숫자와 역할을 나눈다. 문제 건수가 있는 탭만 주의색이고 '전체 상품'은 건수일 뿐이다. */}
      <nav aria-label="리뷰 분석 주제" className={KIT_SEGMENT_CLASS}>{REVIEW_INSIGHT_FOCUSES.map(focus => <Link aria-current={filters.focus === focus ? 'page' : undefined} aria-label={`${REVIEW_INSIGHT_LABELS[focus]} ${data.counts[focus].toLocaleString('ko-KR')}개`} className={KIT_SEGMENT_ITEM_CLASS} href={reviewInsightHref(filters,{focus,page:1})} key={focus}>{REVIEW_INSIGHT_LABELS[focus]}<span className={`tabular-nums ${focus !== 'all' && data.counts[focus] > 0 ? 'font-semibold text-warning' : ''}`}>{data.counts[focus].toLocaleString('ko-KR')}개</span></Link>)}</nav>
      <p className="text-xs text-muted-foreground">평점이 낮은 상품부터 확인해주세요. 평점은 3점 이하가 빨강, {LOW_RATING_THRESHOLD} 미만이 주황입니다. 사진 비중·작성률은 해당 탭을 고르면 내 스토어 평균 미만이 주황으로 표시됩니다.</p>
      {!data.rows.length ? <p className="py-16 text-center text-sm text-muted-foreground">조건에 맞는 상품이 없습니다.</p> : <div aria-label="리뷰 관리가 필요한 상품 가로 스크롤" className={`${CONSOLE_TABLE_FRAME_CLASS} [&>[data-slot=table-container]]:overflow-visible`} role="region" tabIndex={0}><Table className="min-w-[56rem]"><caption className="sr-only">리뷰 관리가 필요한 상품</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead className="px-3">상품</TableHead><TableHead className="px-3 text-right">평점 · 리뷰</TableHead><TableHead className="px-3 text-right">사진 리뷰 비중</TableHead><TableHead className="px-3 text-right">배송완료 대비 작성률</TableHead><TableHead className="px-3 text-right">미작성 상품주문</TableHead><TableHead className="px-3 text-right">미답글 리뷰</TableHead><TableHead className="px-3 text-right">관리</TableHead></TableRow></ConsoleTableHeader><TableBody>{data.rows.map(row=><TableRow key={row.id}>
        <TableCell className="max-w-80 px-3 whitespace-normal"><div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted text-muted-foreground">{row.imagePath ? <img className="size-full object-contain" src={publicMediaUrl(row.imagePath) ?? ''} alt=""/> : <ImageIcon aria-hidden="true" className="size-5" />}</div><div className="flex min-w-0 flex-col gap-0.5"><Link className="line-clamp-1 font-medium underline-offset-4 hover:underline" href={`/admin/catalog/goods?goodId=${encodeURIComponent(row.id)}`} title={row.name}>{row.name}</Link><small className="text-xs text-muted-foreground tabular-nums">{row.id} · ₩{row.price.toLocaleString('ko-KR')}</small></div></div></TableCell>
        <TableCell className="px-3 text-right tabular-nums"><RatingValue reviewCount={row.reviewCount} value={row.averageRating} /></TableCell>
        <TableCell className="px-3 text-right"><BelowAverage base={data.summary.photoRate} emphasize={filters.focus === 'photo'} value={row.photoRate}>{rate(row.photoRate)}</BelowAverage></TableCell>
        <TableCell className="px-3 text-right"><BelowAverage base={data.summary.coverageRate} emphasize={filters.focus === 'coverage'} value={row.coverageRate}>{rate(row.coverageRate)}</BelowAverage></TableCell>
        <TableCell className="px-3 text-right font-semibold tabular-nums">{(row.deliveredCount-row.reviewedCount).toLocaleString('ko-KR')}건</TableCell>
        {/* 미답글은 거의 모든 줄에 있어 색으로는 안 갈린다 — 숫자는 보통 글자이고, 처리할 줄은 오른쪽 버튼이 말한다. */}
        <TableCell className={`px-3 text-right tabular-nums ${row.unansweredCount > 0 ? 'font-semibold' : 'text-muted-foreground'}`}>{row.unansweredCount.toLocaleString('ko-KR')}건</TableCell>
        <TableCell className="px-3 text-right"><Link className={buttonVariants({ size: 'sm', variant: row.unansweredCount > 0 ? 'soft' : 'outline' })} data-slot="button" href={`/admin/cs/reviews?field=good&query=${encodeURIComponent(row.name)}&status=visible`}>리뷰 조회 및 관리</Link></TableCell>
      </TableRow>)}</TableBody></Table></div>}
      <ConsolePagination label="리뷰 분석 페이지" page={data.page} pageSize={data.pageSize} total={data.total} unit="개" hrefForPage={page => reviewInsightHref(filters, { page })} />
    </section>
    <details className="rounded-xl border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground"><summary className="cursor-pointer text-sm font-medium text-foreground">집계 기준과 진단 조건 <span className="ml-1 text-xs font-normal text-muted-foreground tabular-nums">{data.asOf} 기준 · 한국시간</span></summary><ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
      <li>상품과 IP가 현재 공개·미보관인 상품을 집계하며 품절 상품도 포함합니다. 평점·사진 비중·미답글은 어제까지 작성된 현재 공개 리뷰 기준입니다. 삭제·블라인드와 공개 상태 변경은 다음 조회에 반영됩니다.</li>
      <li>사진 리뷰 비중은 사진이 있는 리뷰 수 ÷ 전체 공개 리뷰 수입니다. 내 스토어 전체 비중보다 낮은 상품을 표시합니다. 리뷰가 없는 상품은 사진 비중 진단에서 제외합니다.</li>
      <li>작성률은 {data.cohortFrom}~{data.asOf} 배송완료 주문의 상품 중 리뷰가 작성된 비율입니다. 같은 주문의 동일 상품은 옵션·입력 문구와 관계없이 1건입니다. 블라인드한 리뷰도 작성 사실에 포함하며 취소된 주문은 제외합니다.</li>
      <li>주문 대비 리뷰가 적은 상품은 내 스토어 전체 작성률보다 낮은 상품입니다. 배송완료 기록이 없는 상품은 제외합니다. 3점 이하 신규 리뷰와 상품 평균 4.6 미만은 서로 다른 지표입니다.</li>
      <li>평점은 리뷰가 있는 상품별 평균을 다시 평균합니다. 내 스토어 기준은 검색어와 무관하며 진단 건수·목록에만 검색 조건을 적용합니다.</li>
      <li>3개월 전 비교는 현재 기준일에서 달력 3개월을 뺀 같은 날짜의 첫 성공 관측값을 사용합니다. 현재 평점은 지금 공개 상태로 다시 집계하며 과거 평점은 관측 당시 상태를 보존합니다. 날짜를 놓친 기록은 다른 날이나 현재 데이터로 채우지 않습니다.</li>
      {history.kind === 'ready' ? <li>비교 기준일: 현재 {history.data.asOf} / 3개월 전 {history.data.comparisonAsOf}. {past ? <>과거 관측 시각: {observedAt} 한국시간. 전체 평점 {rating(past.averageRating)} (상품 {past.ratedProductCount.toLocaleString('ko-KR')}개, 공개 리뷰 {past.reviewCount.toLocaleString('ko-KR')}건), 최근 6개월 평점 {rating(past.sixMonthRating)} (상품 {past.sixMonthRatedProductCount.toLocaleString('ko-KR')}개, 공개 리뷰 {past.sixMonthReviewCount.toLocaleString('ko-KR')}건; {past.sixMonthFrom}~{past.asOf}).</> : reviewRatingComparisonText(data.summary.averageRating, history, 'averageRating')}</li> : <li>과거 비교를 불러오지 못했습니다. 현재 평점과 상품 목록은 조회한 값입니다.</li>}
    </ul></details>
  </div>;
}
