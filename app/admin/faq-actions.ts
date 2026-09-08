'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { ADMIN_FAQ_PATH, FAQ_ANSWER_MAX_LENGTH, FAQ_QUESTION_MAX_LENGTH } from '@/lib/faq';
import { isInquiryCategory } from '@/lib/inquiries';

export interface FaqActionState {
  errors?: Record<string, string>;
  values?: Record<string, string>;
  revision?: number;
  message?: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = ['id', 'category', 'question', 'answer', 'sortOrder', 'published', 'updatedAt'] as const;

async function staffAllowed() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent(ADMIN_FAQ_PATH)}`);
  return auth.isStaff;
}
function invalidate() {
  revalidatePath(ADMIN_FAQ_PATH);
  revalidatePath('/help');
  revalidatePath('/my/inquiries/new');
}
function errorMessage(message: string) {
  if (message.includes('faq_conflict')) return '다른 운영자가 수정했습니다. 입력값을 복사한 뒤 새로고침해 최신 내용을 확인해주세요.';
  if (message.includes('faq_not_found')) return 'FAQ를 찾을 수 없습니다. 삭제되었을 수 있습니다.';
  if (message.includes('staff_required')) return '관리자 권한이 필요합니다.';
  return 'FAQ를 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.';
}
export async function saveFaqAction(previous: FaqActionState, data: FormData): Promise<FaqActionState> {
  const values = Object.fromEntries(FIELDS.map((name) => [name, typeof data.get(name) === 'string' ? data.get(name) as string : '']));
  const revision = (previous.revision ?? 0) + 1;
  const failure = (errors: Record<string, string>): FaqActionState => ({ values, revision, errors });
  if (!await staffAllowed()) return failure({ form: '관리자 권한이 필요합니다.' });
  const errors: Record<string, string> = {};
  const question = values.question.trim();
  const answer = values.answer.trim();
  if (values.id && !UUID.test(values.id)) errors.form = 'FAQ를 찾을 수 없습니다.';
  if (!isInquiryCategory(values.category)) errors.category = '카테고리를 선택해주세요.';
  if (!question || question.length > FAQ_QUESTION_MAX_LENGTH) errors.question = `질문은 1~${FAQ_QUESTION_MAX_LENGTH}자로 입력해주세요.`;
  if (!answer || answer.length > FAQ_ANSWER_MAX_LENGTH) errors.answer = `답변은 1~${FAQ_ANSWER_MAX_LENGTH}자로 입력해주세요.`;
  if (!/^\d{1,4}$/.test(values.sortOrder)) errors.sortOrder = '순서는 0~9999 사이 정수로 입력해주세요.';
  if (values.published !== 'true' && values.published !== 'false') errors.published = '게시 상태를 선택해주세요.';
  if (values.id && (!values.updatedAt || Number.isNaN(Date.parse(values.updatedAt)))) errors.form = '최신 FAQ를 다시 열어주세요.';
  if (Object.keys(errors).length) return failure(errors);
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_save_faq_entry', {
    target_id: values.id || null, target_category: values.category,
    target_question: question, target_answer: answer, target_sort_order: Number(values.sortOrder),
    target_published: values.published === 'true', expected_updated_at: values.updatedAt || null,
  });
  if (error) return failure({ form: errorMessage(error.message) });
  invalidate();
  return { revision, message: values.published === 'true' ? 'FAQ를 저장하고 공개했습니다.' : 'FAQ를 비공개로 저장했습니다.' };
}
export async function deleteFaqAction(previous: FaqActionState, data: FormData): Promise<FaqActionState> {
  const revision = (previous.revision ?? 0) + 1;
  if (!await staffAllowed()) return { revision, errors: { form: '관리자 권한이 필요합니다.' } };
  const id = String(data.get('id') ?? '');
  const updatedAt = String(data.get('updatedAt') ?? '');
  if (!UUID.test(id) || !updatedAt || Number.isNaN(Date.parse(updatedAt))) return { revision, errors: { form: '최신 FAQ를 다시 열어주세요.' } };
  if (data.get('confirmed') !== 'true') return { revision, errors: { form: '삭제 확인을 선택해주세요.' } };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_delete_faq_entry', { target_id: id, expected_updated_at: updatedAt });
  if (error) return { revision, errors: { form: errorMessage(error.message) } };
  invalidate();
  return { revision, message: 'FAQ를 삭제했습니다.' };
}
