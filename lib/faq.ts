import { INQUIRY_CATEGORIES, isInquiryCategory, type InquiryCategory } from '@/lib/inquiries';

export const FAQ_CATEGORIES = INQUIRY_CATEGORIES;
export const ADMIN_FAQ_PATH = '/admin/cs/faq';
export const FAQ_PAGE_SIZE = 20;
export const FAQ_QUESTION_MAX_LENGTH = 200;
export const FAQ_ANSWER_MAX_LENGTH = 6000;
export interface FaqEntry {
  id: string;
  category: InquiryCategory;
  question: string;
  answer: string;
  sortOrder: number;
  published: boolean;
  updatedAt: string;
}
export interface FaqFilters {
  query: string;
  category: InquiryCategory | '';
  status: 'all' | 'published' | 'draft';
  page: number;
}
export function normalizeFaqFilters(params: Record<string, string | string[] | undefined>): FaqFilters {
  const scalar = (name: string) => typeof params[name] === 'string' ? params[name] as string : '';
  const category = scalar('category');
  const status = scalar('status');
  return {
    query: scalar('q').trim().slice(0, 200),
    category: isInquiryCategory(category) ? category : '',
    status: status === 'published' || status === 'draft' ? status : 'all',
    page: Math.min(10000, Math.max(1, Number.parseInt(scalar('page'), 10) || 1)),
  };
}
export function faqHref(path: string, filters: FaqFilters, page = filters.page) {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.category) params.set('category', filters.category);
  if (path === ADMIN_FAQ_PATH && filters.status !== 'all') params.set('status', filters.status);
  if (page > 1) params.set('page', String(page));
  return `${path}${params.size ? `?${params}` : ''}`;
}
