export const OVERSEAS_METHOD = 'overseas_manual@2026-11-26';
export const OVERSEAS_REVIEW_PATH = '/my/adult-verification/overseas';
export const OVERSEAS_ADMIN_PATH = '/admin/settings/overseas-adult';
export const OVERSEAS_PRIVACY_EFFECTIVE_DATE = '2026-12-04';
export const OVERSEAS_UPLOAD_LIMIT = 3 * 1024 * 1024;

export interface OverseasRequest {
  number: number;
  id: string;
  state: 'draft' | 'uploading' | 'pending' | 'reviewing' | 'purging' | 'closed';
  outcome: 'approved' | 'underage' | 'rejected' | 'expired' | 'cancelled' | null;
  challenge: string | null;
  expiresAt: string;
  validUntil: string | null;
}
export interface OverseasQueueItem {
  number: number;
  id: string;
  submittedAt: string;
}
export interface OverseasReviewGood {
  id: string;
  name: string;
  enabled: boolean;
}
