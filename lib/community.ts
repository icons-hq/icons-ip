import type { Good } from './data';

export type CommunityPostStatus = 'visible' | 'hidden';
export type CommunityReportTarget = 'post' | 'comment' | 'user';
export type CommunityReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';
export type CommunityFeedScope = 'all' | 'fandom';
export type CommunityViewerState = 'guest' | 'onboarding' | 'onboarded';

export const MAX_COMMUNITY_IMAGE_BYTES = 5 * 1024 * 1024;

export function normalizeCommunityFeedScope(value: string | string[] | undefined): CommunityFeedScope {
  return value === 'fandom' ? 'fandom' : 'all';
}

const IMAGE_EXTENSIONS_BY_MIME_TYPE = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

const IMAGE_ERROR = '이미지는 JPEG, PNG, WebP, GIF 형식의 5MB 이하 파일만 업로드할 수 있습니다.';

export interface CommunityPostVisibilityInput {
  status: CommunityPostStatus;
  userId: string;
}

export interface CommunityViewerInput {
  viewerId: string | null;
  isStaff: boolean;
}

export interface CommunityChannel {
  id: string;
  title: string;
  sub: string;
  color: string;
}

export interface CommunityFeedComment {
  id: string;
  authorId: string;
  user: string;
  text: string;
  time: string;
  canDelete: boolean;
}

export interface CommunityFeedPost {
  id: string;
  authorId: string;
  user: string;
  ipId: string | null;
  ipName: string;
  avatar: string;
  text: string;
  likes: number;
  comments: number;
  time: string;
  tag: string | null;
  img?: string | null;
  likedByViewer: boolean;
  canDelete: boolean;
  canEdit: boolean;
  isEdited: boolean;
  commentItems: CommunityFeedComment[];
}

export interface CommunitySnapshot {
  source: 'supabase' | 'mock';
  channels: CommunityChannel[];
  goods: Good[];
  posts: CommunityFeedPost[];
  trending: string[];
}

export function canViewCommunityPost(
  post: CommunityPostVisibilityInput,
  viewer: CommunityViewerInput,
) {
  return post.status === 'visible' || post.userId === viewer.viewerId || viewer.isStaff;
}

export interface CommunityPostFormValue {
  text: string;
  ipId: string | null;
  tag: string | null;
  image: File | null;
}

export interface CommunityPostFormErrors {
  text?: string;
  ipId?: string;
  image?: string;
}

export type CommunityPostFormResult =
  | { ok: true; value: CommunityPostFormValue }
  | { ok: false; errors: CommunityPostFormErrors };

export interface CommunityPostEditFormValue {
  postId: string;
  text: string;
  ipId: string;
  tag: string | null;
}

export interface CommunityPostEditFormErrors {
  postId?: string;
  text?: string;
  ipId?: string;
}

export type CommunityPostEditFormResult =
  | { ok: true; value: CommunityPostEditFormValue }
  | { ok: false; errors: CommunityPostEditFormErrors };

export interface CommunityCommentFormValue {
  postId: string;
  text: string;
}

export interface CommunityCommentFormErrors {
  postId?: string;
  text?: string;
}

export type CommunityCommentFormResult =
  | { ok: true; value: CommunityCommentFormValue }
  | { ok: false; errors: CommunityCommentFormErrors };

export interface CommunityLikeFormValue {
  postId: string;
  shouldLike: boolean;
}

export interface CommunityLikeFormErrors {
  postId?: string;
}

export type CommunityLikeFormResult =
  | { ok: true; value: CommunityLikeFormValue }
  | { ok: false; errors: CommunityLikeFormErrors };

export interface CommunityReportFormValue {
  targetType: CommunityReportTarget;
  targetId: string;
  reason: string | null;
}

export interface CommunityReportFormErrors {
  targetType?: string;
  targetId?: string;
}

export type CommunityReportFormResult =
  | { ok: true; value: CommunityReportFormValue }
  | { ok: false; errors: CommunityReportFormErrors };

export interface CommunityBlockFormValue {
  targetUserId: string;
}

export interface CommunityBlockFormErrors {
  targetUserId?: string;
}

