import { isUuid } from '@/lib/uuid';
import { MAX_INQUIRY_BODY_LENGTH } from '@/lib/inquiries';
import { CS_REPLY_TEMPLATE_CATEGORIES, type CsReplyTemplateCategory } from './cs-reply-tools';

export { CS_REPLY_TEMPLATE_CATEGORIES as INQUIRY_TEMPLATE_CATEGORIES };
export const INQUIRY_TEMPLATE_TITLE_LIMIT = 40;
export const INQUIRY_TEMPLATE_BODY_LIMIT = MAX_INQUIRY_BODY_LENGTH;
export const INQUIRY_TEMPLATE_PAGE_SIZE = 20;
export const INQUIRY_TEMPLATE_PATH = '/admin/cs/inquiries';
export interface InquiryReplyTemplate {
  id: string; category: CsReplyTemplateCategory; title: string; body: string;
  revision: number; archivedAt: string | null; updatedAt: string;
}
export interface InquiryTemplateList { rows: InquiryReplyTemplate[]; total: number; page: number }
export interface InquiryTemplateDraft { id: string; category: CsReplyTemplateCategory; title: string; body: string; revision: number }
export type InquiryTemplateMutation = {
  operationId: string; templateId: string; revision: number; action: 'save' | 'archive' | 'restore';
  values: { category: CsReplyTemplateCategory; title: string; body: string } | Record<string, never>;
};
export interface InquiryTemplateReceipt {
  operationId: string; templateId: string; action: InquiryTemplateMutation['action']; template: InquiryReplyTemplate;
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const category = (value: unknown): value is CsReplyTemplateCategory => CS_REPLY_TEMPLATE_CATEGORIES.some(option => option.value === value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function parseInquiryReplyTemplate(value: unknown): InquiryReplyTemplate | null {
  if (!record(value) || !isUuid(value.id) || !category(value.category) || typeof value.title !== 'string' || typeof value.body !== 'string'
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !timestamp(value.updated_at)
    || !(value.archived_at === null || timestamp(value.archived_at))) return null;
  return { id: value.id, category: value.category, title: value.title, body: value.body,
    revision: Number(value.revision), archivedAt: value.archived_at, updatedAt: value.updated_at };
}
export function parseInquiryTemplateMutation(value: unknown): InquiryTemplateMutation | null {
  if (!record(value) || Object.keys(value).some(key => !['operationId','templateId','revision','action','values'].includes(key))
    || !isUuid(value.operationId) || !isUuid(value.templateId) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || !['save','archive','restore'].includes(String(value.action)) || !record(value.values)) return null;
  const common = { operationId: value.operationId.toLowerCase(), templateId: value.templateId.toLowerCase(), revision: Number(value.revision) };
  if (value.action !== 'save') {
    return common.revision > 0 && Object.keys(value.values).length === 0 ? { ...common, action: value.action as 'archive' | 'restore', values: {} } : null;
  }
  if (Object.keys(value.values).length !== 3 || !category(value.values.category) || typeof value.values.title !== 'string' || typeof value.values.body !== 'string') return null;
  const title = value.values.title.trim(), body = value.values.body.trim();
  // Keep the existing inquiry form's UTF-16 length boundary so insertion stays sendable.
  if (title.length < 1 || title.length > INQUIRY_TEMPLATE_TITLE_LIMIT || /[\u0000-\u001f\u007f]/.test(title)
    || body.length < 1 || body.length > INQUIRY_TEMPLATE_BODY_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) return null;
  return { ...common, action: 'save', values: { category: value.values.category, title, body } };
}
export function parseInquiryTemplateReceipt(value: unknown): InquiryTemplateReceipt | null {
  if (!record(value) || !isUuid(value.operationId) || !isUuid(value.templateId) || !['save','archive','restore'].includes(String(value.action))) return null;
  const template = parseInquiryReplyTemplate(value.template);
  return template?.id === value.templateId ? { operationId: value.operationId, templateId: value.templateId, action: value.action as InquiryTemplateMutation['action'], template } : null;
}
/** R3(MD-0011): 답변 템플릿 공통 안내·확인 문구. 고객문의·상담하기·상품문의·리뷰 답변이 같은 문구를 쓴다. */
export const REPLY_TEMPLATE_REPLACE_HINT = '템플릿을 고르면 작성 중인 내용을 템플릿으로 바꿉니다.';
export const REPLY_TEMPLATE_REPLACE_CONFIRM = '작성 중인 내용을 템플릿으로 바꿀까요?';
/** 템플릿은 작성 중인 답변을 대체한다. 작성 중인 내용이 있으면(replaces) 화면이 확인을 거친 뒤에만 적용한다. */
export function applyInquiryReplyTemplate(current: string, template: string): { ok: true; body: string; replaces: boolean } | { ok: false; error: string } {
  if (template.length > INQUIRY_TEMPLATE_BODY_LIMIT) return { ok: false, error: '템플릿이 답변의 2,000자 제한을 넘어 불러올 수 없습니다. 템플릿을 줄여주세요.' };
  return { ok: true, body: template, replaces: Boolean(current.trim()) && current !== template };
}
