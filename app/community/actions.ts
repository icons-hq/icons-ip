'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { getCatalogSnapshot } from '@/lib/catalog';
import {
  ACCOUNT_SUSPENDED_PATH,
  isAccountSuspended,
  isOnboarded,
  onboardingPath,
  safeNextPath,
} from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import {
  buildCommunityUploadPath,
  normalizeCommunityBlockForm,
  normalizeCommunityCommentForm,
  normalizeCommunityLikeForm,
  normalizeCommunityPostEditForm,
  normalizeCommunityPostForm,
  normalizeCommunityReportForm,
  normalizeCommunityUuid,
} from '@/lib/community';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { createClient } from '@/lib/supabase/server';

export interface CommunityPostActionState {
  errors?: {
    text?: string;
    ipId?: string;
    image?: string;
    form?: string;
  };
}

export interface CommunityCommentActionState {
  errors?: {
    postId?: string;
    text?: string;
    form?: string;
  };
}

export interface CommunityPostEditActionState {
  errors?: {
    postId?: string;
    text?: string;
    ipId?: string;
    form?: string;
  };
}

const USER_UPLOADS_BUCKET = 'user-uploads';
const COMMUNITY_WRITES_DISABLED_MESSAGE =
  '커뮤니티 글쓰기는 운영 준비 중입니다. 기존 콘텐츠 열람·신고·삭제는 이용할 수 있습니다.';

type CommunityWriteCapability = 'postCreate' | 'postEdit' | 'commentCreate';

async function isCommunityWriteEnabled(
  supabase: Awaited<ReturnType<typeof createClient>>,
  capability: CommunityWriteCapability,
) {
  const { data, error } = await supabase.rpc('community_write_capabilities');
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  return (data as Record<string, unknown>)[capability] === true;
}

/* 커뮤니티 임시 비공개 — 라우트가 404여도 서버 액션은 폼 없이 직접 호출될 수 있어 여기서도 막는다.
   DB의 community_write_capabilities 게이트보다 앞단이고, 읽기 액션까지 함께 닫는다. */
function assertCommunityEnabled() {
  if (!COMMUNITY_ENABLED) notFound();
}

function readNext(formData: FormData) {
  const value = formData.get('next');
  return typeof value === 'string' && value.trim() ? safeNextPath(value) : '/community';
}

function loginPath(next: string) {
  return `/login?next=${encodeURIComponent(safeNextPath(next))}`;
}

