import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import type { PublicShoppingStory } from '@/lib/shopping-stories';

const mocks = vi.hoisted(() => ({
  story: vi.fn<(id: string) => Promise<PublicShoppingStory | null>>(async () => null),
  wishlist: vi.fn<() => Promise<ListingWishlist | null>>(async () => null),
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/lib/shopping-stories.server', () => ({ getPublicShoppingStory: mocks.story }));
vi.mock('@/lib/wishlist-ids.server', () => ({ loadListingWishlist: mocks.wishlist }));
vi.mock('@/components/screens/ShoppingStories', () => ({ ShoppingStoryScreen: mocks.screen }));

import ShoppingStoryPage from './page';

const STORY_ID = '11111111-1111-4111-8111-111111111111';
const story: PublicShoppingStory = { id: STORY_ID, reference: 1, title: '가을 스토리', description: '', imageUrl: null, createdAt: '2026-10-13T00:00:00Z',
  startsAt: null, endsAt: null, bodyHtml: '<p>본문</p>', imagePaths: [], sections: [], nextChangeAt: null, goodsUnavailable: false };

beforeEach(() => {
  mocks.story.mockReset().mockResolvedValue(null);
  mocks.wishlist.mockReset().mockResolvedValue(null);
  mocks.screen.mockClear();
});

describe('/stories/[storyId]', () => {
  /* L4b · CL-01 — 상품 카드의 목록 하트 초기 상태를 스토리와 나란히 한 번 읽어 넘긴다. */
  it('회원의 위시 ID 를 한 번 읽어 스토리 화면에 넘긴다', async () => {
    const wishlist: ListingWishlist = { viewerId: 'viewer-1', goodIds: ['s1'] };
    mocks.story.mockResolvedValue(story);
    mocks.wishlist.mockResolvedValue(wishlist);

    renderToStaticMarkup(await ShoppingStoryPage({ params: Promise.resolve({ storyId: STORY_ID }) }));

    expect(mocks.story).toHaveBeenCalledWith(STORY_ID);
    expect(mocks.wishlist).toHaveBeenCalledOnce();
    expect(mocks.screen.mock.calls[0]?.[0]).toEqual({ story, wishlist });
  });

  it('없는 스토리는 404 다', async () => {
    await expect(ShoppingStoryPage({ params: Promise.resolve({ storyId: STORY_ID }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.screen).not.toHaveBeenCalled();
  });
});
