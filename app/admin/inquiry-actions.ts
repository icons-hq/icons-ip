'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { sendInquiryAnsweredEmail } from '@/lib/email/transactional.server';
import {
  buildInquiryUploadPath,
  inquiryCategoryLabel,
  MAX_INQUIRY_BODY_LENGTH,
  MAX_INQUIRY_IMAGES,
  normalizeInquiryReplyForm,
} from '@/lib/inquiries';
import { createClient } from '@/lib/supabase/server';

/* 어드민 문의 답변·종결·템플릿(#253).
 *
 * 답변 등록과 인앱 알림은 DB 한 트랜잭션 안에서 끝난다(admin_answer_inquiry).
 * 메일만 그 뒤에 보낸다 — HTTP는 트랜잭션에 넣을 수 없고, 메일 실패가 답변 등록을
 * 되돌리면 운영자는 "답변이 사라졌다"를 보게 된다.
 *
 * 메일 발송 결과는 삼키지 않고 문구로 알린다. 조용히 성공으로 보고하면 구매자가
 * 메일을 못 받은 사실을 아무도 모른다. */

const USER_UPLOADS_BUCKET = 'user-uploads';

export interface AdminInquiryActionState {
  errors?: { body?: string; images?: string; form?: string };
  message?: string;
  /**
   * 성공한 발송마다 새로 생기는 값.
   *
   * 화면이 "방금 보냈다"를 알아채고 작성창을 비우는 신호다. 문구만 보고 판단하면
   * 두 번째 발송의 문구가 첫 번째와 같아서 작성창이 비지 않고, 남아 있는 답변을
   * 운영자가 한 번 더 보낸다.
   */
  resultKey?: string;
}

const ANSWER_FAILED = '답변을 등록하지 못했습니다. 최신 상태를 확인해주세요.';
const CLOSE_FAILED = '문의를 종결하지 못했습니다. 최신 상태를 확인해주세요.';
const TEMPLATE_FAILED = '답변 템플릿을 저장하지 못했습니다.';
const UPLOAD_FAILED = '첨부 이미지를 업로드하지 못했습니다. 다시 시도해주세요.';

interface AnswerRow {
  message_id: string;
  recipient_id: string;
  recipient_email: string | null;
  inquiry_reference: number;
  inquiry_title: string;
}

async function requireStaffAction(): Promise<{ error?: AdminInquiryActionState; userId?: string }> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/admin/cs/inquiries')}`);
  }
  if (!auth.isStaff) return { error: { errors: { form: '관리자 권한이 필요합니다.' } } };
  return { userId: auth.user.id };
}

function rpcErrorMessage(message: string | null | undefined, fallback: string) {
  const value = (message ?? '').toLowerCase();
  if (value.includes('inquiry_closed')) {
    return '종결된 문의에는 답변할 수 없습니다. 구매자가 새 문의를 접수하면 이어서 답변할 수 있습니다.';
  }
  if (value.includes('inquiry_not_found')) return '문의를 찾을 수 없습니다.';
  return fallback;
}

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function answerInquiryAction(
  _state: AdminInquiryActionState,
  formData: FormData,
): Promise<AdminInquiryActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.userId) return access.error ?? { errors: { form: ANSWER_FAILED } };

  const normalized = normalizeInquiryReplyForm(formData);
  if (!normalized.ok) {
    return {
      errors: {
        body: normalized.errors.body ?? undefined,
        images: normalized.errors.images ?? undefined,
        form: normalized.errors.form ?? undefined,
      },
    };
  }

  const supabase = await createClient();
  const paths: string[] = [];
  for (const image of normalized.value.images) {
    const path = buildInquiryUploadPath({
      userId: access.userId,
      mimeType: image.type,
      nonce: crypto.randomUUID(),
    });
    const { error } = await supabase.storage
      .from(USER_UPLOADS_BUCKET)
      .upload(path, image, { contentType: image.type, upsert: false });
    if (error) return { errors: { images: UPLOAD_FAILED } };
    paths.push(path);
  }

  const { data, error } = await supabase.rpc('admin_answer_inquiry', {
    target_body: normalized.value.body,
    target_image_paths: paths,
    target_inquiry_id: normalized.value.inquiryId,
  });

  if (error) return { errors: { form: rpcErrorMessage(error.message, ANSWER_FAILED) } };

  const row = (Array.isArray(data) ? data[0] : data) as AnswerRow | null;
  if (!row) return { errors: { form: ANSWER_FAILED } };

  const delivery = await sendInquiryAnsweredEmail({
    answerBody: normalized.value.body,
    categoryLabel: inquiryCategoryLabel(readString(formData, 'category')),
    inquiryId: normalized.value.inquiryId,
    messageId: row.message_id,
    recipient: row.recipient_email,
    reference: row.inquiry_reference,
    title: row.inquiry_title,
  });

  revalidatePath('/admin/cs/inquiries');
  revalidatePath(`/admin/cs/inquiries/${normalized.value.inquiryId}`);

  const resultKey = crypto.randomUUID();

  if (delivery.status === 'sent') {
    return { message: '답변을 발송했습니다. 인앱 알림과 메일이 전달됐습니다.', resultKey };
  }
  /* 답변 자체는 등록됐다. 알림은 이미 남았고 메일만 실패했다는 사실을 정확히 말한다 —
     "실패했습니다"로 뭉치면 운영자가 답변을 다시 등록해 같은 답이 두 번 간다. */
  return {
    message: '답변을 등록했고 인앱 알림을 보냈습니다. 메일 발송은 완료되지 않았습니다 — 발송 이력을 확인해주세요.',
    resultKey,
  };
}

