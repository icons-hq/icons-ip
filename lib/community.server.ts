import 'server-only';

import { DATA, type Ip } from '@/lib/data';
import { getCatalogSnapshot } from '@/lib/catalog';
import { createClient } from '@/lib/supabase/server';
import {
  canViewCommunityPost,
  type CommunityChannel,
  type CommunityFeedComment,
  type CommunityFeedPost,
  type CommunityPostStatus,
  type CommunitySnapshot,
} from '@/lib/community';

const USER_UPLOADS_BUCKET = 'user-uploads';
const COMMUNITY_FEED_LIMIT = 30;
const COMMUNITY_COMMENT_PREVIEW_LIMIT = 3;
const COMMUNITY_TRENDING_WINDOW_DAYS = 7;
const COMMUNITY_TRENDING_LIMIT = 10;
const SIGNED_IMAGE_EXPIRES_IN_SECONDS = 60 * 60;

interface CommunityPostRow {
  id: string;
  user_id: string;
  ip_id: string | null;
  text: string;
  tag: string | null;
  created_at: string;
  image_path: string | null;
  status: CommunityPostStatus;
}

interface PublicProfileRow {
  id: string;
  nickname: string | null;
}

interface CommunityReactionCountRow {
  post_id: string;
  likes_count: number | string | null;
  comments_count: number | string | null;
}

interface CommunityCommentRow {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  created_at: string;
}

interface CommunityLikeRow {
  post_id: string;
}

interface CommunityBlockRow {
  blocked_user_id: string;
}

interface CommunityTrendingTagRow {
  tag: string;
}

interface CommunitySnapshotOptions {
  viewerId?: string | null;
  isStaff?: boolean;
}

type CommunitySupabaseClient = Awaited<ReturnType<typeof createClient>>;

function channelFromIp(ip: Ip): CommunityChannel {
  return {
    id: ip.id,
    title: ip.title,
    sub: ip.sub,
    color: ip.v.color,
  };
}

function formatPostTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return '방금 전';
  if (diffMinutes < 60) return `${diffMinutes}분 전`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}일 전`;

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

function blockedUserIdList(blockedIds: ReadonlySet<string>) {
  return Array.from(blockedIds);
}

function postgrestInList(values: readonly string[]) {
  return `(${values.join(',')})`;
}

async function reactionCountsByPostId(
  supabase: CommunitySupabaseClient,
  postIds: string[],
  blockedIds: ReadonlySet<string>,
) {
  const { data, error } = await supabase.rpc('community_post_reaction_counts', {
    target_post_ids: postIds,
    blocked_user_ids: blockedUserIdList(blockedIds),
  });

  if (error) {
    throw new Error(`Failed to load post reactions: ${error.message}`);
  }

  const likesByPostId = new Map<string, number>();
  const commentsByPostId = new Map<string, number>();

  for (const row of (data ?? []) as CommunityReactionCountRow[]) {
    likesByPostId.set(row.post_id, Number(row.likes_count ?? 0));
    commentsByPostId.set(row.post_id, Number(row.comments_count ?? 0));
  }

  return { likesByPostId, commentsByPostId };
}

async function commentsForPosts(
  supabase: CommunitySupabaseClient,
  postIds: string[],
  blockedIds: ReadonlySet<string>,
) {
  const blockedAuthorIds = blockedUserIdList(blockedIds);
  const results = await Promise.all(
    postIds.map(async (postId) => {
      let commentsQuery = supabase
        .from('comments')
        .select('id,post_id,user_id,text,created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })
        .limit(COMMUNITY_COMMENT_PREVIEW_LIMIT);

      if (blockedAuthorIds.length) {
        commentsQuery = commentsQuery.not('user_id', 'in', postgrestInList(blockedAuthorIds));
      }

      const { data, error } = await commentsQuery;

      if (error) {
        throw new Error(`Failed to load community comments: ${error.message}`);
      }

      return (data ?? []) as CommunityCommentRow[];
    }),
  );

  return results.flat();
}

async function viewerLikePostIds(
  supabase: CommunitySupabaseClient,
  postIds: string[],
  viewerId: string | null,
) {
  if (!viewerId) return new Set<string>();

  const { data, error } = await supabase
    .from('likes')
    .select('post_id')
    .eq('user_id', viewerId)
    .in('post_id', postIds);

  if (error) {
    throw new Error(`Failed to load viewer likes: ${error.message}`);
  }

  return new Set(((data ?? []) as CommunityLikeRow[]).map((row) => row.post_id));
}

async function blockedUserIds(supabase: CommunitySupabaseClient, viewerId: string | null) {
  if (!viewerId) return new Set<string>();

  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_user_id')
    .eq('user_id', viewerId);

  if (error) {
    throw new Error(`Failed to load blocked users: ${error.message}`);
  }

  return new Set(((data ?? []) as CommunityBlockRow[]).map((row) => row.blocked_user_id));
}

async function signedImageUrlByPath(supabase: CommunitySupabaseClient, paths: string[]) {
  const entries = await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await supabase.storage
        .from(USER_UPLOADS_BUCKET)
        .createSignedUrl(path, SIGNED_IMAGE_EXPIRES_IN_SECONDS);

      if (error || !data?.signedUrl) {
        return null;
      }

      return [path, data.signedUrl] as const;
    }),
  );

  return new Map(entries.filter((entry): entry is [string, string] => entry !== null));
}

function publicAuthorName(profile: PublicProfileRow | undefined, userId: string) {
  return profile?.nickname?.trim() || `fan_${userId.slice(0, 6)}`;
}

function postFallbackIp(ips: Ip[]) {
  return ips[0] ?? null;
}

function commentItemsByPostId(
  rows: CommunityCommentRow[],
  profilesById: Map<string, PublicProfileRow>,
  viewerId: string | null,
) {
  const grouped = new Map<string, CommunityFeedComment[]>();

  for (const row of rows) {
    const comments = grouped.get(row.post_id) ?? [];
    comments.push({
      id: row.id,
      authorId: row.user_id,
      user: publicAuthorName(profilesById.get(row.user_id), row.user_id),
      text: row.text,
      time: formatPostTime(row.created_at),
      canDelete: viewerId === row.user_id,
    });
    grouped.set(row.post_id, comments);
  }

  return grouped;
}

function toCommunityPost(
  row: CommunityPostRow,
  ipsById: Map<string, Ip>,
  fallbackIp: Ip | null,
  profilesById: Map<string, PublicProfileRow>,
  likesByPostId: Map<string, number>,
  commentsByPostId: Map<string, number>,
  commentsByPost: Map<string, CommunityFeedComment[]>,
  likedPostIds: Set<string>,
  viewerId: string | null,
  imageUrlByPath: Map<string, string>,
): CommunityFeedPost {
  const ip = row.ip_id ? ipsById.get(row.ip_id) : null;
  const displayIp = ip ?? fallbackIp;

  return {
    id: row.id,
    authorId: row.user_id,
    user: publicAuthorName(profilesById.get(row.user_id), row.user_id),
    ipId: row.ip_id,
    ipName: displayIp?.title ?? '커뮤니티',
    avatar: displayIp?.v.color ?? 'var(--holo)',
    text: row.text,
    likes: likesByPostId.get(row.id) ?? 0,
    comments: commentsByPostId.get(row.id) ?? 0,
    time: formatPostTime(row.created_at),
    tag: row.tag?.trim() || '커뮤니티',
    img: row.image_path ? imageUrlByPath.get(row.image_path) ?? null : null,
    likedByViewer: likedPostIds.has(row.id),
    canDelete: viewerId === row.user_id,
    commentItems: commentsByPost.get(row.id) ?? [],
  };
}

function mockPosts(ips: Ip[]): CommunityFeedPost[] {
  const fallbackIp = postFallbackIp(ips);
  const ipsByTitle = new Map(ips.map((ip) => [ip.title, ip]));

  return DATA.POSTS.map((post) => {
    const ip = ipsByTitle.get(post.ipName) ?? fallbackIp;
    return {
      id: post.id,
      authorId: '',
      user: post.user,
      ipId: ip?.id ?? null,
      ipName: post.ipName,
      avatar: post.avatar,
      text: post.text,
      likes: post.likes,
      comments: post.comments,
      time: post.time,
      tag: post.tag,
      img: post.img,
      likedByViewer: false,
      canDelete: false,
      commentItems: [],
    };
  });
}

async function getSupabasePosts(
  supabase: CommunitySupabaseClient,
  ips: Ip[],
  viewerId: string | null,
  isStaff: boolean,
) {
  const blockedIds = await blockedUserIds(supabase, viewerId);
  let postsQuery = supabase
    .from('posts')
    .select('id,user_id,ip_id,text,tag,created_at,image_path,status')
    .order('created_at', { ascending: false })
    .limit(COMMUNITY_FEED_LIMIT);

  if (blockedIds.size) {
    postsQuery = postsQuery.not('user_id', 'in', postgrestInList(blockedUserIdList(blockedIds)));
  }

  const postsResult = await postsQuery;

  if (postsResult.error) {
    throw new Error(`Failed to load community posts: ${postsResult.error.message}`);
  }

  const posts = ((postsResult.data ?? []) as CommunityPostRow[]).filter((post) =>
    canViewCommunityPost({ status: post.status, userId: post.user_id }, { viewerId, isStaff }),
  );
  if (!posts.length) return [];

  const postIds = posts.map((post) => post.id);
  const imagePaths = Array.from(new Set(posts.map((post) => post.image_path).filter((path): path is string => Boolean(path))));

  const [reactionCounts, comments, likedPostIds, imageUrlByPath] = await Promise.all([
    reactionCountsByPostId(supabase, postIds, blockedIds),
    commentsForPosts(supabase, postIds, blockedIds),
    viewerLikePostIds(supabase, postIds, viewerId),
    signedImageUrlByPath(supabase, imagePaths),
  ]);
  const userIds = Array.from(new Set([
    ...posts.map((post) => post.user_id),
    ...comments.map((comment) => comment.user_id),
  ]));
  const profilesResult = await supabase.from('public_profiles').select('id,nickname').in('id', userIds);

  if (profilesResult.error) {
    throw new Error(`Failed to load community authors: ${profilesResult.error.message}`);
  }

  const ipsById = new Map(ips.map((ip) => [ip.id, ip]));
  const fallbackIp = postFallbackIp(ips);
  const profilesById = new Map(((profilesResult.data ?? []) as PublicProfileRow[]).map((profile) => [profile.id, profile]));
  const commentsByPost = commentItemsByPostId(comments, profilesById, viewerId);

  return posts.map((post) =>
    toCommunityPost(
      post,
      ipsById,
      fallbackIp,
      profilesById,
      reactionCounts.likesByPostId,
      reactionCounts.commentsByPostId,
      commentsByPost,
      likedPostIds,
      viewerId,
      imageUrlByPath,
    ),
  );
}

async function getSupabaseTrendingTags(supabase: CommunitySupabaseClient) {
  try {
    const { data, error } = await supabase.rpc('community_trending_tags', {
      window_days: COMMUNITY_TRENDING_WINDOW_DAYS,
      result_limit: COMMUNITY_TRENDING_LIMIT,
    });

    if (error) return [];

    return ((data ?? []) as CommunityTrendingTagRow[])
      .map((row) => row.tag)
      .filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
  } catch {
    return [];
  }
}

export async function getCommunitySnapshot(options: CommunitySnapshotOptions = {}): Promise<CommunitySnapshot> {
  const catalog = await getCatalogSnapshot();
  const viewerId = options.viewerId ?? null;
  const isStaff = options.isStaff ?? false;

  if (catalog.source === 'mock') {
    return {
      source: 'mock',
      channels: catalog.ips.map(channelFromIp),
      goods: catalog.goods,
      posts: mockPosts(catalog.ips),
      trending: DATA.TRENDING,
    };
  }

  const supabase = await createClient();
  const [posts, trending] = await Promise.all([
    getSupabasePosts(supabase, catalog.ips, viewerId, isStaff),
    getSupabaseTrendingTags(supabase),
  ]);

  return {
    source: 'supabase',
    channels: catalog.ips.map(channelFromIp),
    goods: catalog.goods,
    posts,
    trending,
  };
}
