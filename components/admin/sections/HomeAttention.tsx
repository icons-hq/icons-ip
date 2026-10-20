'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
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

export function HomeAttention({ data }: { data: AdminHomeAttention }) {
  const [inquiryTab, setInquiryTab] = useState<'unreadChats' | 'inquiries' | 'questions'>('unreadChats');
  const [reviewTab, setReviewTab] = useState<'lowReviews' | 'unansweredReviews'>('lowReviews');
  const inquiries = data[inquiryTab]; const reviews = data[reviewTab];
  const chatCounts = data.unreadChats?.counts;
  const reviewInsights = data.reviewInsights;
  const count = (value: { total: number } | null) => value ? value.total.toLocaleString('ko-KR') : '확인 필요';
  return <details className="admin-home-attention" open>
    <summary className="admin-home-section-heading"><span><span className="admin-home-section-icon"><Icon name="chat" size={18} /></span>문의 · 리뷰 현황</span><span className="admin-home-section-toggle" aria-hidden="true">⌃</span></summary>
    <div className="admin-home-attention-columns">
      <section aria-label="확인 필요한 문의"><h3>확인 필요한 문의</h3>
        <div role="group" aria-label="문의 종류" className="admin-home-attention-tabs">
          <button aria-pressed={inquiryTab === 'unreadChats'} onClick={() => setInquiryTab('unreadChats')} type="button">읽지 않은 상담 <strong>{count(data.unreadChats)}</strong></button>
          <button aria-pressed={inquiryTab === 'inquiries'} onClick={() => setInquiryTab('inquiries')} type="button">고객문의 <strong>{count(data.inquiries)}</strong></button>
          <button aria-pressed={inquiryTab === 'questions'} onClick={() => setInquiryTab('questions')} type="button">상품문의 <strong>{count(data.questions)}</strong></button>
        </div>
        {!inquiries ? <p role="status">문의 현황을 불러오지 못했습니다.</p> : !inquiries.total ? <p className="admin-home-attention-empty">확인 필요한 문의가 없습니다.</p> : <ul>
          {inquiryTab === 'unreadChats' ? data.unreadChats?.rows.map(row => <li key={row.id}><div><Link href={inquiryChatHref(UNREAD_CHAT_FILTERS, {}, row.id)} prefetch={false}>{row.preview || '첨부 파일'}</Link><small>{row.buyerName} · {formatOrderDateTime(row.lastMessageAt)} · 읽지 않은 메시지 {row.unreadCount}개</small></div></li>) : inquiryTab === 'inquiries' ? data.inquiries?.rows.map(row => <li key={row.id}><div><Link href={adminInquiryDetailHref(row.id, normalizeAdminInquiryFilters({ status: 'open' }))} prefetch={false}>{row.title}</Link><small>{row.buyerName} · {formatOrderDateTime(row.createdAt)}</small></div></li>) : data.questions?.rows.map(row => <li key={row.id}><div><QnaActionPanel question={row} triggerLabel={row.body} /><small>{row.authorName} · {formatOrderDateTime(row.createdAt)}</small></div></li>)}
        </ul>}
        <Link className="admin-home-attention-more" href={inquiryTab === 'unreadChats' ? inquiryChatHref(UNREAD_CHAT_FILTERS) : inquiryTab === 'inquiries' ? '/admin/cs/inquiries?status=open' : '/admin/cs/qna?status=unanswered'}>자세히 확인하기 ›</Link>
      </section>
      <section aria-label="확인 필요한 리뷰"><h3>확인 필요한 리뷰</h3>
        <div role="group" aria-label="리뷰 종류" className="admin-home-attention-tabs">
          <button aria-pressed={reviewTab === 'lowReviews'} onClick={() => setReviewTab('lowReviews')} type="button">낮은 평점 <strong>{count(data.lowReviews)}</strong></button>
          <button aria-pressed={reviewTab === 'unansweredReviews'} onClick={() => setReviewTab('unansweredReviews')} type="button">미답글 <strong>{count(data.unansweredReviews)}</strong></button>
        </div>
        {!reviews ? <p role="status">리뷰 현황을 불러오지 못했습니다.</p> : !reviews.total ? <p className="admin-home-attention-empty">확인 필요한 리뷰가 없습니다.</p> : <ul>{reviews.rows.map(row => <li key={row.id}><Icon name="star" size={28} /><div><ReviewActionPanel review={row} triggerLabel={row.body} /><small><span>{row.rating}점</span> · {row.authorName} · {formatOrderDateTime(row.createdAt)}</small></div></li>)}</ul>}
        <Link className="admin-home-attention-more" href={reviewTab === 'lowReviews' ? '/admin/cs/reviews?low=1&status=visible' : '/admin/cs/reviews?reply=without&status=visible'}>자세히 확인하기 ›</Link>
      </section>
    </div>
    <div className="admin-home-attention-columns admin-home-attention-insights">
      <section aria-label="상담 현황"><h3>상담 현황</h3><p className="admin-home-attention-basis">전체 기간 · 현재 대화 상태 기준</p>
        {!chatCounts ? <p role="status">상담 현황을 불러오지 못했습니다.</p> : <dl className="admin-home-attention-metrics">{CHAT_STATUS_OPTIONS.map(option => <div key={option.value}><dt>{option.label}</dt><dd><Link href={inquiryChatHref(ALL_CHAT_FILTERS, { status: option.value })} prefetch={false} aria-label={`${option.label} 상담 ${chatCounts[option.value].toLocaleString('ko-KR')}건`}>{chatCounts[option.value].toLocaleString('ko-KR')}<span>건</span></Link></dd></div>)}</dl>}
        <Link className="admin-home-attention-more" href={inquiryChatHref(ALL_CHAT_FILTERS)}>상담하기 ›</Link>
      </section>
      <section aria-label="리뷰 인사이트 상품"><h3>리뷰 인사이트 상품</h3><p className="admin-home-attention-basis">{data.reviewInsights ? `${data.reviewInsights.asOf} 기준 · 조건별 상품 수` : '상품별 리뷰 개선 항목'}</p>
        {!reviewInsights ? <p role="status">리뷰 분석을 불러오지 못했습니다.</p> : <dl className="admin-home-attention-metrics">{REVIEW_INSIGHT_FOCUSES.filter(focus => focus !== 'all').map(focus => <div key={focus}><dt>{REVIEW_METRIC_LABELS[focus]}</dt><dd><Link href={reviewInsightHref(normalizeReviewInsightFilters({ focus }))} prefetch={false} aria-label={`${REVIEW_INSIGHT_LABELS[focus]} ${reviewInsights.counts[focus].toLocaleString('ko-KR')}개`}>{reviewInsights.counts[focus].toLocaleString('ko-KR')}<span>개</span></Link></dd></div>)}</dl>}
        <Link className="admin-home-attention-more" href="/admin/cs/review-insights">자세히 확인하기 ›</Link>
      </section>
    </div>
  </details>;
}
