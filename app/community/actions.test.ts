import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCommunityCommentAction,
  createCommunityPostAction,
  deleteCommunityCommentAction,
  deleteCommunityPostAction,
  blockCommunityUserAction,
  reportCommunityTargetAction,
  setCommunityPostLikeAction,
} from './actions';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { CurrentAuthState } from '@/lib/auth/server';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  catalog: null as CatalogSnapshot | null,
  insert: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => mocks.auth,
}));
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/community', async () => await import('../../lib/community'));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: () => mocks.catalog,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table !== 'posts') throw new Error(`Unexpected table ${table}`);
      return {
        insert: mocks.insert,
      };
    },
    storage: {
      from: (bucket: string) => {
        if (bucket !== 'user-uploads') throw new Error(`Unexpected bucket ${bucket}`);
        return {
          upload: mocks.upload,
        };
      },
    },
  }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

const catalog: CatalogSnapshot = {
  source: 'supabase',
  verticals: [{ key: 'rofan', label: '로맨스판타지', color: '#8B5CFF' }],
  ips: [{
    id: 'hwasan',
    title: '화산강림',
    sub: '리디 · 로판',
    v: { key: 'rofan', label: '로맨스판타지', color: '#8B5CFF' },
    glyph: '화산',
    bg: 'bg',
    fans: 10,
    goods: 1,
    cards: 1,
    featured: true,
    tagline: '매화는 다시 핀다',
    synopsis: '화산파의 부활',
  }],
  goods: [],
  cards: [],
  events: [],
};

const postId = '11111111-1111-4111-8111-111111111111';
const commentId = '22222222-2222-4222-8222-222222222222';

function postForm(next = '/community') {
  const formData = new FormData();
  formData.set('text', '  팝업 후기입니다  ');
  formData.set('ipId', 'hwasan');
  formData.set('tag', '팝업');
  formData.set('next', next);
  return formData;
}

function commentForm(next = '/community') {
  const formData = new FormData();
  formData.set('postId', postId);
  formData.set('text', '  저도 좋아요  ');
  formData.set('next', next);
  return formData;
}

function likeForm(shouldLike: boolean, next = '/community') {
  const formData = new FormData();
  formData.set('postId', postId);
  formData.set('shouldLike', shouldLike ? '1' : '0');
  formData.set('next', next);
  return formData;
}

function deletePostForm(next = '/community') {
  const formData = new FormData();
  formData.set('postId', postId);
  formData.set('next', next);
  return formData;
}

function deleteCommentForm(next = '/community') {
  const formData = new FormData();
  formData.set('commentId', commentId);
  formData.set('next', next);
  return formData;
}

function reportForm(next = '/community') {
  const formData = new FormData();
  formData.set('targetType', 'post');
  formData.set('targetId', postId);
  formData.set('reason', '  스팸성 포스트입니다  ');
  formData.set('next', next);
  return formData;
}

function blockForm(next = '/community') {
  const formData = new FormData();
  formData.set('targetUserId', '33333333-3333-4333-8333-333333333333');
  formData.set('next', next);
  return formData;
}

