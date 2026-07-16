import { describe, expect, it } from 'vitest';
import {
  MAX_COMMUNITY_IMAGE_BYTES,
  buildCommunityUploadPath,
  canViewCommunityPost,
  normalizeCommunityBlockForm,
  normalizeCommunityCommentForm,
  normalizeCommunityLikeForm,
  normalizeCommunityFeedScope,
  normalizeCommunityPostForm,
  normalizeCommunityReportForm,
} from './community';

describe('normalizeCommunityFeedScope', () => {
  it('accepts only the explicit fandom scope', () => {
    expect(normalizeCommunityFeedScope('fandom')).toBe('fandom');
    expect(normalizeCommunityFeedScope(undefined)).toBe('all');
    expect(normalizeCommunityFeedScope('all')).toBe('all');
    expect(normalizeCommunityFeedScope('unknown')).toBe('all');
  });

  it('normalizes repeated query values to the default all feed', () => {
    expect(normalizeCommunityFeedScope(['fandom', 'all'])).toBe('all');
  });
});

describe('canViewCommunityPost', () => {
  it('shows visible posts to public viewers', () => {
    expect(canViewCommunityPost({ status: 'visible', userId: 'author' }, { viewerId: null, isStaff: false })).toBe(true);
  });

  it('shows hidden posts only to the author or staff', () => {
    const post = { status: 'hidden' as const, userId: 'author' };

    expect(canViewCommunityPost(post, { viewerId: null, isStaff: false })).toBe(false);
    expect(canViewCommunityPost(post, { viewerId: 'other', isStaff: false })).toBe(false);
    expect(canViewCommunityPost(post, { viewerId: 'author', isStaff: false })).toBe(true);
    expect(canViewCommunityPost(post, { viewerId: 'other', isStaff: true })).toBe(true);
  });
});

describe('normalizeCommunityPostForm', () => {
  it('normalizes text, IP, tag and accepted optional image input', () => {
    const formData = new FormData();
    const file = new File(['image'], 'proof.png', { type: 'image/png' });
    formData.set('text', '  성수 팝업 후기입니다  ');
    formData.set('ipId', 'hwasan');
    formData.set('tag', '  팝업 인증!  ');
    formData.set('image', file);

    expect(normalizeCommunityPostForm(formData, new Set(['hwasan']))).toEqual({
      ok: true,
      value: {
        text: '성수 팝업 후기입니다',
        ipId: 'hwasan',
        tag: '팝업인증',
        image: file,
      },
    });
  });

  it('rejects empty text, unknown IP IDs, unsupported images and oversized images', () => {
    const formData = new FormData();
    formData.set('text', ' ');
    formData.set('ipId', 'unknown');
    formData.set('image', new File([new Uint8Array(MAX_COMMUNITY_IMAGE_BYTES + 1)], 'proof.txt', { type: 'text/plain' }));

    expect(normalizeCommunityPostForm(formData, new Set(['hwasan']))).toEqual({
      ok: false,
      errors: {
        text: '포스트 내용을 입력해주세요.',
        ipId: 'IP 채널을 선택해주세요.',
        image: '이미지는 JPEG, PNG, WebP, GIF 형식의 5MB 이하 파일만 업로드할 수 있습니다.',
      },
    });
  });
});

describe('normalizeCommunityCommentForm', () => {
  it('keeps the target post UUID and trims comment text', () => {
    const formData = new FormData();
    formData.set('postId', '11111111-1111-4111-8111-111111111111');
    formData.set('text', '  좋은 후기 감사합니다  ');

    expect(normalizeCommunityCommentForm(formData)).toEqual({
      ok: true,
      value: {
        postId: '11111111-1111-4111-8111-111111111111',
        text: '좋은 후기 감사합니다',
      },
    });
  });

  it('rejects missing post IDs and empty comment text', () => {
    const formData = new FormData();
    formData.set('postId', 'not-a-post');
    formData.set('text', ' ');

    expect(normalizeCommunityCommentForm(formData)).toEqual({
      ok: false,
      errors: {
        postId: '포스트를 찾을 수 없습니다.',
        text: '댓글을 입력해주세요.',
      },
    });
  });
});

describe('normalizeCommunityLikeForm', () => {
  it('normalizes like submissions as a desired final state', () => {
    const formData = new FormData();
    formData.set('postId', '11111111-1111-4111-8111-111111111111');
    formData.set('shouldLike', '1');

    expect(normalizeCommunityLikeForm(formData)).toEqual({
      ok: true,
      value: {
        postId: '11111111-1111-4111-8111-111111111111',
        shouldLike: true,
      },
    });
  });

  it('keeps repeated unlike submissions idempotent instead of flipping state again', () => {
    const formData = new FormData();
    formData.set('postId', '11111111-1111-4111-8111-111111111111');
    formData.set('shouldLike', '0');

    expect(normalizeCommunityLikeForm(formData)).toEqual({
      ok: true,
      value: {
        postId: '11111111-1111-4111-8111-111111111111',
        shouldLike: false,
      },
    });
  });
});

describe('normalizeCommunityReportForm', () => {
  it('normalizes a post report target and optional reason text', () => {
    const formData = new FormData();
    formData.set('targetType', 'post');
    formData.set('targetId', '11111111-1111-4111-8111-111111111111');
    formData.set('reason', '  스팸성 포스트입니다  ');

    expect(normalizeCommunityReportForm(formData)).toEqual({
      ok: true,
      value: {
        targetType: 'post',
        targetId: '11111111-1111-4111-8111-111111111111',
        reason: '스팸성 포스트입니다',
      },
    });
  });

  it('rejects unknown report targets and invalid ids', () => {
    const formData = new FormData();
    formData.set('targetType', 'goods');
    formData.set('targetId', 'not-a-uuid');
    formData.set('reason', ' ');

    expect(normalizeCommunityReportForm(formData)).toEqual({
      ok: false,
      errors: {
        targetType: '신고 대상을 찾을 수 없습니다.',
        targetId: '신고 대상을 찾을 수 없습니다.',
      },
    });
  });
});

describe('normalizeCommunityBlockForm', () => {
  it('normalizes the user id to block', () => {
    const formData = new FormData();
    formData.set('targetUserId', '22222222-2222-4222-8222-222222222222');

    expect(normalizeCommunityBlockForm(formData)).toEqual({
      ok: true,
      value: {
        targetUserId: '22222222-2222-4222-8222-222222222222',
      },
    });
  });

  it('rejects invalid user ids', () => {
    const formData = new FormData();
    formData.set('targetUserId', 'not-a-user');

    expect(normalizeCommunityBlockForm(formData)).toEqual({
      ok: false,
      errors: {
        targetUserId: '차단할 사용자를 찾을 수 없습니다.',
      },
    });
  });
});

describe('buildCommunityUploadPath', () => {
  it('stores uploads under the authenticated user folder with a safe extension', () => {
    expect(buildCommunityUploadPath({ userId: 'user-1', mimeType: 'image/webp', nonce: 'abc-123' })).toBe(
      'user-1/community/abc-123.webp',
    );
  });
});
