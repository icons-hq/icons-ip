import 'server-only';
import { normalizeAdminInquiryFilters } from './inquiries';
import { getAdminInquiryConsoleData } from './inquiries.server';
import { normalizeAdminProductQuestionFilters } from './product-questions';
import { getAdminProductQuestionConsoleData } from './product-questions.server';
import { normalizeAdminReviewFilters } from './reviews';
import { getAdminReviewConsoleData } from './reviews.server';
import type { AdminHomeAttention } from './home-attention';
import { normalizeInquiryChatFilters } from './inquiry-chat';
import { loadInquiryChatData } from './inquiry-chat.server';
import { normalizeReviewInsightFilters } from './review-insights';
import { getAdminReviewInsights } from './review-insights.server';

export async function loadAdminHomeAttention(): Promise<AdminHomeAttention> {
  const trim = <T,>(value: { total: number; rows: T[] }) => ({ total: value.total, rows: value.rows.slice(0, 5) });
  const [inquiries, questions, lowReviews, unansweredReviews, unreadChats, reviewInsights] = await Promise.all([
    getAdminInquiryConsoleData(normalizeAdminInquiryFilters({ status: 'open' })).then(trim).catch(() => null),
    getAdminProductQuestionConsoleData(normalizeAdminProductQuestionFilters({ status: 'unanswered' })).then(trim).catch(() => null),
    getAdminReviewConsoleData(normalizeAdminReviewFilters({ low: '1', status: 'visible' })).then(trim).catch(() => null),
    getAdminReviewConsoleData(normalizeAdminReviewFilters({ reply: 'without', status: 'visible' })).then(trim).catch(() => null),
    loadInquiryChatData(normalizeInquiryChatFilters({ period: 'all', read: 'unread' }))
      .then(data => ({ ...trim(data), counts: data.counts })).catch(() => null),
    getAdminReviewInsights(normalizeReviewInsightFilters({}))
      .then(({ asOf, counts }) => ({ asOf, counts })).catch(() => null),
  ]);
  return { inquiries, questions, lowReviews, unansweredReviews, unreadChats, reviewInsights };
}
