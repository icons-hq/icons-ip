import 'server-only';

import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
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
 * 평점 요약은 집계 뷰(good_review_stats)를 그대로 읽는다. 앱에서 합을 다시
 * 계산하지 않는다 — 목록은 페이지 단위라 그 합은 언제나 "이 페이지의 평균"이 된다. */

const USER_UPLOADS_BUCKET = 'user-uploads';
const SIGNED_IMAGE_EXPIRES_IN_SECONDS = 60 * 60;

export interface GoodReviewItem {
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
}

export interface GoodReviewSection {
  summary: ReviewRatingSummary;
  reviews: GoodReviewItem[];
  total: number;
  pageSize: number;
  options: GoodReviewListOptions;
}

interface StatsRow {
  review_count: number | string;
  rating_average: number | string | null;
  rating_1_count: number | string;
  rating_2_count: number | string;
  rating_3_count: number | string;
  rating_4_count: number | string;
  rating_5_count: number | string;
  photo_count: number | string;
}

interface ReviewRow {
  id: string;
  rating: number;
  body: string;
  image_paths: string[] | null;
  author_name: string | null;
  is_mine: boolean | null;
  created_at: string;
  edited_at: string | null;
  admin_reply: string | null;
  admin_reply_at: string | null;
  total_count: number | string;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

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

  const [statsResult, listResult] = await Promise.all([
    supabase
      .from('good_review_stats')
      .select(
        'review_count,rating_average,rating_1_count,rating_2_count,'
        + 'rating_3_count,rating_4_count,rating_5_count,photo_count',
      )
      .eq('good_id', goodId)
      .maybeSingle<StatsRow>(),
    supabase.rpc('good_reviews', {
      target_good_id: goodId,
      target_limit: GOOD_REVIEW_PAGE_SIZE,
      target_offset: (options.page - 1) * GOOD_REVIEW_PAGE_SIZE,
      target_photo_only: options.photoOnly,
      target_sort: options.sort,
    }),
  ]);

  /* 리뷰 도메인이 아직 배포되지 않은 환경(프리뷰 DB 지연 등)에서도 굿즈 상세는
     열려야 한다. 로더가 던지면 상품 페이지 전체가 사라진다. */
  if (statsResult.error && listResult.error) return emptySection(options);

  const stats = statsResult.data;
  const summary: ReviewRatingSummary = stats
    ? {
      count: toNumber(stats.review_count),
      average: toNumber(stats.rating_average),
      distribution: [
        toNumber(stats.rating_1_count),
        toNumber(stats.rating_2_count),
        toNumber(stats.rating_3_count),
        toNumber(stats.rating_4_count),
        toNumber(stats.rating_5_count),
      ],
      photoCount: toNumber(stats.photo_count),
    }
    : EMPTY_REVIEW_SUMMARY;

  const rows = (listResult.data ?? []) as ReviewRow[];
  const urls = await signedImageUrls(
    supabase,
    [...new Set(rows.flatMap((row) => row.image_paths ?? []))],
  );

  return {
    summary,
    pageSize: GOOD_REVIEW_PAGE_SIZE,
    options,
    total: rows.length ? toNumber(rows[0].total_count) : 0,
    reviews: rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      body: row.body,
      authorName: row.author_name?.trim() || '구매자',
      isMine: row.is_mine === true,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      adminReply: row.admin_reply,
      adminReplyAt: row.admin_reply_at,
      imageUrls: (row.image_paths ?? [])
        .map((path) => urls.get(path))
        .filter((url): url is string => typeof url === 'string'),
    })),
  };
}

/* ---------------------------------------------------------------------------
 * 내 리뷰 표면
 * ------------------------------------------------------------------------- */

export interface MyReviewTarget {
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
  const { data, error } = await supabase.rpc('my_review_targets', {
    target_good_id: options.goodId ?? null,
    target_order_id: options.orderId ?? null,
  });

  if (error) return [];

  const rows = (data ?? []) as MyReviewTargetRow[];
  const urls = await signedImageUrls(
    supabase,
    [...new Set(rows.flatMap((row) => row.review_image_paths ?? []))],
  );

  return rows.map((row) => ({
    orderId: row.order_id,
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
