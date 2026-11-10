import { isInquiryCategory, isInquiryStatus, type InquiryCategory, type InquiryMessageAuthor, type InquiryStatus } from '@/lib/inquiries';
import { isUuid } from '@/lib/uuid';

export const ADMIN_INQUIRY_CHAT_PATH = '/admin/cs/chat';
export const ADMIN_INQUIRY_CHAT_PAGE_SIZE = 30;
export const CHAT_STATUS_OPTIONS = [
  { value: 'all', label: '전체' }, { value: 'open', label: '대기' },
  { value: 'answered', label: '진행중' }, { value: 'closed', label: '완료' },
] as const;
export const CHAT_PERIOD_OPTIONS = [
  { value: '7d', label: '최근 1주일' }, { value: '30d', label: '최근 1개월' }, { value: 'all', label: '전체 기간' },
] as const;
export type InquiryChatStatus = typeof CHAT_STATUS_OPTIONS[number]['value'];
export interface InquiryChatFilters {
  status: InquiryChatStatus;
  assignee: string;
  period: '7d' | '30d' | 'all';
  read: 'all' | 'unread' | 'read';
  sort: 'recent' | 'oldest';
  query: string;
  page: number;
}
export interface InquiryChatRow {
  id: string; reference: number; title: string; category: InquiryCategory; status: InquiryStatus;
  buyerName: string; assigneeId: string | null; assigneeName: string | null;
  lastMessageAt: string; preview: string; previewAuthor: InquiryMessageAuthor; unreadCount: number;
  tags?: string[];
}
export interface InquiryChatData {
  rows: InquiryChatRow[]; total: number; counts: Record<InquiryChatStatus, number>;
  unreadMessages: number; staffOptions: { id: string; name: string }[];
}
export interface InquiryChatContext {
  inquiryId: string; tags: string[]; previousCount: number;
  previous: { id: string; reference: number; title: string; status: InquiryStatus; lastMessageAt: string }[];
}

export function normalizeInquiryChatFilters(params: Record<string, string | string[] | undefined>): InquiryChatFilters {
  const single = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const assignee = single('assignee');
  const query = single('query').trim();
  const page = Number(single('page'));
  return {
    status: CHAT_STATUS_OPTIONS.some(option => option.value === single('status')) ? single('status') as InquiryChatStatus : 'all',
    assignee: ['all', 'me', 'unassigned'].includes(assignee) || isUuid(assignee) ? assignee.toLowerCase() : 'all',
    period: CHAT_PERIOD_OPTIONS.some(option => option.value === single('period')) ? single('period') as InquiryChatFilters['period'] : '7d',
    read: ['unread', 'read'].includes(single('read')) ? single('read') as InquiryChatFilters['read'] : 'all',
    sort: single('sort') === 'oldest' ? 'oldest' : 'recent',
    query: query.length <= 100 ? query : '',
    page: Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1,
  };
}

export function inquiryChatHref(filters: InquiryChatFilters, overrides: Partial<InquiryChatFilters> = {}, inquiryId?: string) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.status !== 'all') params.set('status', next.status);
  if (next.assignee !== 'all') params.set('assignee', next.assignee);
  if (next.period !== '7d') params.set('period', next.period);
  if (next.read !== 'all') params.set('read', next.read);
  if (next.sort !== 'recent') params.set('sort', next.sort);
  if (next.query) params.set('query', next.query);
  if (next.page > 1) params.set('page', String(next.page));
  if (inquiryId && isUuid(inquiryId)) params.set('inquiryId', inquiryId);
  return `${ADMIN_INQUIRY_CHAT_PATH}${params.size ? `?${params}` : ''}`;
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function tags(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 10 && value.every(tag => typeof tag === 'string' && tag.length > 0 && [...tag].length <= 20 && tag === tag.trim() && !/[\u0000-\u001f\u007f]/.test(tag))
    && new Set(value).size === value.length;
}

export function parseInquiryChatContext(value: unknown): InquiryChatContext | null {
  if (!record(value) || !isUuid(value.inquiryId) || !tags(value.tags) || !count(value.previousCount)
    || !Array.isArray(value.previous) || value.previous.length > 20 || value.previous.length > value.previousCount
    || value.previous.some(row => !record(row) || !isUuid(row.id) || row.id === value.inquiryId || !count(row.reference) || row.reference === 0
      || typeof row.title !== 'string' || !isInquiryStatus(row.status) || typeof row.lastMessageAt !== 'string' || !Number.isFinite(Date.parse(row.lastMessageAt)))
    || new Set(value.previous.map(row => row.id)).size !== value.previous.length) return null;
  return value as unknown as InquiryChatContext;
}

/** A malformed reader is an error, never a convincing empty inbox. */
export function parseInquiryChatData(value: unknown): InquiryChatData | null {
  if (!record(value) || !Array.isArray(value.rows) || value.rows.length > 100 || !count(value.total)
    || value.rows.length > value.total || !record(value.counts) || !count(value.unreadMessages)
    || !CHAT_STATUS_OPTIONS.every(option => count((value.counts as Record<string, unknown>)[option.value]))
    || !Array.isArray(value.staffOptions) || value.staffOptions.some(staff => !record(staff) || !isUuid(staff.id) || typeof staff.name !== 'string')) return null;
  const counts = value.counts as Record<InquiryChatStatus, number>;
  if (counts.all !== counts.open + counts.answered + counts.closed || value.total > counts.all) return null;
  const rows: InquiryChatRow[] = [];
  for (const row of value.rows) {
    if (!record(row) || !isUuid(row.id) || !count(row.reference) || row.reference === 0 || typeof row.title !== 'string'
      || !isInquiryCategory(row.category) || !isInquiryStatus(row.status) || typeof row.buyer_name !== 'string'
      || !(row.assignee_id === null || isUuid(row.assignee_id)) || !nullableString(row.assignee_name)
      || typeof row.last_message_at !== 'string' || !Number.isFinite(Date.parse(row.last_message_at))
      || typeof row.preview !== 'string' || !['user', 'staff', 'system'].includes(String(row.preview_author)) || !count(row.unread_count)
      || (row.tags !== undefined && !tags(row.tags))) return null;
    rows.push({ id: row.id, reference: row.reference, title: row.title, category: row.category, status: row.status,
      buyerName: row.buyer_name, assigneeId: row.assignee_id, assigneeName: row.assignee_name,
      lastMessageAt: row.last_message_at, preview: row.preview, previewAuthor: row.preview_author as InquiryMessageAuthor, unreadCount: row.unread_count, tags: row.tags as string[] | undefined });
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length || rows.reduce((sum, row) => sum + row.unreadCount, 0) > value.unreadMessages) return null;
  return { rows, total: value.total, counts, unreadMessages: value.unreadMessages, staffOptions: value.staffOptions as InquiryChatData['staffOptions'] };
}
