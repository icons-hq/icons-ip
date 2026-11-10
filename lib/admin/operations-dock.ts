export const ADMIN_ALERT_CATEGORIES = [
  ['all', '전체'], ['orders', '주문'], ['claims', '취소·반품·교환'],
  ['inquiries', '고객문의'], ['questions', '상품문의'], ['reviews', '리뷰'],
] as const;
export type AdminAlertCategory = typeof ADMIN_ALERT_CATEGORIES[number][0];
const ALERT_CAPABILITIES: Record<Exclude<AdminAlertCategory, 'all'>, AdminCapability> = {
  orders: 'sales.read', claims: 'sales.manage', inquiries: 'cs.manage', questions: 'cs.manage', reviews: 'cs.manage',
};
export function allowedAdminAlertCategories(access: AdminAccessSource) {
  return ADMIN_ALERT_CATEGORIES.filter(([category]) => category === 'all' || hasAdminCapability(access, ALERT_CAPABILITIES[category]));
}
export type AdminAlertFilterState = 'all' | 'unread' | 'hidden';
export interface AdminOperationAlert { id: string; category: Exclude<AdminAlertCategory, 'all'>; title: string; href: string; createdAt: string; readAt: string | null; hiddenAt: string | null }
export interface AdminAlertPage { items: AdminOperationAlert[]; hasMore: boolean; unreadCount: number; badgeEnabled: boolean; asOf: string }
export interface AdminOperationTask { id: string; label: string; count: number; href: string }
export interface AdminHelpEntry { id: string; title: string; topic: string; href: string; paragraphs: string[]; links: { href: string; label: string }[] }
export interface AdminHelpResult { entries: AdminHelpEntry[]; total: number }

export function adminAlertCategory(value: unknown): AdminAlertCategory {
  return ADMIN_ALERT_CATEGORIES.some(([key]) => key === value) ? value as AdminAlertCategory : 'all';
}
export function adminAlertFilterState(value: unknown): AdminAlertFilterState {
  return value === 'unread' || value === 'hidden' ? value : 'all';
}
import { hasAdminCapability, type AdminAccessSource, type AdminCapability } from './access';
