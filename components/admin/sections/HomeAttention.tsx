'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, MessagesSquare, Star } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/admin/kit/ui/tabs';
import { AdminNotice } from '../console/AdminKit';
import type { AdminHomeAttention } from '@/lib/admin/home-attention';
import { adminInquiryDetailHref, normalizeAdminInquiryFilters } from '@/lib/admin/inquiries';
import { formatOrderDateTime } from '@/lib/orders';
import { QnaActionPanel } from '../screens/QnaActionPanel';
import { ReviewActionPanel } from '../screens/ReviewActionPanel';
import { CHAT_STATUS_OPTIONS, inquiryChatHref, normalizeInquiryChatFilters } from '@/lib/admin/inquiry-chat';
import { REVIEW_INSIGHT_FOCUSES, REVIEW_INSIGHT_LABELS, normalizeReviewInsightFilters, reviewInsightHref } from '@/lib/admin/review-insights';

const UNREAD_CHAT_FILTERS = normalizeInquiryChatFilters({ period: 'all', read: 'unread' });
const ALL_CHAT_FILTERS = normalizeInquiryChatFilters({ period: 'all' });
const REVIEW_METRIC_LABELS = { photo: '사진 리뷰 부족', coverage: '주문 대비 리뷰 부족', rating: '평점 4.6 미만', unanswered: '미답글 리뷰' };
const INQUIRY_TABS = [
  { value: 'unreadChats', label: '읽지 않은 상담', more: inquiryChatHref(UNREAD_CHAT_FILTERS) },
  { value: 'inquiries', label: '고객문의', more: '/admin/cs/inquiries?status=open' },
  { value: 'questions', label: '상품문의', more: '/admin/cs/qna?status=unanswered' },
] as const;
const REVIEW_TABS = [
  { value: 'lowReviews', label: '낮은 평점', more: '/admin/cs/reviews?low=1&status=visible' },
  { value: 'unansweredReviews', label: '미답글', more: '/admin/cs/reviews?reply=without&status=visible' },
] as const;

/* 목록 한 줄. 문의·리뷰 팝업 트리거(QnaActionPanel·ReviewActionPanel의 button)도 링크와 같은 한 줄 글자로 맞춘다. */
const ROW_TARGET = 'min-w-0 [&>a]:block [&>a]:truncate [&>a]:text-sm [&>a]:underline-offset-4 [&>a]:hover:underline [&>button]:block [&>button]:w-full [&>button]:truncate [&>button]:text-left [&>button]:text-sm [&>button]:underline-offset-4 [&>button]:hover:underline';
/* kit Tabs는 data-horizontal 변형에 기대지만 Base UI는 data-orientation만 단다 — 세로 쌓기·목록 높이를 여기서 직접 준다. */
const TABS = 'flex-1 flex-col gap-3';
/* 탭의 건수는 확인할 것이 있을 때만 주의색(낮은 평점은 위험색)이다 — 0건·집계 실패는 조용히 둔다. */
const TAB_LIST = 'h-8 max-w-full justify-start overflow-x-auto [&_strong]:font-semibold [&_strong]:tabular-nums [&_[data-attention=warning]_strong]:text-warning [&_[data-attention=danger]_strong]:text-destructive';
const TAB_PANEL = 'flex min-w-0 flex-col gap-3';
const METRIC_LINK = 'inline-flex min-h-11 min-w-11 items-center justify-end gap-1 text-lg font-semibold tabular-nums underline-offset-4 hover:underline';

function AttentionColumn({ label, children }: { label: string; children: ReactNode }) {
  return <section aria-label={label} className="flex min-w-0 flex-col gap-3"><h3 className="text-sm font-medium">{label}</h3>{children}</section>;
}

function Failure({ children }: { children: ReactNode }) {
  return <AdminNotice role="status" tone="warning">{children}</AdminNotice>;
}

function EmptyRows({ children }: { children: ReactNode }) {
  return <p className="flex min-h-48 items-center justify-center rounded-lg bg-muted/40 text-sm text-muted-foreground">{children}</p>;
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className="mt-auto inline-flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" href={href}>{children}<ChevronRight aria-hidden="true" className="size-3.5" /></Link>;
}

