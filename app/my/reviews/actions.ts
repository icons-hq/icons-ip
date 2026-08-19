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
  buildReviewUploadPath,
  normalizeReviewCreateForm,
  normalizeReviewUpdateForm,
  type ReviewFormErrors,
} from '@/lib/reviews';
import { createClient } from '@/lib/supabase/server';

/* 리뷰 작성·수정·삭제(#254).
 *
 * 자격(배송완료 이상 · 그 주문의 굿즈 · 90일 · 주문×굿즈당 1회)은 전부 RPC 안에서
 * 판정한다. 여기서는 사진 업로드와 오류 문구 변환만 한다 — 자격 검사를 화면 근처로
 * 옮기면 새 진입점을 만드는 사람이 검사 하나를 빠뜨린다.
 *
 * 리뷰 작성에는 보상이 없다(v1 확정). 그래서 이 파일에는 적립 호출이 없다. */

const USER_UPLOADS_BUCKET = 'user-uploads';
const REVIEWS_PATH = '/my/reviews';

export interface ReviewActionState {
  errors?: ReviewFormErrors;
  message?: string;
  /** 성공한 저장마다 새로 생기는 값. 화면이 입력창을 비우는 신호다. */
  resultKey?: string;
}

const CREATE_FAILED = '리뷰를 등록하지 못했습니다. 잠시 후 다시 시도해주세요.';
const UPDATE_FAILED = '리뷰를 수정하지 못했습니다. 잠시 후 다시 시도해주세요.';
const UPLOAD_FAILED = '리뷰 사진을 업로드하지 못했습니다. 다시 시도해주세요.';

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
function rpcErrorMessage(message: string | null | undefined, fallback: string): ReviewFormErrors {
  const value = (message ?? '').toLowerCase();
  if (value.includes('account_suspended')) {
    return { form: '정지된 계정은 리뷰를 남길 수 없습니다.' };
  }
  if (value.includes('review_order_not_delivered')) {
    return { form: '배송이 완료된 주문에만 리뷰를 남길 수 있습니다.' };
  }
  if (value.includes('review_good_not_in_order')) {
    return { form: '이 주문에 포함되지 않은 굿즈입니다.' };
  }
  if (value.includes('review_order_not_found')) {
    return { form: '주문을 찾을 수 없습니다.' };
  }
  if (value.includes('review_window_closed')) {
    return { form: '작성 기한이 지났습니다. 리뷰는 배송완료 후 90일까지 남기거나 고칠 수 있습니다.' };
  }
  if (value.includes('review_already_exists')) {
    return { form: '이미 이 주문의 굿즈에 리뷰를 남겼습니다. 기존 리뷰를 수정해주세요.' };
  }
  if (value.includes('review_hidden')) {
    return { form: '운영 정책에 따라 비공개 처리된 리뷰는 수정할 수 없습니다. 삭제는 언제든 가능합니다.' };
  }
  if (value.includes('review_not_found')) {
    return { form: '리뷰를 찾을 수 없습니다.' };
  }
  if (value.includes('invalid_review_rating')) return { rating: '별점을 다시 선택해주세요.' };
  if (value.includes('invalid_review_body')) return { body: '리뷰 내용을 다시 확인해주세요.' };
  if (value.includes('review_image_limit') || value.includes('invalid_review_image_path')) {
    return { images: UPLOAD_FAILED };
  }
  return { form: fallback };
}

/**
 * 사진 업로드.
 *
 * 한 장이라도 실패하면 전체를 실패로 돌린다. 일부만 올라간 채 본문이 저장되면
 * 사용자는 자기가 올린 사진이 빠진 사실을 알 수 없다.
 */
