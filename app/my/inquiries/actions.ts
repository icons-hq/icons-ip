'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ACCOUNT_SUSPENDED_PATH,
  isAccountSuspended,
  isOnboarded,
  onboardingPath,
} from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import {
  buildInquiryUploadPath,
  normalizeInquiryForm,
  normalizeInquiryReplyForm,
  type InquiryFormErrors,
} from '@/lib/inquiries';
import { createClient } from '@/lib/supabase/server';

/* 1:1 문의 접수·추가 질문(#253).
 *
 * 문의는 보호 액션이다 — 열람은 공개 브라우징 원칙을 따르지 않는 개인 기록이라
 * 진입 자체에 로그인이 필요하다. 정지 계정은 접수도 추가 질문도 막는다.
 *
 * 상태 전이(사용자 메시지 → open)는 전부 RPC 안에 있다. 여기서는 첨부 업로드와
 * 오류 문구 변환만 한다. */

const USER_UPLOADS_BUCKET = 'user-uploads';

export interface InquiryActionState {
  errors?: InquiryFormErrors;
  message?: string;
  /** 성공한 등록마다 새로 생기는 값. 화면이 입력창을 비우는 신호다. */
  resultKey?: string;
}

const CREATE_FAILED = '문의를 접수하지 못했습니다. 잠시 후 다시 시도해주세요.';
const REPLY_FAILED = '추가 문의를 등록하지 못했습니다. 잠시 후 다시 시도해주세요.';
const UPLOAD_FAILED = '첨부 이미지를 업로드하지 못했습니다. 다시 시도해주세요.';

function loginPath(next: string) {
  return `/login?next=${encodeURIComponent(next)}`;
}

async function requireActiveUser(next: string) {
  const auth = await getCurrentAuthState();

  if (!auth.isConfigured || !auth.user) redirect(loginPath(next));
  if (isAccountSuspended(auth.profile)) redirect(ACCOUNT_SUSPENDED_PATH);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(next));

  return auth.user;
}

/** RPC가 던진 도메인 오류를 사용자 문구로. 모르는 오류는 일반 실패로 접는다. */
function rpcErrorMessage(message: string | null | undefined, fallback: string): InquiryFormErrors {
  const value = (message ?? '').toLowerCase();
  if (value.includes('account_suspended')) {
    return { form: '정지된 계정은 문의를 보낼 수 없습니다.' };
  }
  if (value.includes('inquiry_rate_limited')) {
    return { form: '하루에 접수할 수 있는 문의 수를 넘었습니다. 기존 문의에 이어서 질문해주세요.' };
  }
  if (value.includes('inquiry_order_not_found')) {
    return { form: '연결할 주문을 찾을 수 없습니다. 주문 연결을 해제하고 다시 시도해주세요.' };
  }
  if (value.includes('inquiry_good_not_found')) {
    return { form: '연결할 굿즈를 찾을 수 없습니다. 굿즈 연결을 해제하고 다시 시도해주세요.' };
  }
  if (value.includes('inquiry_closed')) {
    return { form: '종결된 문의입니다. 새 문의로 접수해주세요.' };
  }
  if (value.includes('inquiry_not_found')) {
    return { form: '문의를 찾을 수 없습니다.' };
  }
  return { form: fallback };
}

/**
 * 첨부 업로드.
 *
 * 한 장이라도 실패하면 전체를 실패로 돌린다. 일부만 올라간 채 본문이 저장되면
 * 사용자는 자기가 보낸 증거 사진이 빠진 사실을 알 수 없다.
 */
async function uploadInquiryImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  images: File[],
): Promise<{ ok: true; paths: string[] } | { ok: false }> {
  const paths: string[] = [];

  for (const image of images) {
    const path = buildInquiryUploadPath({
      userId,
      mimeType: image.type,
      nonce: crypto.randomUUID(),
    });
    const { error } = await supabase.storage
      .from(USER_UPLOADS_BUCKET)
      .upload(path, image, { contentType: image.type, upsert: false });

    if (error) return { ok: false };
    paths.push(path);
  }

  return { ok: true, paths };
}

export async function createInquiryAction(
  _state: InquiryActionState,
  formData: FormData,
): Promise<InquiryActionState> {
  const user = await requireActiveUser('/my/inquiries/new');

  const normalized = normalizeInquiryForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const uploaded = await uploadInquiryImages(supabase, user.id, normalized.value.images);
  if (!uploaded.ok) return { errors: { images: UPLOAD_FAILED } };

  const { data, error } = await supabase.rpc('create_inquiry', {
    target_body: normalized.value.body,
    target_category: normalized.value.category,
    target_good_id: normalized.value.goodId,
    target_image_paths: uploaded.paths,
    target_order_id: normalized.value.orderId,
    target_title: normalized.value.title,
  });

  if (error || typeof data !== 'string') {
    return { errors: rpcErrorMessage(error?.message, CREATE_FAILED) };
  }

  revalidatePath('/my/inquiries');
  redirect(`/my/inquiries/${data}`);
}

export async function replyToInquiryAction(
  _state: InquiryActionState,
  formData: FormData,
): Promise<InquiryActionState> {
  const normalized = normalizeInquiryReplyForm(formData);
  const next = normalized.ok ? `/my/inquiries/${normalized.value.inquiryId}` : '/my/inquiries';
  const user = await requireActiveUser(next);

  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const uploaded = await uploadInquiryImages(supabase, user.id, normalized.value.images);
  if (!uploaded.ok) return { errors: { images: UPLOAD_FAILED } };

  const { error } = await supabase.rpc('append_inquiry_message', {
    target_body: normalized.value.body,
    target_image_paths: uploaded.paths,
    target_inquiry_id: normalized.value.inquiryId,
  });

  if (error) return { errors: rpcErrorMessage(error.message, REPLY_FAILED) };

  revalidatePath('/my/inquiries');
  revalidatePath(next);
  return {
    message: '추가 문의를 등록했습니다. 운영자가 확인한 뒤 답변합니다.',
    resultKey: crypto.randomUUID(),
  };
}