function Meta({ children }: { children: ReactNode }) {
  return <small className="mt-0.5 block text-xs text-muted-foreground">{children}</small>;
}

export function HomeAttention({ data }: { data: AdminHomeAttention }) {
  const [inquiryTab, setInquiryTab] = useState<'unreadChats' | 'inquiries' | 'questions'>('unreadChats');
  const [reviewTab, setReviewTab] = useState<'lowReviews' | 'unansweredReviews'>('lowReviews');
  const chatCounts = data.unreadChats?.counts;
  const reviewInsights = data.reviewInsights;
  const count = (value: { total: number } | null) => value ? value.total.toLocaleString('ko-KR') : '확인 필요';
  const attention = (value: { total: number } | null, tone: 'warning' | 'danger' = 'warning') => value && value.total > 0 ? tone : undefined;

  const inquiryRows = (tab: typeof inquiryTab) => {
    const inquiries = data[tab];
    if (!inquiries) return <Failure>문의 현황을 불러오지 못했습니다.</Failure>;
    if (!inquiries.total) return <EmptyRows>확인 필요한 문의가 없습니다.</EmptyRows>;
    return <ul className="flex min-h-48 flex-col divide-y">
      {tab === 'unreadChats' ? data.unreadChats?.rows.map(row => <li className="py-2.5 first:pt-0" key={row.id}><div className={ROW_TARGET}><Link href={inquiryChatHref(UNREAD_CHAT_FILTERS, {}, row.id)} prefetch={false}>{row.preview || '첨부 파일'}</Link><Meta>{row.buyerName} · {formatOrderDateTime(row.lastMessageAt)} · 읽지 않은 메시지 {row.unreadCount}개</Meta></div></li>)
        : tab === 'inquiries' ? data.inquiries?.rows.map(row => <li className="py-2.5 first:pt-0" key={row.id}><div className={ROW_TARGET}><Link href={adminInquiryDetailHref(row.id, normalizeAdminInquiryFilters({ status: 'open' }))} prefetch={false}>{row.title}</Link><Meta>{row.buyerName} · {formatOrderDateTime(row.createdAt)}</Meta></div></li>)
          : data.questions?.rows.map(row => <li className="py-2.5 first:pt-0" key={row.id}><div className={ROW_TARGET}><QnaActionPanel question={row} triggerLabel={row.body} /><Meta>{row.authorName} · {formatOrderDateTime(row.createdAt)}</Meta></div></li>)}
    </ul>;
  };

  const reviewRows = (tab: typeof reviewTab) => {
    const reviews = data[tab];
    if (!reviews) return <Failure>리뷰 현황을 불러오지 못했습니다.</Failure>;
    if (!reviews.total) return <EmptyRows>확인 필요한 리뷰가 없습니다.</EmptyRows>;
    return <ul className="flex min-h-48 flex-col divide-y">{reviews.rows.map(row => <li className="flex items-start gap-3 py-2.5 first:pt-0" key={row.id}>
      <Star aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
      <div className={`flex-1 ${ROW_TARGET}`}><ReviewActionPanel review={row} triggerLabel={row.body} /><Meta><span className="font-medium text-foreground tabular-nums">{row.rating}점</span> · {row.authorName} · {formatOrderDateTime(row.createdAt)}</Meta></div>
    </li>)}</ul>;
  };

  return <details className="group/attention min-w-0 rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10" data-admin-home="attention" open>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2 text-base font-medium"><MessagesSquare aria-hidden="true" className="size-4 text-muted-foreground" />문의 · 리뷰 현황</span>
      <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open/attention:rotate-180" />
    </summary>
    <div className="grid gap-6 border-t p-4 md:grid-cols-2">
      <AttentionColumn label="확인 필요한 문의">
        <Tabs className={TABS} onValueChange={(value) => setInquiryTab(value as typeof inquiryTab)} value={inquiryTab}>
          <TabsList aria-label="문의 종류" className={TAB_LIST}>
            {INQUIRY_TABS.map(tab => <TabsTrigger className="flex-none px-2.5" data-attention={attention(data[tab.value])} key={tab.value} value={tab.value}>{tab.label} <strong>{count(data[tab.value])}</strong></TabsTrigger>)}
          </TabsList>
          {INQUIRY_TABS.map(tab => <TabsContent className={TAB_PANEL} key={tab.value} value={tab.value}>
            {inquiryRows(tab.value)}
            <MoreLink href={tab.more}>자세히 확인하기</MoreLink>
          </TabsContent>)}
        </Tabs>
      </AttentionColumn>
      <AttentionColumn label="확인 필요한 리뷰">
        <Tabs className={TABS} onValueChange={(value) => setReviewTab(value as typeof reviewTab)} value={reviewTab}>
          <TabsList aria-label="리뷰 종류" className={TAB_LIST}>
            {REVIEW_TABS.map(tab => <TabsTrigger className="flex-none px-2.5" data-attention={attention(data[tab.value], tab.value === 'lowReviews' ? 'danger' : 'warning')} key={tab.value} value={tab.value}>{tab.label} <strong>{count(data[tab.value])}</strong></TabsTrigger>)}
          </TabsList>
          {REVIEW_TABS.map(tab => <TabsContent className={TAB_PANEL} key={tab.value} value={tab.value}>
            {reviewRows(tab.value)}
            <MoreLink href={tab.more}>자세히 확인하기</MoreLink>
          </TabsContent>)}
        </Tabs>
      </AttentionColumn>
    </div>
    <div className="grid gap-6 border-t p-4 md:grid-cols-2">
      <AttentionColumn label="상담 현황"><p className="-mt-2 text-xs text-muted-foreground">전체 기간 · 현재 대화 상태 기준</p>
        {!chatCounts ? <Failure>상담 현황을 불러오지 못했습니다.</Failure> : <dl className="grid grid-cols-2 gap-x-6 gap-y-1 md:max-xl:grid-cols-1">{CHAT_STATUS_OPTIONS.map(option => <div className="flex min-h-11 items-center justify-between gap-4" key={option.value}><dt className="text-muted-foreground">{option.label}</dt><dd><Link aria-label={`${option.label} 상담 ${chatCounts[option.value].toLocaleString('ko-KR')}건`} className={`${METRIC_LINK}${option.value === 'open' && chatCounts.open > 0 ? ' text-warning' : ''}`} href={inquiryChatHref(ALL_CHAT_FILTERS, { status: option.value })} prefetch={false}>{chatCounts[option.value].toLocaleString('ko-KR')}<span className="text-sm font-normal text-muted-foreground">건</span></Link></dd></div>)}</dl>}
        <MoreLink href={inquiryChatHref(ALL_CHAT_FILTERS)}>상담하기</MoreLink>
      </AttentionColumn>
      <AttentionColumn label="리뷰 인사이트 상품"><p className="-mt-2 text-xs text-muted-foreground">{data.reviewInsights ? `${data.reviewInsights.asOf} 기준 · 조건별 상품 수` : '상품별 리뷰 개선 항목'}</p>
        {!reviewInsights ? <Failure>리뷰 분석을 불러오지 못했습니다.</Failure> : <dl className="grid grid-cols-2 gap-x-6 gap-y-1 md:max-xl:grid-cols-1">{REVIEW_INSIGHT_FOCUSES.filter(focus => focus !== 'all').map(focus => <div className="flex min-h-11 items-center justify-between gap-4" key={focus}><dt className="text-muted-foreground">{REVIEW_METRIC_LABELS[focus]}</dt><dd><Link aria-label={`${REVIEW_INSIGHT_LABELS[focus]} ${reviewInsights.counts[focus].toLocaleString('ko-KR')}개`} className={`${METRIC_LINK}${focus === 'rating' && reviewInsights.counts.rating > 0 ? ' text-destructive' : ''}`} href={reviewInsightHref(normalizeReviewInsightFilters({ focus }))} prefetch={false}>{reviewInsights.counts[focus].toLocaleString('ko-KR')}<span className="text-sm font-normal text-muted-foreground">개</span></Link></dd></div>)}</dl>}
        <MoreLink href="/admin/cs/review-insights">자세히 확인하기</MoreLink>
      </AttentionColumn>
    </div>
  </details>;
}
