import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { isReviewStatus, type ReviewStatus } from '@/lib/reviews';
import {
  ADMIN_REVIEW_PAGE_SIZE,
  adminReviewAuthorLabel,
  EMPTY_ADMIN_REVIEW_COUNTS,
  ternaryFilterToBoolean,
  type AdminReviewConsoleData,
  type AdminReviewCounts,
  type AdminReviewFilters,
  type AdminReviewRow,
} from './reviews';

/* 어드민 리뷰 콘솔 로더(#254).
 *
 * 목록과 집계는 staff 게이트가 붙은 RPC로만 읽는다. 사진은 서명 URL로 바꿔
 * 넘긴다 — 블라인드 판단의 근거가 사진일 때 그 사진을 못 보면 해제 여부를
 * 정할 수 없다(storage 정책이 staff 읽기를 따로 연 이유). */

const USER_UPLOADS_BUCKET = 'user-uploads';
const SIGNED_IMAGE_EXPIRES_IN_SECONDS = 60 * 60;

interface ConsoleRow {
  id: string;
  good_id: string;
  good_name: string;
  order_id: string;
  user_id: string;
  author_name: string | null;
  author_email: string | null;
  rating: number;
  body: string;
  image_paths: string[] | null;
  status: string;
  hidden_reason: string | null;
  hidden_at: string | null;
  admin_reply: string | null;
  admin_reply_at: string | null;
  reply_author_name: string | null;
  report_count: number | string;
  open_report_count: number | string;
  created_at: string;
  edited_at: string | null;
  total_count: number | string;
}

interface CountsRow {
  total_reviews: number | string;
  low_rating_reviews: number | string;
  awaiting_reply_reviews: number | string;
  hidden_reviews: number | string;
  reported_reviews: number | string;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

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

export async function getAdminReviewConsoleData(
  filters: AdminReviewFilters,
): Promise<AdminReviewConsoleData> {
  const supabase = await createClient();

  const [listResult, countResult] = await Promise.all([
    supabase.rpc('admin_search_reviews', {
      p_field: filters.field,
      p_from: filters.from,
      p_has_photo: ternaryFilterToBoolean(filters.photo),
      p_has_reply: ternaryFilterToBoolean(filters.reply),
      p_limit: ADMIN_REVIEW_PAGE_SIZE,
      p_low_rating: filters.lowRating,
      p_offset: (filters.page - 1) * ADMIN_REVIEW_PAGE_SIZE,
      p_query: filters.query || null,
      p_rating: filters.rating === 'all' ? null : Number(filters.rating),
      p_review_id: filters.reviewId,
      p_sort: filters.sort,
      p_status: filters.status === 'all' ? null : filters.status,
      p_to: filters.to,
    }),
    supabase.rpc('admin_review_console_counts'),
  ]);

  if (listResult.error) {
    throw new Error(`Failed to load reviews: ${listResult.error.message}`);
  }
  if (countResult.error) {
    throw new Error(`Failed to count reviews: ${countResult.error.message}`);
  }

  /* admin_review_console_counts는 한 행짜리 집계다. Supabase RPC는 returns table을
     배열로 돌려주므로 첫 행을 쓰되, 비면 0으로 접는다. */
  const countsRow = ((countResult.data ?? []) as CountsRow[])[0];
  const counts: AdminReviewCounts = countsRow
    ? {
      total: toNumber(countsRow.total_reviews),
      lowRating: toNumber(countsRow.low_rating_reviews),
      awaitingReply: toNumber(countsRow.awaiting_reply_reviews),
      hidden: toNumber(countsRow.hidden_reviews),
      reported: toNumber(countsRow.reported_reviews),
    }
    : EMPTY_ADMIN_REVIEW_COUNTS;

  const rows = (listResult.data ?? []) as ConsoleRow[];
  const urls = await signedImageUrls(
    supabase,
    [...new Set(rows.flatMap((row) => row.image_paths ?? []))],
  );

  return {
    counts,
    filters,
    pageSize: ADMIN_REVIEW_PAGE_SIZE,
    total: rows.length ? toNumber(rows[0].total_count) : 0,
    rows: rows.map((row): AdminReviewRow => {
      const paths = row.image_paths ?? [];

      return {
        id: row.id,
        goodId: row.good_id,
        goodName: row.good_name,
        orderId: row.order_id,
        userId: row.user_id,
        authorName: adminReviewAuthorLabel(row.author_name, row.user_id),
        authorEmail: row.author_email,
        rating: row.rating,
        body: row.body,
        imageCount: paths.length,
        imageUrls: paths
          .map((path) => urls.get(path))
          .filter((url): url is string => typeof url === 'string'),
        status: (isReviewStatus(row.status) ? row.status : 'visible') as ReviewStatus,
        hiddenReason: row.hidden_reason,
        hiddenAt: row.hidden_at,
        adminReply: row.admin_reply,
        adminReplyAt: row.admin_reply_at,
        replyAuthorName: row.reply_author_name?.trim() || null,
        reportCount: toNumber(row.report_count),
        openReportCount: toNumber(row.open_report_count),
        createdAt: row.created_at,
        editedAt: row.edited_at,
      };
    }),
  };
}