export async function closeInquiryAction(
  _state: AdminInquiryActionState,
  formData: FormData,
): Promise<AdminInquiryActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const inquiryId = readString(formData, 'inquiryId');
  if (!inquiryId) return { errors: { form: CLOSE_FAILED } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_close_inquiry', {
    target_inquiry_id: inquiryId,
  });
  if (error) return { errors: { form: rpcErrorMessage(error.message, CLOSE_FAILED) } };

  revalidatePath('/admin/cs/inquiries');
  revalidatePath(`/admin/cs/inquiries/${inquiryId}`);
  return { message: '문의를 종결했습니다.' };
}

export async function saveInquiryReplyTemplateAction(
  _state: AdminInquiryActionState,
  formData: FormData,
): Promise<AdminInquiryActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const title = readString(formData, 'templateTitle');
  const body = readString(formData, 'templateBody');
  if (!title || title.length > 40) {
    return { errors: { form: '템플릿 이름을 40자 이내로 입력해주세요.' } };
  }
  if (!body || body.length > MAX_INQUIRY_BODY_LENGTH) {
    return { errors: { form: `템플릿 본문을 ${MAX_INQUIRY_BODY_LENGTH}자 이내로 입력해주세요.` } };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_inquiry_reply_template', {
    target_body: body,
    target_template_id: readString(formData, 'templateId') || null,
    target_title: title,
  });
  if (error) return { errors: { form: TEMPLATE_FAILED } };

  revalidatePath('/admin/cs/inquiries');
  const inquiryId = readString(formData, 'inquiryId');
  if (inquiryId) revalidatePath(`/admin/cs/inquiries/${inquiryId}`);
  return { message: '답변 템플릿을 저장했습니다.' };
}

export async function deleteInquiryReplyTemplateAction(
  _state: AdminInquiryActionState,
  formData: FormData,
): Promise<AdminInquiryActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const templateId = readString(formData, 'templateId');
  if (!templateId) return { errors: { form: TEMPLATE_FAILED } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_delete_inquiry_reply_template', {
    target_template_id: templateId,
  });
  if (error) return { errors: { form: TEMPLATE_FAILED } };

  revalidatePath('/admin/cs/inquiries');
  const inquiryId = readString(formData, 'inquiryId');
  if (inquiryId) revalidatePath(`/admin/cs/inquiries/${inquiryId}`);
  return { message: '답변 템플릿을 삭제했습니다.' };
}

/** 첨부 제한은 폼과 액션이 같은 값을 봐야 한다. 화면이 import해 안내 문구에 쓴다. */
export const ADMIN_INQUIRY_MAX_IMAGES = MAX_INQUIRY_IMAGES;
