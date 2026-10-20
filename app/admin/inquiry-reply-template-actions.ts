'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { INQUIRY_TEMPLATE_CATEGORIES, INQUIRY_TEMPLATE_PAGE_SIZE, INQUIRY_TEMPLATE_PATH,
  parseInquiryReplyTemplate, parseInquiryTemplateMutation, parseInquiryTemplateReceipt,
  type InquiryTemplateList, type InquiryTemplateReceipt, type InquiryReplyTemplate } from '@/lib/admin/inquiry-reply-templates';

type Failure = { error: string; uncertain?: boolean };
function failure(message: string): string {
  if (message.includes('inquiry_template_changed')) return '다른 작업에서 템플릿을 변경했습니다. 입력을 유지했으니 최신 저장본과 비교해주세요.';
  if (message.includes('inquiry_template_archived')) return '삭제된 템플릿입니다. 삭제한 템플릿에서 복구한 뒤 수정해주세요.';
  if (message.includes('inquiry_template_not_found')) return '템플릿을 찾을 수 없습니다. 입력을 유지하고 목록을 다시 확인해주세요.';
  if (message.includes('staff_required')) return '관리자 권한을 확인해주세요.';
  return '템플릿을 저장하지 못했습니다. 입력과 최신 상태를 확인해주세요.';
}
export async function listInquiryReplyTemplatesAction(input: { query: string; category: string; archived: boolean; page: number }): Promise<{ data: InquiryTemplateList } | Failure> {
  if (!await requireAdminActionAccess(INQUIRY_TEMPLATE_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (!input || typeof input.query !== 'string' || input.query.length > 100 || typeof input.archived !== 'boolean'
    || !Number.isSafeInteger(input.page) || input.page < 1 || input.page > 100000
    || (input.category !== '' && !INQUIRY_TEMPLATE_CATEGORIES.some(option => option.value === input.category))) return { error: '검색 조건을 확인해주세요.' };
  try {
    const client = await createClient();
    let request = client.from('inquiry_reply_templates').select('id,category,title,body,revision,archived_at,updated_at', { count: 'exact' });
    request = input.archived ? request.not('archived_at', 'is', null) : request.is('archived_at', null);
    if (input.category) request = request.eq('category', input.category);
    if (input.query.trim()) request = request.ilike('title', `%${input.query.trim().replace(/[\\%_*]/g, char => `\\${char}`)}%`);
    const { data, error, count } = await request.order('title').order('id').range((input.page - 1) * INQUIRY_TEMPLATE_PAGE_SIZE, input.page * INQUIRY_TEMPLATE_PAGE_SIZE - 1);
    if (error || count === null) return { error: '템플릿 목록을 불러오지 못했습니다. 다시 조회해주세요.' };
    const rows = (data ?? []).map(parseInquiryReplyTemplate);
    if (rows.some(row => row === null)) return { error: '템플릿 정보를 확인하지 못했습니다. 다시 조회해주세요.' };
    return { data: { rows: rows as InquiryReplyTemplate[], total: count, page: input.page } };
  } catch (error) { unstable_rethrow(error); return { error: '템플릿 목록을 불러오지 못했습니다. 다시 조회해주세요.' }; }
}
export async function readInquiryReplyTemplateAction(id: string): Promise<{ template: InquiryReplyTemplate | null } | Failure> {
  if (!await requireAdminActionAccess(INQUIRY_TEMPLATE_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (!isUuid(id)) return { error: '템플릿을 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.from('inquiry_reply_templates').select('id,category,title,body,revision,archived_at,updated_at').eq('id', id).maybeSingle();
    if (error) return { error: '최신 저장본을 불러오지 못했습니다. 작성 중인 내용은 유지됩니다.' };
    const template = data === null ? null : parseInquiryReplyTemplate(data);
    return data !== null && !template ? { error: '최신 저장본을 확인하지 못했습니다.' } : { template };
  } catch (error) { unstable_rethrow(error); return { error: '최신 저장본을 불러오지 못했습니다. 작성 중인 내용은 유지됩니다.' }; }
}
export async function readInquiryTemplateOperationAction(operationId: string): Promise<{ receipt: InquiryTemplateReceipt | null } | Failure> {
  if (!await requireAdminActionAccess(INQUIRY_TEMPLATE_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (!isUuid(operationId)) return { error: '저장 요청을 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_get_inquiry_reply_template_operation', { p_operation_id: operationId });
    if (error) return { error: '저장 결과를 확인하지 못했습니다. 같은 요청을 다시 조회해주세요.' };
    const receipt = data === null ? null : parseInquiryTemplateReceipt(data);
    if (data !== null && receipt?.operationId !== operationId) return { error: '저장 결과의 요청 정보를 확인하지 못했습니다.' };
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과를 확인하지 못했습니다. 같은 요청을 다시 조회해주세요.' }; }
}
export async function mutateInquiryReplyTemplateAction(input: unknown): Promise<{ receipt: InquiryTemplateReceipt } | Failure> {
  if (!await requireAdminActionAccess(INQUIRY_TEMPLATE_PATH)) return { error: '관리자 권한이 필요합니다.' };
  const value = parseInquiryTemplateMutation(input);
  if (!value) return { error: '유형을 고르고 제목은 40자, 내용은 2,000자 이내로 입력해주세요.' };
  try {
    const client = await createClient();
    const { error } = await client.rpc('admin_mutate_inquiry_reply_template', { p_operation_id: value.operationId,
      p_template_id: value.templateId, p_expected_revision: value.revision, p_action: value.action, p_values: value.values });
    if (error) return { error: failure(error.message), uncertain: !error.code || !['22023','23514','PT409','42501','P0002'].includes(error.code) || error.message.includes('operation_conflict') };
    const { data, error: readError } = await client.rpc('admin_get_inquiry_reply_template_operation', { p_operation_id: value.operationId });
    const receipt = parseInquiryTemplateReceipt(data);
    if (readError || !receipt || receipt.operationId !== value.operationId || receipt.templateId !== value.templateId || receipt.action !== value.action) {
      return { error: '저장 결과가 불확실합니다. 같은 요청의 결과를 먼저 확인해주세요.', uncertain: true };
    }
    revalidatePath(INQUIRY_TEMPLATE_PATH);
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과가 불확실합니다. 같은 요청의 결과를 먼저 확인해주세요.', uncertain: true }; }
}