async function uploadReviewImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  images: File[],
): Promise<{ ok: true; paths: string[] } | { ok: false }> {
  const paths: string[] = [];

  for (const image of images) {
    const path = buildReviewUploadPath({
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

/**
 * 더 이상 리뷰에 붙어 있지 않은 사진 정리.
 *
 * 실패해도 삼킨다 — 본문 저장은 이미 끝났고, 남은 파일 하나 때문에 "리뷰 수정
 * 실패"를 보여 주면 사용자는 저장되지 않았다고 읽는다. 고아 파일은 소유자 폴더
 * 안에 남고 어떤 공개 표면에도 연결되지 않는다.
 */
async function removeReviewImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
) {
  if (!paths.length) return;
  await supabase.storage.from(USER_UPLOADS_BUCKET).remove(paths);
}

export async function createReviewAction(
  _state: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const user = await requireActiveUser(REVIEWS_PATH);

  const normalized = normalizeReviewCreateForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const uploaded = await uploadReviewImages(supabase, user.id, normalized.value.images);
  if (!uploaded.ok) return { errors: { images: UPLOAD_FAILED } };

  const { error } = await supabase.rpc('create_good_review', {
    target_body: normalized.value.body,
    target_good_id: normalized.value.goodId,
    target_image_paths: uploaded.paths,
    target_order_id: normalized.value.orderId,
    target_rating: normalized.value.rating,
  });

  if (error) {
    /* 저장이 실패했으면 방금 올린 사진은 어디에도 붙지 않는다. 남겨 두면
       사용자 폴더에 아무 리뷰와도 연결되지 않은 파일만 쌓인다. */
    await removeReviewImages(supabase, uploaded.paths);
    return { errors: rpcErrorMessage(error.message, CREATE_FAILED) };
  }

  revalidatePath(REVIEWS_PATH);
  revalidatePath(`/shop/${normalized.value.goodId}`);
  redirect(REVIEWS_PATH);
}

export async function updateReviewAction(
  _state: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const normalized = normalizeReviewUpdateForm(formData);
  const next = normalized.ok ? `/my/reviews/${normalized.value.reviewId}` : REVIEWS_PATH;
  const user = await requireActiveUser(next);

  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const uploaded = await uploadReviewImages(supabase, user.id, normalized.value.images);
  if (!uploaded.ok) return { errors: { images: UPLOAD_FAILED } };

  /* 화면이 보낸 "유지할 경로"는 형식만 검증된 값이다. 소유 검증은 DB가 한 번 더
     한다 — 남의 폴더를 가리키는 경로는 invalid_review_image_path로 막힌다. */
  const nextPaths = [...normalized.value.keptImagePaths, ...uploaded.paths];

  const { error } = await supabase.rpc('update_good_review', {
    target_body: normalized.value.body,
    target_image_paths: nextPaths,
    target_rating: normalized.value.rating,
    target_review_id: normalized.value.reviewId,
  });

  if (error) {
    await removeReviewImages(supabase, uploaded.paths);
    return { errors: rpcErrorMessage(error.message, UPDATE_FAILED) };
  }

  const removedPaths = formData
    .getAll('originalImagePaths')
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((entry) => !nextPaths.includes(entry));
  await removeReviewImages(supabase, removedPaths);

  revalidatePath(REVIEWS_PATH);
  revalidatePath(next);
  return {
    message: '리뷰를 수정했습니다.',
    resultKey: crypto.randomUUID(),
  };
}

/**
 * 작성자 삭제 — 기한과 무관하게 상시.
 *
 * 되돌릴 수 없으므로 확인은 화면이 받는다. RPC가 지운 사진 경로를 돌려주면
 * 그 파일까지 함께 지운다 — 리뷰가 사라진 뒤에도 사진이 서명 URL로 남으면
 * "지웠는데 사진은 그대로"가 된다.
 */
export async function deleteReviewAction(formData: FormData) {
  /* 삭제도 보호 액션이다 — 로그인·온보딩·정지 게이트를 먼저 통과시킨다.
     소유 검증은 RPC가 한다(본인 행이 아니면 지워지지 않는다). */
  await requireActiveUser(REVIEWS_PATH);

  const raw = formData.get('reviewId');
  const reviewId = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(reviewId)) {
    redirect(REVIEWS_PATH);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('delete_good_review', {
    target_review_id: reviewId,
  });

  if (!error && Array.isArray(data)) {
    await removeReviewImages(
      supabase,
      data.filter((path): path is string => typeof path === 'string'),
    );
  }

  const goodId = formData.get('goodId');
  if (typeof goodId === 'string' && goodId.trim()) revalidatePath(`/shop/${goodId.trim()}`);
  revalidatePath(REVIEWS_PATH);
  redirect(REVIEWS_PATH);
}
