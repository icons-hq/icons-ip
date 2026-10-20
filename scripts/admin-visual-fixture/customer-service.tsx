import { QnaConsoleScreen } from '../../components/admin/screens/QnaConsoleScreen';
import { ReviewConsoleScreen } from '../../components/admin/screens/ReviewConsoleScreen';
import { InquiryQueueScreen } from '../../components/admin/screens/InquiryQueueScreen';
import { InquiryDetailScreen } from '../../components/admin/screens/InquiryDetailScreen';
import { InquiryPreviewWorkspace } from '../../components/admin/screens/CustomerServiceDialog';
import { normalizeAdminProductQuestionFilters, type AdminProductQuestionRow } from '../../lib/admin/product-questions';
import { normalizeAdminReviewFilters, type AdminReviewRow } from '../../lib/admin/reviews';
import { adminInquiryHref, normalizeAdminInquiryFilters, type AdminInquiryRow } from '../../lib/admin/inquiries';
import type { AdminInquiryDetail } from '../../lib/admin/inquiries.server';
import type { AdminHomeAttention } from '../../lib/admin/home-attention';

const NOW = new Date('2026-10-12T08:00:00Z');
const QUESTION: AdminProductQuestionRow = {
  id: '00000000-0000-4000-8000-000000070001', goodId: 'fixture-goods', goodName: '[합성] 아크릴 스탠드 상품', userId: '00000000-0000-4000-8000-000000070099', authorName: '합성구매자',
  goodImageUrl: '/generated/goods/g13.webp',
  body: '스탠드의 크기와 재질이 궁금합니다. 선물 포장도 가능한가요?\n실제 고객 문의가 아닌 UI 검수용 합성 문장입니다.', hidden: false, answerBody: null, answeredAt: null, answeredByName: null, createdAt: '2026-10-10T02:00:00Z',
};
const REVIEW: AdminReviewRow = {
  helpfulCount: 0,
  id: '00000000-0000-4000-8000-000000070002', goodId: 'fixture-goods', goodName: '[합성] 아크릴 스탠드 상품', orderId: '00000000-0000-4000-8000-000000070011', userId: QUESTION.userId,
  authorName: '합성구매자', authorEmail: null, rating: 4, body: '크기가 적당하고 포장이 좋았습니다.\n상세 이미지와 실제 색상 차이를 확인하려고 남긴 합성 리뷰입니다.', imageUrls: [], imageCount: 0,
  status: 'visible', hiddenReason: null, hiddenAt: null, adminReply: null, adminReplyAt: null, replyAuthorName: null, reportCount: 0, openReportCount: 0, createdAt: '2026-10-11T02:00:00Z', editedAt: null,
};
const INQUIRY: AdminInquiryRow = {
  id: '00000000-0000-4000-8000-000000070003', reference: 1001, category: 'order', title: '[합성] 배송 예정일을 확인하고 싶습니다', status: 'open', buyerName: '합성구매자', buyerEmail: null,
  orderId: null, goodId: 'fixture-goods', goodName: '[합성] 아크릴 스탠드 상품', handlerName: null, assigneeId: null, assigneeName: null, waitingSince: '2026-10-10T02:00:00Z', createdAt: '2026-10-10T02:00:00Z', lastMessageAt: '2026-10-10T02:00:00Z', answeredAt: null, messageCount: 1,
};
export const FIXTURE_HOME_ATTENTION: AdminHomeAttention = {
  unreadChats: { rows: [{ id: INQUIRY.id, reference: INQUIRY.reference, title: INQUIRY.title, category: INQUIRY.category, status: 'open', buyerName: INQUIRY.buyerName, assigneeId: null, assigneeName: null, lastMessageAt: INQUIRY.lastMessageAt, preview: '[합성] 배송 예정일을 알려주세요.', previewAuthor: 'user', unreadCount: 2 }], total: 3, counts: { all: 12, open: 5, answered: 4, closed: 3 } },
  inquiries: { rows: [INQUIRY], total: 5 },
  questions: { rows: [QUESTION], total: 3 },
  lowReviews: { rows: [{ ...REVIEW, rating: 2, body: '[합성] 포장 상태가 아쉬웠습니다. 상품은 잘 받았습니다.' }], total: 2 },
  unansweredReviews: { rows: [REVIEW], total: 8 },
  reviewInsights: { asOf: '2026-10-12', counts: { all: 15, photo: 4, coverage: 6, rating: 2, unanswered: 8 } },
};
const DETAIL: AdminInquiryDetail = {
  inquiry: { ...INQUIRY, userId: QUESTION.userId, closedAt: null },
  messages: [{ id: 'fixture-message', author: 'user', authorName: '합성구매자', body: '주문한 스탠드의 배송 예정일을 알려주세요. UI 검수용 합성 문의입니다.', imageUrls: [], createdAt: INQUIRY.createdAt }],
  order: null,
  buyer: { id: QUESTION.userId, nickname: '합성구매자', email: null, suspendedAt: null, orderCount: 2, inquiryCount: 1, openInquiryCount: 1 },
  staffOptions: [], notes: [],
};

export function CustomerServiceFixture({ view }: { view: 'cs-qna' | 'cs-reviews' | 'cs-inquiries' }) {
  const params = Object.fromEntries(new URLSearchParams(window.location.search));
  if (view === 'cs-qna') {
    const filters = normalizeAdminProductQuestionFilters(params);
    return <QnaConsoleScreen now={NOW} data={{ filters, rows: [QUESTION], total: 1, pageSize: filters.pageSize ?? 20, counts: { total: 1, unanswered: 1, answered: 0, hidden: 0 } }} />;
  }
  if (view === 'cs-reviews') {
    const filters = normalizeAdminReviewFilters(params);
    return <ReviewConsoleScreen now={NOW} data={{ filters, rows: [REVIEW], total: 1, pageSize: filters.pageSize ?? 20, counts: { total: 1, lowRating: 0, awaitingReply: 1, hidden: 0, reported: 0 } }} />;
  }
  const filters = normalizeAdminInquiryFilters(params);
  return <>
    <InquiryQueueScreen now={NOW} data={{ filters, rows: [INQUIRY], total: 1, pageSize: filters.pageSize ?? 20, counts: { open: 1, answered: 0, closed: 0 } }} />
    <InquiryPreviewWorkspace closeHref={adminInquiryHref(filters)} selected={Boolean(params.inquiryId)}>{params.inquiryId ? <InquiryDetailScreen embedded now={NOW} backHref={adminInquiryHref(filters)} detail={DETAIL} /> : null}</InquiryPreviewWorkspace>
  </>;
}
