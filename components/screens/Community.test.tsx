import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CommunityFeedPost, CommunitySnapshot, CommunityViewerState } from '@/lib/community';
import { Community } from './Community';

vi.mock('@/app/community/actions', () => ({
  blockCommunityUserAction: vi.fn(),
  createCommunityCommentAction: vi.fn(),
  createCommunityPostAction: vi.fn(),
  deleteCommunityCommentAction: vi.fn(),
  deleteCommunityPostAction: vi.fn(),
  reportCommunityTargetAction: vi.fn(),
  setCommunityPostLikeAction: vi.fn(),
}));
vi.mock('@/lib/routes', async () => await import('../../lib/routes'));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => <span aria-hidden /> }));
vi.mock('@/components/ui/Empty', () => ({
  Empty: ({ text, sub }: { text: string; sub?: string }) => <div>{text}{sub}</div>,
}));

const snapshot: CommunitySnapshot = {
  source: 'supabase',
  channels: [{ id: 'hwasan', title: '화산강림', sub: '리디 · 로판', color: '#8B5CFF' }],
  goods: [],
  posts: [],
  trending: [],
};

function render(trending: string[], posts: CommunityFeedPost[] = []) {
  return renderToStaticMarkup(
    <Community feedScope="all" snapshot={{ ...snapshot, posts, trending }} viewerState="guest" />,
  );
}

function renderFandom({
  channels = snapshot.channels,
  initialChannelId,
  posts = [],
  viewerState,
}: {
  channels?: CommunitySnapshot['channels'];
  initialChannelId?: string;
  posts?: CommunityFeedPost[];
  viewerState: CommunityViewerState;
}) {
  return renderToStaticMarkup(
    <Community
      feedScope="fandom"
      initialChannelId={initialChannelId}
      snapshot={{ ...snapshot, channels, posts }}
      viewerState={viewerState}
    />,
  );
}

describe('Community trending tags', () => {
  it('renders recent tags as encoded links to public search', () => {
    const html = render(['메이플스토리', '%', '_', '태그 & 특수']);

    expect(html).toContain('최근 7일 트렌딩');
    expect(html).toContain('>#메이플스토리</a>');
    expect(html).toContain('href="/search?q=%EB%A9%94%EC%9D%B4%ED%94%8C%EC%8A%A4%ED%86%A0%EB%A6%AC"');
    expect(html).toContain('href="/search?q=%25"');
    expect(html).toContain('href="/search?q=_"');
    expect(html).toContain('href="/search?q=%ED%83%9C%EA%B7%B8%20%26%20%ED%8A%B9%EC%88%98"');
  });

  it('does not duplicate the display hash for mock tags', () => {
    const html = render(['#리락쿠마']);

    expect(html).toContain('>#리락쿠마</a>');
    expect(html).toContain('href="/search?q=%EB%A6%AC%EB%9D%BD%EC%BF%A0%EB%A7%88"');
    expect(html).not.toContain('##리락쿠마');
    expect(html).not.toContain('q=%23');
  });

  it('contains an unbounded user tag inside the responsive chip row', () => {
    const html = render(['긴태그'.repeat(100)]);

    expect(html).toContain('box-sizing:border-box');
    expect(html).toContain('max-width:100%');
    expect(html).toContain('height:44px');
    expect(html).toContain('min-width:0');
    expect(html).toContain('overflow:hidden');
    expect(html).toContain('text-overflow:ellipsis');
  });

  it('shows an honest aggregate empty state', () => {
    const html = render([]);

    expect(html).toContain('최근 7일 트렌딩');
    expect(html).toContain('최근 7일 동안 집계된 태그가 없어요');
    expect(html).not.toContain('href="/search?q=');
  });
});

describe('Community fandom feed', () => {
  it('renders URL-backed all and fandom tabs with 44px targets', () => {
    const html = render([]);

    expect(html).toContain('href="/community"');
    expect(html).toContain('href="/community?feed=fandom"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('height:44px');
  });

  it('guides guests to login while preserving the fandom URL', () => {
    const html = renderFandom({ viewerState: 'guest' });

    expect(html).toContain('내 팬덤 피드는 로그인 후 볼 수 있어요');
    expect(html).toContain('href="/login?next=%2Fcommunity%3Ffeed%3Dfandom"');
    expect(html).not.toContain('name="text"');
  });

  it('guides incomplete users to onboarding while preserving the fandom URL', () => {
    const html = renderFandom({ viewerState: 'onboarding' });

    expect(html).toContain('관심 IP를 고르면 내 팬덤 피드가 열려요');
    expect(html).toContain('href="/onboarding?next=%2Fcommunity%3Ffeed%3Dfandom"');
    expect(html).not.toContain('name="text"');
  });

  it('guides onboarded users without follows to the IP hub', () => {
    const html = renderFandom({ channels: [], viewerState: 'onboarded' });

    expect(html).toContain('팔로우한 IP가 아직 없어요');
    expect(html).toContain('href="/ip"');
    expect(html).not.toContain('name="text"');
  });

  it('keeps the followed-IP composer and offers the all feed when fandom posts are empty', () => {
    const html = renderFandom({ viewerState: 'onboarded' });

    expect(html).toContain('내 팬덤의 첫 이야기를 남겨보세요');
    expect(html).toContain('href="/community"');
    expect(html).toContain('<option value="hwasan" selected="">화산강림</option>');
    expect(html).toContain('name="next" value="/community?feed=fandom"');
  });

  it('preserves the fandom URL across every post interaction', () => {
    const post: CommunityFeedPost = {
      id: '11111111-1111-4111-8111-111111111111',
      authorId: '22222222-2222-4222-8222-222222222222',
      user: 'lumenfan',
      ipId: 'hwasan',
      ipName: '화산강림',
      avatar: '#8B5CFF',
      text: '팬덤 포스트',
      likes: 2,
      comments: 1,
      time: '방금 전',
      tag: '후기',
      likedByViewer: false,
      canDelete: false,
      commentItems: [{
        id: '33333333-3333-4333-8333-333333333333',
        authorId: '44444444-4444-4444-8444-444444444444',
        user: 'commenter',
        text: '좋아요',
        time: '방금 전',
        canDelete: false,
      }],
    };

    const html = renderFandom({ posts: [post], viewerState: 'onboarded' });
    const fandomNextFields = html.match(/name="next" value="\/community\?feed=fandom"/g) ?? [];

    expect(html).toContain('팬덤 포스트');
    expect(fandomNextFields).toHaveLength(9);
    expect(html).not.toContain('name="next" value="/community"');
    expect(html).not.toContain('팬덤 랭킹');
    expect(render([], [post])).toContain('팬덤 랭킹');
  });

  it('falls back to the fandom-wide channel when a previous all-feed channel is not followed', () => {
    const post: CommunityFeedPost = {
      id: '11111111-1111-4111-8111-111111111111',
      authorId: '22222222-2222-4222-8222-222222222222',
      user: 'hwasanfan',
      ipId: 'hwasan',
      ipName: '화산강림',
      avatar: '#8B5CFF',
      text: '팔로우 팬덤 포스트',
      likes: 1,
      comments: 0,
      time: '방금 전',
      tag: '후기',
      likedByViewer: false,
      canDelete: false,
      commentItems: [],
    };

    const html = renderFandom({
      initialChannelId: 'not-followed',
      posts: [post],
      viewerState: 'onboarded',
    });

    expect(html).toContain('팔로우 팬덤 포스트');
    expect(html).not.toContain('내 팬덤의 첫 이야기를 남겨보세요');
  });
});