describe('createCommunityPostAction', () => {
  beforeEach(() => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      profile: {
        email: 'fan@icons.gg',
        nickname: 'fan',
        birth_date: '2000-01-01',
        consents: { terms: true, privacy: true, marketing: false },
        onboarded_at: '2026-06-23T00:00:00.000Z',
      },
      isStaff: false,
    };
    mocks.catalog = catalog;
    mocks.insert.mockReset();
    mocks.rpc.mockReset();
    mocks.upload.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.insert.mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: 'post-1' }, error: null }),
      }),
    });
    mocks.upload.mockResolvedValue({ data: { path: 'user-1/community/test.png' }, error: null });
  });

  it('redirects unauthenticated users to login with the current community path', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(createCommunityPostAction({}, postForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fcommunity',
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('returns validation errors without writing when the post form is invalid', async () => {
    const formData = new FormData();
    formData.set('text', ' ');
    formData.set('ipId', 'unknown');
    formData.set('next', '/community');

    await expect(createCommunityPostAction({}, formData)).resolves.toEqual({
      errors: {
        text: '포스트 내용을 입력해주세요.',
        ipId: 'IP 채널을 선택해주세요.',
      },
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('uploads an optional image, creates the post and refreshes the community surfaces', async () => {
    const randomUUIDSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('post-image' as `${string}-${string}-${string}-${string}-${string}`);
    const formData = postForm();
    const file = new File(['image'], 'proof.png', { type: 'image/png' });
    formData.set('image', file);

    await expect(createCommunityPostAction({}, formData)).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.upload).toHaveBeenCalledWith('user-1/community/post-image.png', file, {
      contentType: 'image/png',
      upsert: false,
    });
    expect(mocks.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      ip_id: 'hwasan',
      text: '팝업 후기입니다',
      tag: '팝업',
      image_path: 'user-1/community/post-image.png',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/community');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/hwasan');
    randomUUIDSpy.mockRestore();
  });

  it('returns to the safe fandom feed after creating a post', async () => {
    await expect(createCommunityPostAction({}, postForm('/community?feed=fandom'))).rejects.toThrow(
      'NEXT_REDIRECT:/community?feed=fandom',
    );
  });
});

describe('community reaction actions', () => {
  beforeEach(() => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      profile: {
        email: 'fan@icons.gg',
        nickname: 'fan',
        birth_date: '2000-01-01',
        consents: { terms: true, privacy: true, marketing: false },
        onboarded_at: '2026-06-23T00:00:00.000Z',
      },
      isStaff: false,
    };
    mocks.rpc.mockReset();
    mocks.revalidatePath.mockReset();
  });

  it('preserves the safe fandom feed URL across comment, like, delete, report and block actions', async () => {
    const fandomPath = '/community?feed=fandom';
    mocks.rpc.mockResolvedValue({ data: { ipId: 'hwasan' }, error: null });

    await expect(createCommunityCommentAction({}, commentForm(fandomPath))).rejects.toThrow(
      `NEXT_REDIRECT:${fandomPath}`,
    );
    await expect(setCommunityPostLikeAction(likeForm(true, fandomPath))).rejects.toThrow(
      `NEXT_REDIRECT:${fandomPath}`,
    );
    await expect(deleteCommunityPostAction(deletePostForm(fandomPath))).rejects.toThrow(
      `NEXT_REDIRECT:${fandomPath}`,
    );
    await expect(deleteCommunityCommentAction(deleteCommentForm(fandomPath))).rejects.toThrow(
      `NEXT_REDIRECT:${fandomPath}`,
    );
    await expect(reportCommunityTargetAction(reportForm(fandomPath))).rejects.toThrow(
      `NEXT_REDIRECT:${fandomPath}`,
    );
    await expect(blockCommunityUserAction(blockForm(fandomPath))).rejects.toThrow(
      `NEXT_REDIRECT:${fandomPath}`,
    );
  });

  it('redirects unauthenticated comment submissions to login', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(createCommunityCommentAction({}, commentForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fcommunity',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('creates a comment through the visible-post RPC and refreshes community surfaces', async () => {
    mocks.rpc.mockResolvedValue({ data: { ipId: 'hwasan' }, error: null });

    await expect(createCommunityCommentAction({}, commentForm())).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.rpc).toHaveBeenCalledWith('create_post_comment', {
      target_post_id: postId,
      comment_text: '저도 좋아요',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/community');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/hwasan');
  });

  it('sets the requested like state instead of issuing a non-idempotent flip command', async () => {
    mocks.rpc.mockResolvedValue({ data: { ipId: 'hwasan', liked: true }, error: null });

    await expect(setCommunityPostLikeAction(likeForm(true))).rejects.toThrow('NEXT_REDIRECT:/community');
    await expect(setCommunityPostLikeAction(likeForm(true))).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'set_post_like', {
      target_post_id: postId,
      should_like: true,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'set_post_like', {
      target_post_id: postId,
      should_like: true,
    });
  });

  it('sets unlike submissions as a requested final state', async () => {
    mocks.rpc.mockResolvedValue({ data: { ipId: 'hwasan', liked: false }, error: null });

    await expect(setCommunityPostLikeAction(likeForm(false))).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.rpc).toHaveBeenCalledWith('set_post_like', {
      target_post_id: postId,
      should_like: false,
    });
  });

  it('redirects unauthenticated like submissions to login', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(setCommunityPostLikeAction(likeForm(true))).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fcommunity',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('deletes only the current author post through the delete RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: { ipId: 'hwasan' }, error: null });

    await expect(deleteCommunityPostAction(deletePostForm())).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.rpc).toHaveBeenCalledWith('delete_own_post', {
      target_post_id: postId,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/community');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/hwasan');
  });

  it('deletes only the current author comment through the delete RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: { ipId: 'hwasan' }, error: null });

    await expect(deleteCommunityCommentAction(deleteCommentForm())).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.rpc).toHaveBeenCalledWith('delete_own_comment', {
      target_comment_id: commentId,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/community');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/hwasan');
  });

  it('redirects unauthenticated report submissions to login', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(reportCommunityTargetAction(reportForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fcommunity',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('submits a community report through the moderation RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: { ipId: 'hwasan' }, error: null });

    await expect(reportCommunityTargetAction(reportForm())).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.rpc).toHaveBeenCalledWith('submit_community_report', {
      target_type: 'post',
      target_id: postId,
      reason: '스팸성 포스트입니다',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/community');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/hwasan');
  });

  it('allows authenticated users who have not completed onboarding to report safety targets', async () => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      profile: null,
      isStaff: false,
    };
    mocks.rpc.mockResolvedValue({ data: { ipId: 'hwasan' }, error: null });

    await expect(reportCommunityTargetAction(reportForm())).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.rpc).toHaveBeenCalledWith('submit_community_report', {
      target_type: 'post',
      target_id: postId,
      reason: '스팸성 포스트입니다',
    });
  });

  it('blocks a community user through an idempotent RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(blockCommunityUserAction(blockForm())).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.rpc).toHaveBeenCalledWith('block_community_user', {
      target_user_id: '33333333-3333-4333-8333-333333333333',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/community');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/search');
  });

  it('allows authenticated users who have not completed onboarding to block users', async () => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      profile: null,
      isStaff: false,
    };
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(blockCommunityUserAction(blockForm())).rejects.toThrow('NEXT_REDIRECT:/community');

    expect(mocks.rpc).toHaveBeenCalledWith('block_community_user', {
      target_user_id: '33333333-3333-4333-8333-333333333333',
    });
  });
});
