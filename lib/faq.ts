import { INQUIRY_CATEGORIES, isInquiryCategory, type InquiryCategory } from '@/lib/inquiries';

export const FAQ_CATEGORIES = INQUIRY_CATEGORIES;
export const ADMIN_FAQ_PATH = '/admin/cs/faq';
export const FAQ_PAGE_SIZE = 20;
export const FAQ_QUESTION_MAX_LENGTH = 200;
export const FAQ_ANSWER_MAX_LENGTH = 6000;

/*
 * 상담 위젯의 '버튼형 자주 묻는 질문'(0901-044). FAQ 위 유형 버튼을 누르면 운영자가 FAQ 관리에서 그 버튼에
 * 지정한 대표 FAQ를 보인다. 지정이 없거나 비공개면 연결된 카테고리의 공개 FAQ 중 질문에 그 버튼의 낱말이 든 것을
 * 표시 순서대로 먼저 보이고, 하나도 없을 때만 그 카테고리의 공개 FAQ 목록을 보인다. 취소와 교환/반품은 같은
 * 카테고리(취소/반품/교환)라 낱말로 갈라야 '교환/반품'을 눌렀을 때 취소 FAQ가 먼저 나오지 않는다.
 * 답변 문구의 정본은 운영 FAQ다. 버튼 이름·카테고리·낱말만 코드가 정한다(DB 값은 faq_entries.widget_topic).
 */
export const FAQ_WIDGET_TOPICS = [
  { id: 'delivery', label: '배송 언제 오나요', category: 'order', keywords: ['배송'] },
  { id: 'cancel', label: '취소', category: 'claim', keywords: ['취소'] },
  { id: 'return', label: '교환/반품', category: 'claim', keywords: ['교환', '반품'] },
] as const satisfies readonly { id: string; label: string; category: InquiryCategory; keywords: readonly string[] }[];
export type FaqWidgetTopic = (typeof FAQ_WIDGET_TOPICS)[number]['id'];
/** 대표 FAQ가 없을 때 버튼 아래에 보일 공개 FAQ 수. */
export const FAQ_WIDGET_TOPIC_LIST_SIZE = 5;
/** 낱말 후보를 찾을 때 공개 FAQ 검색에서 받는 최대 수(검색 RPC 상한과 같다). */
export const FAQ_WIDGET_TOPIC_SEARCH_LIMIT = 50;

export function isFaqWidgetTopic(value: unknown): value is FaqWidgetTopic {
  return typeof value === 'string' && FAQ_WIDGET_TOPICS.some((topic) => topic.id === value);
}
export function faqWidgetTopic(id: FaqWidgetTopic) {
  return FAQ_WIDGET_TOPICS.find((topic) => topic.id === id)!;
}
/** 질문(답변이 아니라)에 그 버튼의 낱말이 들었는지. 공개 FAQ 검색은 답변까지 보므로 이것으로 다시 거른다. */
export function faqQuestionMatchesWidgetTopic(question: string, topic: FaqWidgetTopic): boolean {
  return faqWidgetTopic(topic).keywords.some((keyword) => question.includes(keyword));
}

export interface FaqEntry {
  id: string;
  category: InquiryCategory;
  question: string;
  answer: string;
  sortOrder: number;
  published: boolean;
  updatedAt: string;
  /** 이 FAQ를 대표 답변으로 지정한 위젯 버튼. 공개 검색 RPC 결과에는 없다. */
  widgetTopic?: FaqWidgetTopic | null;
}

/** `/api/help?topic=`의 응답. 대표 FAQ가 있으면 entry, 없으면 낱말이 든 공개 FAQ 또는 카테고리 공개 FAQ 목록(entries). */
export interface FaqWidgetTopicAnswer {
  topic: FaqWidgetTopic;
  entry: FaqEntry | null;
  entries: FaqEntry[];
}

/** FAQ 관리 화면 머리의 '상담 위젯 버튼 답변' 요약 한 줄. */
export interface FaqWidgetTopicDesignation {
  topic: FaqWidgetTopic;
  id: string;
  question: string;
  published: boolean;
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