function communityErrorPath(next: string) {
  const url = new URL(safeNextPath(next), 'https://icons.local');
  url.searchParams.set('community_error', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

function readRpcIpId(data: unknown) {
  if (!data || typeof data !== 'object') return null;
  const candidate = Array.isArray(data) ? data[0] : data;
  if (!candidate || typeof candidate !== 'object') return null;
  const ipId = (candidate as { ipId?: unknown; ip_id?: unknown }).ipId ?? (candidate as { ip_id?: unknown }).ip_id;
  return typeof ipId === 'string' && ipId.trim() ? ipId : null;
}

function readPostEditRpcResult(data: unknown) {
  if (!data || typeof data !== 'object') return null;
  const candidate = Array.isArray(data) ? data[0] : data;
  if (!candidate || typeof candidate !== 'object') return null;

  const value = candidate as {
    previousIpId?: unknown;
    previous_ip_id?: unknown;
    ipId?: unknown;
    ip_id?: unknown;
    updatedAt?: unknown;
    updated_at?: unknown;
  };
  const previousIpId = value.previousIpId ?? value.previous_ip_id ?? null;
  const ipId = value.ipId ?? value.ip_id;
  const updatedAt = value.updatedAt ?? value.updated_at;

  if (previousIpId !== null && typeof previousIpId !== 'string') return null;
  if (typeof ipId !== 'string' || !ipId.trim()) return null;
  if (typeof updatedAt !== 'string' || !updatedAt.trim()) return null;

  return {
    previousIpId: previousIpId?.trim() || null,
    ipId: ipId.trim(),
    updatedAt,
  };
}

async function requireAuthenticatedCommunityUser(next: string) {
  const auth = await getCurrentAuthState();

  if (!auth.isConfigured || !auth.user) {
    redirect(loginPath(next));
  }

  return { auth, user: auth.user };
}

async function requireCommunityUser(next: string) {
  const { auth, user } = await requireAuthenticatedCommunityUser(next);

  if (!isOnboarded(auth.profile, user.email)) {
    redirect(onboardingPath(next));
  }

  return user;
}

async function requireActiveCommunityUser(next: string) {
  const { auth, user } = await requireAuthenticatedCommunityUser(next);

  if (isAccountSuspended(auth.profile)) {
    redirect(ACCOUNT_SUSPENDED_PATH);
  }
  if (!isOnboarded(auth.profile, user.email)) {
    redirect(onboardingPath(next));
  }

  return user;
}

function isAccountSuspendedError(error: { message?: string | null } | null | undefined) {
  return error?.message?.toLowerCase().includes('account_suspended') === true;
}

function isCatalogItemArchivedError(error: { message?: string | null } | null | undefined) {
  return error?.message?.toLowerCase().includes('catalog_item_archived') === true;
}

function revalidateCommunitySurfaces(ipId: string | null) {
  revalidatePath('/community');
  revalidatePath('/');
  if (ipId) revalidatePath(`/ip/${ipId}`);
}

function revalidateCommunityModerationSurfaces(ipId: string | null) {
  revalidateCommunitySurfaces(ipId);
  revalidatePath('/search');
}

function revalidateCommunityEditSurfaces(previousIpId: string | null, ipId: string) {
  revalidatePath('/');
  revalidatePath('/community');
  revalidatePath('/search');

  for (const affectedIpId of new Set([previousIpId, ipId])) {
    if (affectedIpId) revalidatePath(`/ip/${affectedIpId}`);
  }
}

export async function createCommunityPostAction(
  _state: CommunityPostActionState,
  formData: FormData,
): Promise<CommunityPostActionState> {
  assertCommunityEnabled();
  const next = readNext(formData);
  const user = await requireActiveCommunityUser(next);

  const catalog = await getCatalogSnapshot();
  const normalized = normalizeCommunityPostForm(formData, new Set(catalog.ips.map((ip) => ip.id)));

  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  if (!await isCommunityWriteEnabled(supabase, 'postCreate')) {
    return { errors: { form: COMMUNITY_WRITES_DISABLED_MESSAGE } };
  }

  const { text, ipId, tag, image } = normalized.value;
  let imagePath: string | null = null;

  if (image) {
    imagePath = buildCommunityUploadPath({
      userId: user.id,
      mimeType: image.type,
      nonce: crypto.randomUUID(),
    });

    const { error } = await supabase.storage
      .from(USER_UPLOADS_BUCKET)
      .upload(imagePath, image, {
        contentType: image.type,
        upsert: false,
      });

    if (error) {
      return { errors: { image: '이미지를 업로드하지 못했습니다. 다시 시도해주세요.' } };
    }
  }

  const { error } = await supabase
    .from('posts')
    .insert({
      user_id: user.id,
      ip_id: ipId,
      text,
      tag,
      image_path: imagePath,
    })
    .select('id')
    .single();

  if (error) {
    if (isAccountSuspendedError(error)) {
      return { errors: { form: '정지된 계정은 새 포스트를 작성할 수 없습니다.' } };
    }
    if (isCatalogItemArchivedError(error)) {
      return { errors: { ipId: '운영 중인 IP 채널을 선택해주세요.' } };
    }
    return { errors: { form: '포스트를 저장하지 못했습니다. 다시 시도해주세요.' } };
  }

  revalidatePath('/community');
  revalidatePath('/');
  if (ipId) revalidatePath(`/ip/${ipId}`);

  redirect(next);
}

export async function editCommunityPostAction(
  _state: CommunityPostEditActionState,
  formData: FormData,
): Promise<CommunityPostEditActionState> {
  assertCommunityEnabled();
  const next = readNext(formData);
  const user = await requireActiveCommunityUser(next);

  const catalog = await getCatalogSnapshot();
  const supabase = await createClient();
  if (!await isCommunityWriteEnabled(supabase, 'postEdit')) {
    return { errors: { form: COMMUNITY_WRITES_DISABLED_MESSAGE } };
  }

  const postId = normalizeCommunityUuid(formData.get('postId'));
  const allowedIpIds = new Set(catalog.ips.map((ip) => ip.id));

  if (postId) {
    const { data: currentPost, error: currentPostError } = await supabase
      .from('posts')
      .select('ip_id')
      .eq('id', postId)
      .eq('user_id', user.id)
      .eq('status', 'visible')
      .maybeSingle<{ ip_id: string | null }>();

    if (!currentPostError && currentPost?.ip_id) allowedIpIds.add(currentPost.ip_id);
  }

  const normalized = normalizeCommunityPostEditForm(formData, allowedIpIds);
  if (!normalized.ok) return { errors: normalized.errors };

  const { text, ipId, tag } = normalized.value;
  const { data, error } = await supabase.rpc('edit_own_post', {
    target_post_id: normalized.value.postId,
    post_text: text,
    post_ip_id: ipId,
    post_tag: tag,
  });
  const result = error ? null : readPostEditRpcResult(data);

  if (!result) {
    if (isCatalogItemArchivedError(error)) {
      return { errors: { ipId: '운영 중인 IP 채널을 선택해주세요.' } };
    }
    return {
      errors: {
        form: isAccountSuspendedError(error)
          ? '정지된 계정은 포스트를 수정할 수 없습니다.'
          : '포스트를 수정할 수 없습니다. 최신 상태를 확인한 뒤 다시 시도해주세요.',
      },
    };
  }

  revalidateCommunityEditSurfaces(result.previousIpId, result.ipId);
  redirect(next);
}

export async function createCommunityCommentAction(
  _state: CommunityCommentActionState,
  formData: FormData,
): Promise<CommunityCommentActionState> {
  assertCommunityEnabled();
  const next = readNext(formData);
  await requireActiveCommunityUser(next);

  const normalized = normalizeCommunityCommentForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  if (!await isCommunityWriteEnabled(supabase, 'commentCreate')) {
    return { errors: { form: COMMUNITY_WRITES_DISABLED_MESSAGE } };
  }

  const { error, data } = await supabase.rpc('create_post_comment', {
    target_post_id: normalized.value.postId,
    comment_text: normalized.value.text,
  });

  if (error) {
    return {
      errors: {
        form: isAccountSuspendedError(error)
          ? '정지된 계정은 새 댓글을 작성할 수 없습니다.'
          : '댓글을 저장하지 못했습니다. 다시 시도해주세요.',
      },
    };
  }

  revalidateCommunitySurfaces(readRpcIpId(data));
  redirect(next);
}

export async function setCommunityPostLikeAction(formData: FormData) {
  assertCommunityEnabled();
  const next = readNext(formData);
  await requireCommunityUser(next);

  const normalized = normalizeCommunityLikeForm(formData);
  if (!normalized.ok) redirect(communityErrorPath(next));

  const supabase = await createClient();
  const { error, data } = await supabase.rpc('set_post_like', {
    target_post_id: normalized.value.postId,
    should_like: normalized.value.shouldLike,
  });

  if (error) redirect(communityErrorPath(next));

  revalidateCommunitySurfaces(readRpcIpId(data));
  redirect(next);
}

export async function deleteCommunityPostAction(formData: FormData) {
  assertCommunityEnabled();
  const next = readNext(formData);
  await requireCommunityUser(next);

  const postId = normalizeCommunityUuid(formData.get('postId'));
  if (!postId) redirect(communityErrorPath(next));

  const supabase = await createClient();
  const { error, data } = await supabase.rpc('delete_own_post', {
    target_post_id: postId,
  });

  if (error) redirect(communityErrorPath(next));

  revalidateCommunitySurfaces(readRpcIpId(data));
  redirect(next);
}

export async function deleteCommunityCommentAction(formData: FormData) {
  assertCommunityEnabled();
  const next = readNext(formData);
  await requireCommunityUser(next);

  const commentId = normalizeCommunityUuid(formData.get('commentId'));
  if (!commentId) redirect(communityErrorPath(next));

  const supabase = await createClient();
  const { error, data } = await supabase.rpc('delete_own_comment', {
    target_comment_id: commentId,
  });

  if (error) redirect(communityErrorPath(next));

  revalidateCommunitySurfaces(readRpcIpId(data));
  redirect(next);
}

export async function reportCommunityTargetAction(formData: FormData) {
  assertCommunityEnabled();
  const next = readNext(formData);
  await requireAuthenticatedCommunityUser(next);

  const normalized = normalizeCommunityReportForm(formData);
  if (!normalized.ok) redirect(communityErrorPath(next));

  const supabase = await createClient();
  const { error, data } = await supabase.rpc('submit_community_report', {
    target_type: normalized.value.targetType,
    target_id: normalized.value.targetId,
    reason: normalized.value.reason,
  });

  if (error) redirect(communityErrorPath(next));

  revalidateCommunitySurfaces(readRpcIpId(data));
  redirect(next);
}

export async function blockCommunityUserAction(formData: FormData) {
  assertCommunityEnabled();
  const next = readNext(formData);
  await requireAuthenticatedCommunityUser(next);

  const normalized = normalizeCommunityBlockForm(formData);
  if (!normalized.ok) redirect(communityErrorPath(next));

  const supabase = await createClient();
  const { error } = await supabase.rpc('block_community_user', {
    target_user_id: normalized.value.targetUserId,
  });

  if (error) redirect(communityErrorPath(next));

  revalidateCommunityModerationSurfaces(null);
  redirect(next);
}
