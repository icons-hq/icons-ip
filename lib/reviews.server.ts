import 'server-only';

import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { loadReviewEventDisclosures } from '@/lib/review-events.server';
import type { ReviewEventDisclosure } from '@/lib/review-events';
import type { ReviewHelpfulMetrics } from './review-helpful';
import { parseTypedReviewPage, isReviewKind, type ReviewKind } from './review-types';
import {
  EMPTY_REVIEW_SUMMARY,
  GOOD_REVIEW_PAGE_SIZE,
  isReviewStatus,
  type GoodReviewListOptions,
  type ReviewRatingSummary,
  type ReviewStatus,
} from '@/lib/reviews';

/* 리뷰 읽기 로더(#254).
 *
 * 공개 표면은 비로그인도 읽는다. 그래서 Supabase가 설정되지 않은 mock 모드에서도
 * 던지지 않고 "리뷰 0건"으로 접는다 — 굿즈 상세 전체가 500이 되는 것보다,
 * 아직 리뷰가 없다고 말하는 편이 사실에 가깝고 안전하다.
 *
 * 평점 요약과 목록은 같은 그룹 범위를 한 RPC에서 읽는다. 앱에서 페이지
 * 평균을 전체 평점으로 바꾸거나 원래 리뷰·구매 상품을 다시 기록하지 않는다. */

const USER_UPLOADS_BUCKET = 'user-uploads';
const SIGNED_IMAGE_EXPIRES_IN_SECONDS = 60 * 60;

export interface GoodReviewItem extends ReviewHelpfulMetrics {
  kind?: ReviewKind;
  repeatPurchase?: boolean | null;
  id: string;
  rating: number;
  body: string;
  authorName: string;
  isMine: boolean;
  createdAt: string;
  editedAt: string | null;
  adminReply: string | null;
  adminReplyAt: string | null;
  imageUrls: string[];
  eventDisclosure?: ReviewEventDisclosure;
  purchasedGood?: { id: string; name: string; variantNames: string[] };
}

