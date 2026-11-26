export const OVERSEAS_METHOD = 'overseas_document@2026-11-26';
export const OVERSEAS_REVIEW_PATH = '/my/adult-verification/overseas';
export const OVERSEAS_ADMIN_PATH = '/admin/settings/overseas-adult';
export const OVERSEAS_PRIVACY_EFFECTIVE_DATE = '2026-11-26';
export const OVERSEAS_UPLOAD_LIMIT = 3 * 1024 * 1024;

export interface OverseasRequest {
  number: number;
  id: string;
  state: 'draft' | 'uploading' | 'pending' | 'reviewing' | 'purging' | 'closed';
  outcome: 'approved' | 'underage' | 'rejected' | 'expired' | 'cancelled' | null;
  expiresAt: string;
  validUntil: string | null;
}
export interface OverseasQueueItem {
  number: number;
  id: string;
  submittedAt: string;
}
export type OverseasIntakeStatus = 'open' | 'policy_pending' | 'store_closed' | 'review_paused';

export type DocumentGender = 'M' | 'F' | 'X';
export type DocumentIdentity = { name: string; gender: DocumentGender };

export function documentIdentity(name: unknown, gender: unknown): DocumentIdentity | null {
  if (typeof name !== 'string' || (gender !== 'M' && gender !== 'F' && gender !== 'X')) return null;
  const normalized = name.trim().normalize('NFC');
  if (normalized.length > 100 || !/\p{Script=Latin}/u.test(normalized)
    || !/^[\p{Script=Latin}\p{Mark} .’'\p{Dash_Punctuation}]+$/u.test(normalized)) return null;
  return { name: normalized, gender };
}
