'use server';

import { revalidatePath } from 'next/cache';
import { safeNextPath } from '@/lib/auth/onboarding';
import { requireActiveUser } from '@/lib/participation-gate.server';
import {
  goodQuestionsHref,
  normalizeProductQuestionForm,
  type ProductQuestionFormErrors,
} from '@/lib/product-questions';
import { createClient } from '@/lib/supabase/server';

/* 상품 Q&A 작성(#330).
 *
 * 자격이 "로그인했고 정지되지 않았다" 뿐이라 RPC 가 없다 — RLS insert 정책이
 * 판정을 갖는다(product_questions_insert_own). 그래서 이 액션은 RLS 로 직접 insert
 * 하고, user_id 는 세션에서 온다. 폼이 보낸 값을 믿지 않아도 되는 이유는 정책의
 * `user_id = auth.uid()` with check 가 남의 명의 글을 애초에 거절하기 때문이다.
 *
 * 게이트는 (b)형이다 — 비로그인에게도 입력 폼을 보여 주고, 제출 시점에 로그인으로
 * 보낸다. 폼을 숨기면 "질문할 수 없는 상품"으로 보인다(공개 브라우징 원칙). */

export interface ProductQuestionActionState {
  errors?: ProductQuestionFormErrors;
  message?: string;
  /** 성공한 등록마다 새로 생기는 값. 화면이 입력창을 비우는 신호다. */
  resultKey?: string;
}

const CREATE_FAILED = '질문을 등록하지 못했습니다. 잠시 후 다시 시도해주세요.';
const CREATED = '질문을 등록했어요. 답변이 달리면 알림으로 알려드려요.';

/**
 * 돌아갈 굿즈 상세 경로.
 *
 * 폼이 실어 보낸 `next` 는 그 굿즈의 상세여야 한다. 다른 경로가 오면 조용히
 * 그 굿즈의 Q&A 탭으로 접는다 — 로그인 리다이렉트의 목적지라 임의의 경로를
 * 그대로 태우면 열린 리다이렉트가 된다.
 */
function questionNextPath(rawNext: FormDataEntryValue | null, goodId: string) {
  /* 굿즈를 알 수 없는 제출이면 상세로 돌려보낼 곳이 없다 — 굿즈샵으로 접는다. */
  const fallback = goodId ? goodQuestionsHref(goodId) : '/shop';
  if (!goodId || typeof rawNext !== 'string' || !rawNext.trim()) return fallback;

  const safe = safeNextPath(rawNext);
  const url = new URL(safe, 'https://icons.local');
  return url.pathname === `/shop/${goodId}` ? safe : fallback;
}

/** insert 가 거절된 이유를 사용자 문구로. 모르는 오류는 일반 실패로 접는다. */
function insertErrorMessage(message: string | null | undefined): ProductQuestionFormErrors {
  const value = (message ?? '').toLowerCase();

  /* 정지 계정은 위 게이트가 먼저 걸러내지만, 게이트를 지난 뒤 정지되면 RLS 가 막는다.
     그때 "잠시 후 다시" 라고 하면 사용자는 될 때까지 다시 누른다. */
  if (value.includes('row-level security') || value.includes('account_suspended')) {
    return { form: '지금은 질문을 등록할 수 없습니다. 계정 상태를 확인해주세요.' };
  }
  if (value.includes('product_questions_body_check') || value.includes('violates check constraint')) {
    return { body: '질문 내용을 다시 확인해주세요.' };
  }
  if (value.includes('foreign key')) {
    return { form: '질문을 남길 굿즈를 찾을 수 없습니다.' };
  }
  return { form: CREATE_FAILED };
}

export async function askProductQuestionAction(
  _state: ProductQuestionActionState,
  formData: FormData,
): Promise<ProductQuestionActionState> {
  const normalized = normalizeProductQuestionForm(formData);
  const goodId = normalized.ok ? normalized.value.goodId : '';
  const next = questionNextPath(formData.get('next'), goodId);

  const user = await requireActiveUser(next);
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const { error } = await supabase.from('product_questions').insert({
    body: normalized.value.body,
    good_id: normalized.value.goodId,
    /* insert grant 가 열려 있는 컬럼은 good_id·user_id·body 뿐이다. status·answer_* 를
       여기서 함께 보내면 권한 오류로 통째로 거절된다. */
    user_id: user.id,
  });

  if (error) return { errors: insertErrorMessage(error.message) };

  /* 질문은 두 곳에 동시에 나타난다 — 굿즈 상세의 Q&A 탭과 내 Q&A 목록. */
  revalidatePath(`/shop/${normalized.value.goodId}`);
  revalidatePath('/my/questions');

  return { message: CREATED, resultKey: crypto.randomUUID() };
}
