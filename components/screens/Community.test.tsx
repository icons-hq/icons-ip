import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CommunitySnapshot } from '@/lib/community';
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

function render(trending: string[]) {
  return renderToStaticMarkup(<Community snapshot={{ ...snapshot, trending }} />);
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
