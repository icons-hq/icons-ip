import type { AdminMemberDetail } from './members';
import { ADMIN_VOCABULARY } from './vocabulary';

export const CUSTOMER_TABS = ['overview', 'orders', 'inquiries', 'claims', 'coupons', 'notes'] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];
export const CUSTOMER_TAB_LABELS: Record<CustomerTab, string> = {
  overview: '개요', orders: '주문', inquiries: '문의', claims: ADMIN_VOCABULARY.claims, coupons: '쿠폰', notes: '내부 메모',
};
export const MAX_CUSTOMER_NOTE_LENGTH = 2000;
export interface CustomerDetailFilters { tab: CustomerTab; page: number }
export interface AdminCustomerRow {
  id: string; createdAt: string; title?: string; status?: string; amount?: number;
  itemCount?: number; orderId?: string | null; claimType?: string; code?: string;
  expiresAt?: string | null; body?: string; authorName?: string;
}
export interface AdminCustomerDetail extends CustomerDetailFilters {
  customer: AdminMemberDetail;
  counts: Record<Exclude<CustomerTab, 'overview'>, number>;
  pageSize: number; total: number; items: AdminCustomerRow[];
}
export const isCustomerId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function normalizeCustomerDetailFilters(params: Record<string, string | string[] | undefined>): CustomerDetailFilters {
  return {
    tab: CUSTOMER_TABS.includes(params.tab as CustomerTab) ? params.tab as CustomerTab : 'overview',
    page: Math.min(100000, Math.max(1, Number.parseInt(typeof params.page === 'string' ? params.page : '', 10) || 1)),
  };
}
export function customerDetailHref(userId: string, tab: CustomerTab = 'overview', page = 1) {
  const query = new URLSearchParams();
  if (tab !== 'overview') query.set('tab', tab);
  if (page > 1) query.set('page', String(page));
  return `/admin/customers/${userId}${query.size ? `?${query}` : ''}`;
}
