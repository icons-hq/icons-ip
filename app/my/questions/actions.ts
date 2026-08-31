'use server';

import { revalidatePath } from 'next/cache';
import { requireActiveUser } from '@/lib/participation-gate.server';
import { createClient } from '@/lib/supabase/server';

/* 내 상품 Q&A 삭제(#330).
 *
 * 작성자 회수권이다 — 운영자 블라인드(원문을 남기고 상태만 바꾼다)와 목적이 다르다.
 * 운영 답변이 이미 달린 질문도 지울 수 있다. 답변은 같은 행의 컬럼이라 함께 사라진다.
 *
 * 소유권 판정은 여기가 아니라 RLS delete 정책(product_questions_delete_own)이 갖는다.
 * 액션이 `user_id`로 한 번 더 좁히면 정책과 액션 두 곳이 같은 규칙을 들게 되고,
 * 나중에 한쪽만 고쳐지는 날이 온다. 여기서는 id 만 보내고 0행 응답을 실패로 읽는다.
 *
 * 어휘 규율: 공개 Q&A를 비공개 1:1 '문의'라고 부르지 않는다(CONTEXT.md). */

const QUESTIONS_PATH = '/my/questions';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DELETE_FAILED = '질문을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.';
const DELETED = '질문을 삭제했어요.';

export interface MyQuestionActionState {
  status?: 'success' | 'error';
  message?: string;
}

/** RLS 거절·전송 실패를 작성자 언어로. 모르는 오류는 일반 실패로 접는다. */
function deleteErrorMessage(message: string | null | undefined): string {
  const value = (message ?? '').toLowerCase();

  /* 정책이 남의 행을 거른 결과는 0행이지 오류가 아니다. 여기 오는 것은 grant·정책이
     통째로 막힌 경우라, 계정 상태를 확인하라고 말하는 편이 정확하다. */
  if (value.includes('row-level security') || value.includes('permission denied')) {
    return '지금은 질문을 삭제할 수 없어요. 계정 상태를 확인해 주세요.';
  }
  return DELETE_FAILED;
}

export async function deleteMyProductQuestionAction(
  _state: MyQuestionActionState,
  formData: FormData,
): Promise<MyQuestionActionState> {
  await requireActiveUser(QUESTIONS_PATH);

  const raw = formData.get('questionId');
  const questionId = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!UUID_PATTERN.test(questionId)) {
    return { status: 'error', message: DELETE_FAILED };
  }

  const supabase = await createClient();

  /* 굿즈를 먼저 읽는다 — 행이 사라진 뒤에는 어느 굿즈 상세를 되살릴지 알 수 없다.
     select 는 공개 정책이라 남의 행도 읽히지만, 그래서 이 값은 revalidate 대상을
     고르는 데만 쓴다(삭제 자체는 delete 정책이 판정한다). */
  const { data: target } = await supabase
    .from('product_questions')
    .select('good_id')
    .eq('id', questionId)
    .maybeSingle<{ good_id: string }>();

  const { data, error } = await supabase
    .from('product_questions')
    .delete()
    .eq('id', questionId)
    .select('id');

  if (error) return { status: 'error', message: deleteErrorMessage(error.message) };

  /* 0행은 남의 글이거나 이미 지워진 글이다. 성공으로 그리면 사용자는 사라지지 않은
     줄을 보며 "삭제했어요"를 읽는다. */
  if (!Array.isArray(data) || data.length === 0) {
    return { status: 'error', message: DELETE_FAILED };
  }

  /* 질문은 두 곳에 동시에 걸려 있다 — 굿즈 상세의 Q&A 탭과 내 Q&A 목록. */
  revalidatePath(QUESTIONS_PATH);
  if (target?.good_id) revalidatePath(`/shop/${target.good_id}`);

  return { status: 'success', message: DELETED };
}
