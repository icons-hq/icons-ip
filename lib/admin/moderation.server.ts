import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  CommunityPostStatus,
  CommunityReportStatus,
  CommunityReportTarget,
} from '@/lib/community';

const REPORT_LIMIT = 50;

export interface AdminReportRecord {
  id: string;
  targetType: CommunityReportTarget;
  targetId: string;
  targetLabel: string;
  targetPostId: string | null;
  targetCommentId: string | null;
  targetCommentStatus: CommunityPostStatus | null;
  /* 굿즈 리뷰 신고(#254). 숨김 액션은 리뷰 콘솔이 맡으므로 여기서는 대상 식별만
     한다 — 포스트 숨김 폼이 리뷰 신고를 소비하면 DB가 report_target_mismatch로
     막지만, 그 전에 화면이 그 버튼을 그리지 않는 편이 낫다. */
  targetReviewId: string | null;
  targetAuthorId: string | null;
  targetAuthorName: string;
  reporterName: string;
  reason: string | null;
  status: CommunityReportStatus;
  createdAt: string;
}

export interface AdminModerationRecords {
  reports: AdminReportRecord[];
}

interface ReportRow {
  id: string;
  target_type: CommunityReportTarget;
  target_id: string;
  reporter_id: string;
  reason: string | null;
  status: CommunityReportStatus;
  created_at: string;
}

interface PostRow {
  id: string;
  user_id: string;
  text: string;
}

interface CommentRow {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  status: CommunityPostStatus;
}

interface ReviewRow {
  id: string;
  user_id: string;
  body: string;
}

interface PublicProfileRow {
  id: string;
  nickname: string | null;
}

type AdminSupabaseClient = Awaited<ReturnType<typeof createClient>>;

function shortText(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized;
}

function publicName(profile: PublicProfileRow | undefined, userId: string | null) {
  if (!userId) return '알 수 없음';
  return profile?.nickname?.trim() || `fan_${userId.slice(0, 6)}`;
}

async function fetchRowsByIds<T extends { id: string }>(
  supabase: AdminSupabaseClient,
  table: 'posts' | 'comments' | 'public_profiles' | 'reviews',
  select: string,
  ids: string[],
) {
  if (!ids.length) return [] as T[];

  const { data, error } = await supabase
    .from(table)
    .select(select)
    .in('id', ids);

  if (error) {
    throw new Error(`Failed to load admin moderation ${table}: ${error.message}`);
  }

  return (data ?? []) as unknown as T[];
}

export async function getAdminModerationRecords(): Promise<AdminModerationRecords> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select('id,target_type,target_id,reporter_id,reason,status,created_at')
    .order('created_at', { ascending: false })
    .limit(REPORT_LIMIT);

  if (error) throw new Error(`Failed to load admin reports: ${error.message}`);

  const reports = (data ?? []) as ReportRow[];
  const postIds = reports.filter((report) => report.target_type === 'post').map((report) => report.target_id);
  const commentIds = reports.filter((report) => report.target_type === 'comment').map((report) => report.target_id);
  const userTargetIds = reports.filter((report) => report.target_type === 'user').map((report) => report.target_id);
  const reviewIds = reports.filter((report) => report.target_type === 'review').map((report) => report.target_id);

  const [posts, comments, reviews] = await Promise.all([
    fetchRowsByIds<PostRow>(supabase, 'posts', 'id,user_id,text', postIds),
    fetchRowsByIds<CommentRow>(supabase, 'comments', 'id,post_id,user_id,text,status', commentIds),
    fetchRowsByIds<ReviewRow>(supabase, 'reviews', 'id,user_id,body', reviewIds),
  ]);
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const reviewsById = new Map(reviews.map((review) => [review.id, review]));
  const profileIds = Array.from(new Set([
    ...reports.map((report) => report.reporter_id),
    ...posts.map((post) => post.user_id),
    ...comments.map((comment) => comment.user_id),
    ...reviews.map((review) => review.user_id),
    ...userTargetIds,
  ]));
  const profiles = await fetchRowsByIds<PublicProfileRow>(supabase, 'public_profiles', 'id,nickname', profileIds);
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

  return {
    reports: reports.map((report) => {
      const post = report.target_type === 'post' ? postsById.get(report.target_id) : null;
      const comment = report.target_type === 'comment' ? commentsById.get(report.target_id) : null;
      const review = report.target_type === 'review' ? reviewsById.get(report.target_id) : null;
      const targetAuthorId = post?.user_id
        ?? comment?.user_id
        ?? review?.user_id
        ?? (report.target_type === 'user' ? report.target_id : null);
      const targetPostId = post?.id ?? comment?.post_id ?? null;

      /* 블라인드된 리뷰는 staff RLS로 여전히 읽히지만, 이미 지워진 리뷰는 행이
         없다. 그때 라벨을 비우면 신고 카드가 무엇에 대한 것인지 알 수 없어지므로
         "삭제된 리뷰"라고 분명히 말한다. */
      const targetLabel = post
        ? shortText(post.text)
        : comment
          ? shortText(comment.text)
          : report.target_type === 'review'
            ? review ? shortText(review.body) : '삭제된 리뷰'
            : `@${publicName(profilesById.get(report.target_id), report.target_id)}`;

      return {
        id: report.id,
        targetType: report.target_type,
        targetId: report.target_id,
        targetLabel,
        targetPostId,
        targetCommentId: comment?.id ?? null,
        targetCommentStatus: comment?.status ?? null,
        targetReviewId: report.target_type === 'review' ? report.target_id : null,
        targetAuthorId,
        targetAuthorName: publicName(profilesById.get(targetAuthorId ?? ''), targetAuthorId),
        reporterName: publicName(profilesById.get(report.reporter_id), report.reporter_id),
        reason: report.reason,
        status: report.status,
        createdAt: report.created_at,
      };
    }),
  };
}
