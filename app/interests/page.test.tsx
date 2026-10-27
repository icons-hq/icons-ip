import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListingWishlist } from '@/lib/listing-wishlist';

const mocks = vi.hoisted(() => ({
  config: vi.fn(async () => ({ interests: true, shippingSavings: false })),
  wishlist: vi.fn<() => Promise<ListingWishlist | null>>(async () => null),
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/lib/product-detail-experiences.server', () => ({ loadPublicDetailExperienceConfig: mocks.config }));
vi.mock('@/lib/wishlist-ids.server', () => ({ loadListingWishlist: mocks.wishlist }));
vi.mock('@/components/screens/ProductInterests', () => ({ ProductInterests: mocks.screen }));

import InterestsPage from './page';

beforeEach(() => {
  mocks.config.mockReset().mockResolvedValue({ interests: true, shippingSavings: false });
  mocks.wishlist.mockReset().mockResolvedValue(null);
  mocks.screen.mockClear();
});

describe('/interests', () => {
  /* L4b · CL-01 — 관심 굿즈 카드의 목록 하트 초기 상태를 운영 스위치와 나란히 한 번 읽어 넘긴다. */
  it('회원의 위시 ID 를 한 번 읽어 관심 굿즈 화면에 넘긴다', async () => {
    const wishlist: ListingWishlist = { viewerId: 'viewer-1', goodIds: ['g2'] };
    mocks.wishlist.mockResolvedValue(wishlist);

    renderToStaticMarkup(await InterestsPage());

    expect(mocks.wishlist).toHaveBeenCalledOnce();
    expect(mocks.screen.mock.calls[0]?.[0]).toEqual({ wishlist });
  });

  it('관심 모아보기 스위치가 꺼져 있으면 404 다', async () => {
    mocks.config.mockResolvedValue({ interests: false, shippingSavings: false });

    await expect(InterestsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.screen).not.toHaveBeenCalled();
  });
});
