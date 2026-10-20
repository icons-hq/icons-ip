'use server';

import { revalidatePath } from 'next/cache';
import { requireActiveUser } from '@/lib/participation-gate.server';
import { createClient } from '@/lib/supabase/server';
import { goodReviewsHref } from '@/lib/reviews';
import { parseReviewHelpfulRequest, parseReviewHelpfulState, type ReviewHelpfulState } from '@/lib/review-helpful';

export type ReviewHelpfulActionResult = { ok: true; state: ReviewHelpfulState } | { ok: false; error: string };

export async function setReviewHelpfulAction(input: unknown): Promise<ReviewHelpfulActionResult> {
  const request = parseReviewHelpfulRequest(input);
  if (!request) return { ok: false, error: '리뷰 정보를 다시 확인해주세요.' };
  await requireActiveUser(goodReviewsHref(request.goodId, request.options));
  const supabase = await createClient();
  let result;
  try {
    result = await supabase.rpc('set_review_helpful', {
      p_good_id: request.goodId, p_review_id: request.reviewId, p_marked: request.marked,
    });
  } catch {
    return { ok: false, error: '도움 표시의 저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.' };
  }
  if (result.error) return { ok: false, error: '도움 표시를 변경하지 못했습니다. 리뷰와 계정 상태를 다시 확인해주세요.' };
  const state = parseReviewHelpfulState(result.data);
  if (!state || state.reviewId !== request.reviewId || state.helpfulByMe !== request.marked) {
    return { ok: false, error: '도움 표시의 저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.' };
  }
  // A review may appear on several member goods in the same public group.
  revalidatePath('/shop/[goodId]', 'page');
  revalidatePath('/admin/cs/reviews');
  return { ok: true, state };
}