export type CommunityBlockFormResult =
  | { ok: true; value: CommunityBlockFormValue }
  | { ok: false; errors: CommunityBlockFormErrors };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeCommunityUuid(value: FormDataEntryValue | string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function readUuid(formData: FormData, key: string) {
  return normalizeCommunityUuid(formData.get(key));
}

function readBoolean(formData: FormData, key: string) {
  const value = readString(formData, key).toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'like';
}

function normalizeTag(value: string) {
  const normalized = value.replace(/^#+/, '').replace(/[^\p{L}\p{N}_-]+/gu, '').trim();
  return normalized || null;
}

function isCommunityReportTarget(value: string): value is CommunityReportTarget {
  return value === 'post' || value === 'comment' || value === 'user';
}

function imageFromFormData(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) return null;
  return value;
}

function isAcceptedImage(file: File) {
  return file.size <= MAX_COMMUNITY_IMAGE_BYTES && IMAGE_EXTENSIONS_BY_MIME_TYPE.has(file.type);
}

export function normalizeCommunityPostForm(
  formData: FormData,
  allowedIpIds: ReadonlySet<string>,
): CommunityPostFormResult {
  const text = readString(formData, 'text');
  const rawIpId = readString(formData, 'ipId');
  const ipId = rawIpId && allowedIpIds.has(rawIpId) ? rawIpId : null;
  const image = imageFromFormData(formData.get('image'));
  const errors: CommunityPostFormErrors = {};

  if (!text) errors.text = '포스트 내용을 입력해주세요.';
  if (!ipId) errors.ipId = 'IP 채널을 선택해주세요.';
  if (image && !isAcceptedImage(image)) errors.image = IMAGE_ERROR;

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      text,
      ipId,
      tag: normalizeTag(readString(formData, 'tag')),
      image,
    },
  };
}

export function normalizeCommunityPostEditForm(
  formData: FormData,
  allowedIpIds: ReadonlySet<string>,
): CommunityPostEditFormResult {
  const postId = readUuid(formData, 'postId');
  const text = readString(formData, 'text');
  const rawIpId = readString(formData, 'ipId');
  const ipId = rawIpId && allowedIpIds.has(rawIpId) ? rawIpId : null;
  const errors: CommunityPostEditFormErrors = {};

  if (!postId) errors.postId = '포스트를 찾을 수 없습니다.';
  if (!text) errors.text = '포스트 내용을 입력해주세요.';
  if (!ipId) errors.ipId = 'IP 채널을 선택해주세요.';

  if (!postId || !text || !ipId) return { ok: false, errors };

  return {
    ok: true,
    value: {
      postId,
      text,
      ipId,
      tag: normalizeTag(readString(formData, 'tag')),
    },
  };
}

export function normalizeCommunityCommentForm(formData: FormData): CommunityCommentFormResult {
  const postId = readUuid(formData, 'postId');
  const text = readString(formData, 'text');
  const errors: CommunityCommentFormErrors = {};

  if (!postId) errors.postId = '포스트를 찾을 수 없습니다.';
  if (!text) errors.text = '댓글을 입력해주세요.';

  if (!postId || !text) return { ok: false, errors };

  return {
    ok: true,
    value: {
      postId,
      text,
    },
  };
}

export function normalizeCommunityLikeForm(formData: FormData): CommunityLikeFormResult {
  const postId = readUuid(formData, 'postId');

  if (!postId) {
    return {
      ok: false,
      errors: {
        postId: '포스트를 찾을 수 없습니다.',
      },
    };
  }

  return {
    ok: true,
    value: {
      postId,
      shouldLike: readBoolean(formData, 'shouldLike'),
    },
  };
}

export function normalizeCommunityReportForm(formData: FormData): CommunityReportFormResult {
  const targetType = readString(formData, 'targetType');
  const targetId = readUuid(formData, 'targetId');
  const errors: CommunityReportFormErrors = {};

  if (!isCommunityReportTarget(targetType)) errors.targetType = '신고 대상을 찾을 수 없습니다.';
  if (!targetId) errors.targetId = '신고 대상을 찾을 수 없습니다.';

  if (!isCommunityReportTarget(targetType) || !targetId) return { ok: false, errors };

  return {
    ok: true,
    value: {
      targetType,
      targetId,
      reason: readString(formData, 'reason') || null,
    },
  };
}

export function normalizeCommunityBlockForm(formData: FormData): CommunityBlockFormResult {
  const targetUserId = readUuid(formData, 'targetUserId');

  if (!targetUserId) {
    return {
      ok: false,
      errors: {
        targetUserId: '차단할 사용자를 찾을 수 없습니다.',
      },
    };
  }

  return {
    ok: true,
    value: {
      targetUserId,
    },
  };
}

export function buildCommunityUploadPath({
  userId,
  mimeType,
  nonce,
}: {
  userId: string;
  mimeType: string;
  nonce: string;
}) {
  const extension = IMAGE_EXTENSIONS_BY_MIME_TYPE.get(mimeType) ?? 'bin';
  return `${userId}/community/${nonce}.${extension}`;
}
