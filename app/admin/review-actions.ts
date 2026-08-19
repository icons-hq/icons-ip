'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/* 어드민 리뷰 답글·블라인드(#254).
 *
 * 두 액션 모두 DB RPC 한 번으로 끝난다. 답글 알림도, 블라인드 감사 로그도, 연결
 * 신고 종결도 같은 트랜잭션 안에 있다 — 여기서 나눠 부르면 답글은 달렸는데 알림은
 * 안 갔거나, 리뷰는 내려갔는데 신고는 열려 있는 상태가 만들어진다.
 *
 * 이 파일이 하는 일은 폼 값 정규화와 오류 문구 변환뿐이다. 권한 판정은 RPC 안에
 * 한 번 더 있다 — 여기서만 막으면 액션 하나를 새로 만드는 사람이 게이트를 빠뜨린다. */

const REVIEWS_PATH = '/admin/cs/reviews';

export interface AdminReviewActionState {
  errors?: { reply?: string; reason?: string; form?: string };
  message?: string;
  /**
   * 성공한 처리마다 새로 생기는 값. 화면이 입력창을 비우는 신호다.
   * 문구만 보고 판단하면 두 번째 저장의 문구가 첫 번째와 같아 창이 비지 않는다.
   */
  resultKey?: string;
}

const REPLY_FAILED = '답글을 저장하지 못했습니다. 최신 상태를 확인해주세요.';
const STATUS_FAILED = '리뷰 상태를 변경하지 못했습니다. 최신 상태를 확인해주세요.';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readUuid(formData: FormData, name: string) {
  const value = readString(formData, name).toLowerCase();
  return UUID_PATTERN.test(value) ? value : null;
}

async function requireStaffAction(): Promise<AdminReviewActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent(REVIEWS_PATH)}`);
  }
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };
  return null;
}

/** RPC가 던진 도메인 오류를 운영자 문구로. 모르는 오류는 일반 실패로 접는다. */
function rpcErrorMessage(message: string | null | undefined, fallback: string) {
  const value = (message ?? '').toLowerCase();
  if (value.includes('review_not_found')) return '리뷰를 찾을 수 없습니다. 작성자가 삭제했을 수 있습니다.';
  if (value.includes('report_not_found')) return '연결된 신고를 찾을 수 없습니다.';
  if (value.includes('report_target_mismatch')) {
    return '이 신고는 이 리뷰를 가리키지 않습니다. 모더레이션 큐에서 대상을 다시 확인해주세요.';
  }
  if (value.includes('review_hide_reason_required')) return '블라인드 사유를 입력해주세요.';
  if (value.includes('invalid_review_reply')) return '답글은 2자 이상 1000자 이내로 입력해주세요.';
  if (value.includes('staff_required')) return '관리자 권한이 필요합니다.';
  return fallback;
}

export async function replyToReviewAction(
  _state: AdminReviewActionState,
  formData: FormData,
): Promise<AdminReviewActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const reviewId = readUuid(formData, 'reviewId');
  const reply = readString(formData, 'reply');

  if (!reviewId) return { errors: { form: '리뷰를 찾을 수 없습니다.' } };
  if (reply.length < 2) return { errors: { reply: '답글을 2자 이상 입력해주세요.' } };
  if (reply.length > 1000) return { errors: { reply: '답글은 1000자 이내로 입력해주세요.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_reply_to_review', {
    target_reply: reply,
    target_review_id: reviewId,
  });

  if (error) return { errors: { form: rpcErrorMessage(error.message, REPLY_FAILED) } };

  revalidatePath(REVIEWS_PATH);
  return {
    message: '답글을 저장했습니다. 굿즈 상세에 함께 표시됩니다.',
    resultKey: crypto.randomUUID(),
  };
}

/**
 * 블라인드·해제.
 *
 * 블라인드는 사유가 필수다(DB도 같은 규칙을 강제한다). 사유 없는 비공개는 나중에
 * 아무도 해제하지 못한다 — 왜 내렸는지 모르는 리뷰는 되돌릴 근거도 없다.
 *
 * 연결 신고 id는 선택이다. 넘기면 RPC가 "그 신고가 정말 이 리뷰를 가리키는지"를
 * 확인한 뒤에만 종결한다.
 */
export async function setReviewStatusAction(
  _state: AdminReviewActionState,
  formData: FormData,
): Promise<AdminReviewActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const reviewId = readUuid(formData, 'reviewId');
  const status = readString(formData, 'status');
  const reason = readString(formData, 'reason');
  const reportId = readUuid(formData, 'reportId');

  if (!reviewId) return { errors: { form: '리뷰를 찾을 수 없습니다.' } };
  if (status !== 'visible' && status !== 'hidden') {
    return { errors: { form: '변경할 상태를 찾을 수 없습니다.' } };
  }
  if (status === 'hidden' && reason.length < 2) {
    return { errors: { reason: '블라인드 사유를 2자 이상 입력해주세요.' } };
  }
  if (reason.length > 500) {
    return { errors: { reason: '블라인드 사유는 500자 이내로 입력해주세요.' } };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_review_status', {
    target_reason: status === 'hidden' ? reason : null,
    target_report_id: reportId,
    target_review_id: reviewId,
    target_status: status,
  });

  if (error) return { errors: { form: rpcErrorMessage(error.message, STATUS_FAILED) } };

  revalidatePath(REVIEWS_PATH);
  revalidatePath('/admin/community/moderation');
  return {
    message: status === 'hidden'
      ? '리뷰를 블라인드했습니다. 평점 평균에서도 즉시 빠집니다.'
      : '리뷰를 다시 공개했습니다.',
    resultKey: crypto.randomUUID(),
  };
}
