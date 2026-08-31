'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ADMIN_PRODUCT_QUESTIONS_PATH } from '@/lib/admin/product-questions';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/* 어드민 상품 Q&A 답변·비노출 (S8 #330).
 *
 * 두 액션 모두 DB RPC 한 번으로 끝난다. 답변 알림도 감사 로그도 같은 트랜잭션 안에
 * 있다 — 여기서 나눠 부르면 답변은 달렸는데 알림은 안 간 상태가 만들어진다.
 *
 * 이 파일이 하는 일은 폼 값 정규화와 오류 문구 변환뿐이다. 권한 판정은 RPC 안에 한
 * 번 더 있다 — 여기서만 막으면 액션을 새로 만드는 사람이 게이트를 빠뜨린다. */

export interface AdminQnaActionState {
  errors?: { answer?: string; form?: string };
  message?: string;
  /**
   * 성공한 처리마다 새로 생기는 값. 화면이 입력창을 다시 그리는 신호다.
   * 문구만 보고 판단하면 두 번째 저장의 문구가 첫 번째와 같아 창이 갱신되지 않는다.
   */
  resultKey?: string;
}

const ANSWER_FAILED = '답변을 저장하지 못했습니다. 최신 상태를 확인해주세요.';
const VISIBILITY_FAILED = '노출 상태를 변경하지 못했습니다. 최신 상태를 확인해주세요.';
const ANSWER_MAX_LENGTH = 2000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readUuid(formData: FormData, name: string) {
  const value = readString(formData, name).toLowerCase();
  return UUID_PATTERN.test(value) ? value : null;
}

async function requireStaffAction(): Promise<AdminQnaActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent(ADMIN_PRODUCT_QUESTIONS_PATH)}`);
  }
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };
  return null;
}

/** RPC가 던진 도메인 오류를 운영자 문구로. 모르는 오류는 일반 실패로 접는다. */
function rpcErrorMessage(message: string | null | undefined, fallback: string) {
  const value = (message ?? '').toLowerCase();
  if (value.includes('question_not_found')) {
    return '질문을 찾을 수 없습니다. 작성자가 삭제했을 수 있습니다.';
  }
  if (value.includes('invalid_question_answer')) {
    return `답변은 1자 이상 ${ANSWER_MAX_LENGTH}자 이내로 입력해주세요.`;
  }
  if (value.includes('forbidden') || value.includes('auth_required')) {
    return '관리자 권한이 필요합니다.';
  }
  return fallback;
}

/**
 * 굿즈 상세를 다시 그린다.
 *
 * Q&A는 굿즈 상세에 공개로 붙는다 — 답변을 등록했는데 상세가 옛 목록을 보여 주면
 * 운영자는 저장이 안 된 줄 알고 같은 답변을 다시 넣는다(그때마다 알림이 또 간다).
 * 동적 세그먼트라 경로 하나로는 닿지 않아 라우트 단위로 만료시킨다.
 */
function revalidateQuestionSurfaces() {
  revalidatePath(ADMIN_PRODUCT_QUESTIONS_PATH);
  revalidatePath('/shop/[goodId]', 'page');
}

export async function answerProductQuestionAction(
  _state: AdminQnaActionState,
  formData: FormData,
): Promise<AdminQnaActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const questionId = readUuid(formData, 'questionId');
  const answer = readString(formData, 'answer');

  if (!questionId) return { errors: { form: '질문을 찾을 수 없습니다.' } };
  if (!answer) return { errors: { answer: '답변 내용을 입력해주세요.' } };
  if (answer.length > ANSWER_MAX_LENGTH) {
    return { errors: { answer: `답변은 ${ANSWER_MAX_LENGTH}자 이내로 입력해주세요.` } };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_answer_product_question', {
    target_answer_body: answer,
    target_question_id: questionId,
  });

  if (error) return { errors: { form: rpcErrorMessage(error.message, ANSWER_FAILED) } };

  revalidateQuestionSurfaces();
  return {
    message: '답변을 저장했습니다. 굿즈 상세에 공개되고 작성자에게 알림이 갑니다.',
    resultKey: crypto.randomUUID(),
  };
}

/**
 * 비노출·복원.
 *
 * 행을 지우지 않고 상태만 바꾼다 — 원문이 남아야 왜 내렸는지 검증할 수 있고,
 * 작성자는 내려간 자기 질문을 계속 볼 수 있다(그래야 이유를 물어볼 수 있다).
 */
export async function setProductQuestionVisibilityAction(
  _state: AdminQnaActionState,
  formData: FormData,
): Promise<AdminQnaActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const questionId = readUuid(formData, 'questionId');
  const hidden = readString(formData, 'hidden');

  if (!questionId) return { errors: { form: '질문을 찾을 수 없습니다.' } };
  if (hidden !== 'true' && hidden !== 'false') {
    return { errors: { form: '변경할 상태를 찾을 수 없습니다.' } };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_product_question_visibility', {
    target_hidden: hidden === 'true',
    target_question_id: questionId,
  });

  if (error) return { errors: { form: rpcErrorMessage(error.message, VISIBILITY_FAILED) } };

  revalidateQuestionSurfaces();
  return {
    message: hidden === 'true'
      ? '질문을 비노출 처리했습니다. 굿즈 상세에서 즉시 빠집니다.'
      : '질문을 다시 공개했습니다.',
    resultKey: crypto.randomUUID(),
  };
}
