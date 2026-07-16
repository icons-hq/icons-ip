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
  table: 'posts' | 'comments' | 'public_profiles',
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

  const [posts, comments] = await Promise.all([
    fetchRowsByIds<PostRow>(supabase, 'posts', 'id,user_id,text', postIds),
    fetchRowsByIds<CommentRow>(supabase, 'comments', 'id,post_id,user_id,text,status', commentIds),
  ]);
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const profileIds = Array.from(new Set([
    ...reports.map((report) => report.reporter_id),
    ...posts.map((post) => post.user_id),
    ...comments.map((comment) => comment.user_id),
    ...userTargetIds,
  ]));
  const profiles = await fetchRowsByIds<PublicProfileRow>(supabase, 'public_profiles', 'id,nickname', profileIds);
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

  return {
    reports: reports.map((report) => {
      const post = report.target_type === 'post' ? postsById.get(report.target_id) : null;
      const comment = report.target_type === 'comment' ? commentsById.get(report.target_id) : null;
      const targetAuthorId = post?.user_id ?? comment?.user_id ?? (report.target_type === 'user' ? report.target_id : null);
      const targetPostId = post?.id ?? comment?.post_id ?? null;

      return {
        id: report.id,
        targetType: report.target_type,
        targetId: report.target_id,
        targetLabel: post ? shortText(post.text) : comment ? shortText(comment.text) : `@${publicName(profilesById.get(report.target_id), report.target_id)}`,
        targetPostId,
        targetCommentId: comment?.id ?? null,
        targetCommentStatus: comment?.status ?? null,
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
