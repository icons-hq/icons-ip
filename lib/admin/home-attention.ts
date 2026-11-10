import type { AdminInquiryRow } from './inquiries';
import type { AdminProductQuestionRow } from './product-questions';
import type { AdminReviewRow } from './reviews';
import type { InquiryChatData, InquiryChatRow } from './inquiry-chat';
import type { ReviewInsights } from './review-insights';
export interface HomeAttentionGroup<T> { total: number; rows: T[]; }
export interface AdminHomeAttention {
  unreadChats: (HomeAttentionGroup<InquiryChatRow> & Pick<InquiryChatData, 'counts'>) | null;
  inquiries: HomeAttentionGroup<AdminInquiryRow> | null;
  questions: HomeAttentionGroup<AdminProductQuestionRow> | null;
  lowReviews: HomeAttentionGroup<AdminReviewRow> | null;
  unansweredReviews: HomeAttentionGroup<AdminReviewRow> | null;
  reviewInsights: Pick<ReviewInsights, 'asOf' | 'counts'> | null;
}