export interface GoodReviewSection {
  viewerAuthenticated: boolean;
  summary: ReviewRatingSummary;
  reviews: GoodReviewItem[];
  total: number;
  pageSize: number;
  options: GoodReviewListOptions;
  grouped?: boolean;
  unavailable?: boolean;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 사진 서명 URL.
 *
 * 실패한 경로는 조용히 빠진다. 한 장을 못 읽었다고 리뷰 본문까지 감추면,
 * 스토리지 일시 오류가 상품 평판을 지우는 사고가 된다.
 */
async function signedImageUrls(supabase: SupabaseServerClient, paths: string[]) {
  if (!paths.length) return new Map<string, string>();

  const entries = await Promise.all(paths.map(async (path) => {
    const { data, error } = await supabase.storage
      .from(USER_UPLOADS_BUCKET)
      .createSignedUrl(path, SIGNED_IMAGE_EXPIRES_IN_SECONDS);
    return error || !data?.signedUrl ? null : ([path, data.signedUrl] as const);
  }));

  return new Map(entries.filter((entry): entry is [string, string] => entry !== null));
}

function emptySection(options: GoodReviewListOptions): GoodReviewSection {
  return {
    viewerAuthenticated: false,
    summary: EMPTY_REVIEW_SUMMARY,
    reviews: [],
    total: 0,
    pageSize: GOOD_REVIEW_PAGE_SIZE,
    options,
  };
}

export async function loadGoodReviewSection(
  goodId: string,
  options: GoodReviewListOptions,
): Promise<GoodReviewSection> {
  if (!getSupabaseConfig().isConfigured) return emptySection(options);

  const supabase = await createClient();

  const { data, error } = await supabase.rpc('get_good_group_reviews_v3', {
    p_good_id: goodId,
    p_kind: options.kind ?? 'all',
    p_repeat: options.repeat ?? 'all',
    p_limit: GOOD_REVIEW_PAGE_SIZE,
    p_offset: (options.page - 1) * GOOD_REVIEW_PAGE_SIZE,
    p_photo_only: options.photoOnly,
    p_sort: options.sort,
  });
  const page = error ? null : parseTypedReviewPage(data);
  if (!page) return { ...emptySection(options), unavailable: true };

  const [disclosures, urls] = await Promise.all([
    loadReviewEventDisclosures(page.reviews.map(row => row.id)),
    signedImageUrls(supabase, [...new Set(page.reviews.flatMap(row => row.imagePaths))]),
  ]);
  return {
    viewerAuthenticated: page.viewerAuthenticated,
    summary: page.summary,
    grouped: page.grouped,
    pageSize: GOOD_REVIEW_PAGE_SIZE,
    options,
    total: page.total,
    reviews: page.reviews.map(row => ({
      id: row.id,
      kind: row.kind,
      repeatPurchase: row.repeatPurchase,
      helpfulCount: row.helpfulCount,
      helpfulByMe: row.helpfulByMe,
      canMarkHelpful: row.canMarkHelpful,
      eventDisclosure: disclosures.get(row.id),
      purchasedGood: { id: row.goodId, name: row.goodName, variantNames: row.variantNames },
      rating: row.rating,
      body: row.body,
      authorName: row.authorName.trim() || '구매자',
      isMine: row.isMine,
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      adminReply: row.adminReply,
      adminReplyAt: row.adminReplyAt,
      imageUrls: row.imagePaths.map(path => urls.get(path)).filter((url): url is string => typeof url === 'string'),
    })),
  };
}

/* ---------------------------------------------------------------------------
 * 내 리뷰 표면
 * ------------------------------------------------------------------------- */

export interface MyReviewTarget {
  kind?: ReviewKind;
  opensAt?: string | null;
  editable?: boolean;
  monthRewardEligible?: boolean;
  repeatPurchase?: boolean | null;
  orderId: string;
  goodId: string;
  goodName: string;
  goodBg: string | null;
  orderedAt: string;
  deliveredAt: string | null;
  deadlineAt: string | null;
  writable: boolean;
  review: {
    id: string;
    rating: number;
    body: string;
    imagePaths: string[];
    imageUrls: string[];
    status: ReviewStatus;
    createdAt: string;
    editedAt: string | null;
    adminReply: string | null;
    adminReplyAt: string | null;
  } | null;
}

interface MyReviewTargetRow {
  review_kind: ReviewKind;
  opens_at: string | null;
  editable: boolean;
  month_reward_eligible: boolean;
  repeat_purchase: boolean | null;
  order_id: string;
  good_id: string;
  good_name: string;
  good_bg: string | null;
  good_image_path: string | null;
  ordered_at: string;
  delivered_at: string | null;
  deadline_at: string | null;
  writable: boolean | null;
  review_id: string | null;
  review_rating: number | null;
  review_body: string | null;
  review_image_paths: string[] | null;
  review_status: string | null;
  review_created_at: string | null;
  review_edited_at: string | null;
  admin_reply: string | null;
  admin_reply_at: string | null;
}

/**
 * 배송완료 이상 주문의 굿즈별 리뷰 상태.
 *
 * "작성 가능"과 "작성 완료"를 한 RPC로 받는다. 두 목록을 따로 부르면 같은 굿즈가
 * 두 칸에 동시에 뜨는 창이 생긴다.
 */
export async function loadMyReviewTargets(options: {
  orderId?: string | null;
  goodId?: string | null;
} = {}): Promise<MyReviewTarget[]> {
  if (!getSupabaseConfig().isConfigured) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_review_targets_v2', {
    target_good_id: options.goodId ?? null,
    target_order_id: options.orderId ?? null,
  });

  if (error) return [];

  const rows = (data ?? []) as MyReviewTargetRow[];
  if (!Array.isArray(rows) || rows.some(row => !isReviewKind(row.review_kind) || typeof row.editable !== 'boolean' || typeof row.month_reward_eligible !== 'boolean' || (row.repeat_purchase !== null && typeof row.repeat_purchase !== 'boolean'))) return [];
  const urls = await signedImageUrls(
    supabase,
    [...new Set(rows.flatMap((row) => row.review_image_paths ?? []))],
  );

  return rows.map((row) => ({
    orderId: row.order_id,
    kind: row.review_kind, opensAt: row.opens_at, editable: row.editable, monthRewardEligible: row.month_reward_eligible, repeatPurchase: row.repeat_purchase,
    goodId: row.good_id,
    goodName: row.good_name,
    goodBg: row.good_bg,
    orderedAt: row.ordered_at,
    deliveredAt: row.delivered_at,
    deadlineAt: row.deadline_at,
    writable: row.writable === true,
    review: row.review_id
      ? {
        id: row.review_id,
        rating: row.review_rating ?? 0,
        body: row.review_body ?? '',
        imagePaths: row.review_image_paths ?? [],
        imageUrls: (row.review_image_paths ?? [])
          .map((path) => urls.get(path))
          .filter((url): url is string => typeof url === 'string'),
        status: isReviewStatus(row.review_status) ? row.review_status : 'visible',
        createdAt: row.review_created_at ?? row.ordered_at,
        editedAt: row.review_edited_at,
        adminReply: row.admin_reply,
        adminReplyAt: row.admin_reply_at,
      }
      : null,
  }));
}

/** 주문 상세의 리뷰 진입 블록. 배송완료 이전 주문은 빈 배열이 된다. */
export async function loadOrderReviewTargets(orderId: string): Promise<MyReviewTarget[]> {
  return loadMyReviewTargets({ orderId });
}
