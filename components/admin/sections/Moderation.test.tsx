import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminReportRecord } from '@/lib/admin/moderation.server';
import { confirmCommunityCommentHide, confirmCommunityPostHide, ModerationSection } from './Moderation';

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
    expect(html).toMatch(/<select[^>]*data-slot="native-select"[^>]*aria-label="댓글 신고 상태"|<select[^>]*aria-label="댓글 신고 상태"[^>]*data-slot="native-select"/);
    /* 처리 버튼·상태 선택은 터치 기기에서 44px(h-11) 높이를 지킨다. */
    expect(html.match(/<button[^>]*type="submit"[^>]*pointer-coarse:h-11/g)).toHaveLength(3);
    expect(html).toContain('[&amp;&gt;select]:pointer-coarse:h-11');
  });

  it('labels an already-hidden comment and disables repeat moderation', () => {
    const html = renderToStaticMarkup(<ModerationSection reports={[commentReport('hidden')]} />);

    expect(html).toContain('숨김 처리됨');
    expect(html).toContain('disabled=""');
    expect(html).toContain('신고된 댓글 원문');
  });

  /* 줄마다 반복되는 숨김은 화면에서 제일 튀지 않게 outline + 빨간 글자로 둔다. 확인 팝업은 그대로다. */
  it('처리할 신고 건수를 위에 보이고 숨김 버튼은 조용한 위험 버튼으로 그린다', () => {
    const resolved = { ...commentReport('visible'), id: '44444444-4444-4444-8444-444444444444', status: 'resolved' as const, targetLabel: '처리 끝난 원문' };
    const html = renderToStaticMarkup(<ModerationSection reports={[resolved, commentReport('visible')]} />);

    expect(html).toContain('최근 신고 2건 기준');
    expect(html).toMatch(/aria-pressed="false"[^>]*>[\s\S]*?접수/);
    expect(html.indexOf('신고된 댓글 원문')).toBeLessThan(html.indexOf('처리 끝난 원문'));
    expect(html).toMatch(/<button(?=[^>]*text-destructive)(?=[^>]*border-border-strong)[^>]*>(?:<svg[\s\S]*?<\/svg>)? 댓글 숨김<\/button>/);
  });

  /* 숨김을 누르면 신고도 함께 끝난다는 것을 그 자리에서 말하고, 사유와 문제의 글에 이름표를 단다. */
  it('숨김과 상태 변경의 관계를 말하고 신고 사유·신고된 글에 이름표를 붙인다', () => {
    const html = renderToStaticMarkup(<ModerationSection reports={[commentReport('visible')]} />);

    expect(html).toContain('숨기면 이 신고는 처리완료로 바뀝니다.');
    expect(html).toContain('숨기지 않고 상태만 변경');
    expect(html).toContain('>신고 사유</dt>');
    expect(html).toContain('>신고된 댓글</dt>');
    /* 댓글 신고의 포스트 숨김은 빨간 테두리 버튼으로 나란히 두지 않는다. */
    const postHide = html.slice(html.lastIndexOf('<button', html.indexOf(' 포스트 숨김')), html.indexOf(' 포스트 숨김'));
    expect(postHide).not.toContain('border-border-strong');
  });

  it('포스트 숨김도 댓글 숨김처럼 확인을 거친다', () => {
    const confirm = vi.fn(() => false);
    const preventDefault = vi.fn();
    vi.stubGlobal('window', { confirm });

    confirmCommunityPostHide({ preventDefault } as unknown as Parameters<typeof confirmCommunityPostHide>[0]);

    expect(confirm).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
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
