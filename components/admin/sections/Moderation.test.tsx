import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminReportRecord } from '@/lib/admin/moderation.server';
import { confirmCommunityCommentHide, ModerationSection } from './Moderation';

const actions = vi.hoisted(() => ({
  hideComment: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: () => [{}, vi.fn(), false],
  };
});
vi.mock('@/app/admin/actions', () => ({
  hideCommunityCommentAction: actions.hideComment,
  hideCommunityPostAction: vi.fn(),
  updateCommunityReportStatusAction: vi.fn(),
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

function commentReport(status: 'visible' | 'hidden'): AdminReportRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    targetType: 'comment',
    targetId: '11111111-1111-4111-8111-111111111111',
    targetLabel: '신고된 댓글 원문',
    targetPostId: '22222222-2222-4222-8222-222222222222',
    targetCommentId: '11111111-1111-4111-8111-111111111111',
    targetCommentStatus: status,
    targetReviewId: null,
    targetAuthorId: 'author-1',
    targetAuthorName: '작성자',
    reporterName: '신고자',
    reason: '신고 사유',
    status: 'open',
    createdAt: '2026-07-17T00:00:00.000Z',
  };
}

describe('ModerationSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    actions.hideComment.mockReset();
  });

  it('keeps parent-post moderation and adds a distinct comment hide action', () => {
    const html = renderToStaticMarkup(<ModerationSection reports={[commentReport('visible')]} />);

    expect(html).toContain('댓글 숨김');
    expect(html).toContain('포스트 숨김');
    expect(html).toContain('name="commentId"');
    expect(html).toContain('name="postId"');
    expect(html).toContain('aria-label="댓글 신고 상태"');
    expect(html).toContain('admin-field-control');
    expect(html).toContain('min-height:44px');
  });

  it('labels an already-hidden comment and disables repeat moderation', () => {
    const html = renderToStaticMarkup(<ModerationSection reports={[commentReport('hidden')]} />);

    expect(html).toContain('숨김 처리됨');
    expect(html).toContain('disabled=""');
    expect(html).toContain('신고된 댓글 원문');
  });

  it('cancels submission when the operator declines the irreversible comment hide', () => {
    const confirm = vi.fn(() => false);
    const preventDefault = vi.fn();
    vi.stubGlobal('window', { confirm });

    confirmCommunityCommentHide({ preventDefault } as unknown as Parameters<typeof confirmCommunityCommentHide>[0]);

    expect(confirm).toHaveBeenCalledWith(
      '이 댓글을 숨기고 연결된 신고를 해결합니다. 현재 화면에서는 되돌릴 수 없습니다. 계속할까요?',
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(actions.hideComment).not.toHaveBeenCalled();
  });

  it('allows submission when the operator confirms the comment hide', () => {
    const preventDefault = vi.fn();
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });

    confirmCommunityCommentHide({ preventDefault } as unknown as Parameters<typeof confirmCommunityCommentHide>[0]);

    expect(preventDefault).not.toHaveBeenCalled();
  });
});
