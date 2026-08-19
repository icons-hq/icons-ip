import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogGoodDetail } from '@/lib/catalog';
import Page, { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({
  details: [] as CatalogGoodDetail[],
  goodDetail: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  goodReviews: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  reviewSection: vi.fn(async () => ({ reviews: [] })),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('@/components/screens/GoodDetail', () => ({ GoodDetail: mocks.goodDetail }));
vi.mock('@/components/shop/GoodReviews', () => ({ GoodReviews: mocks.goodReviews }));
vi.mock('@/lib/reviews.server', () => ({ loadGoodReviewSection: mocks.reviewSection }));
vi.mock('@/lib/catalog', () => ({
  getCatalogGoodDetail: async (id: string) => mocks.details.find((item) => item.good.id === id) ?? null,
}));

function detailFor(id: string, name: string, price: number): CatalogGoodDetail {
  return {
    source: 'supabase',
    good: {
      id,
      name,
      ip: 'hong-sil-quest',
      type: name,
      price,
      badge: '신상',
      stock: 'ok',
      stockQty: 8,
      img: 'linear-gradient(#111, #222)',
    },
    ip: null,
    description: null,
    gallery: [],
    detailImageUrl: null,
    notice: {
      maker: null,
      origin: null,
      material: null,
      size: null,
      madeOn: null,
      asManager: null,
      asContact: null,
    },
  };
}

beforeEach(() => {
  mocks.goodDetail.mockClear();
  mocks.goodReviews.mockClear();
  mocks.reviewSection.mockClear();
  mocks.details = [
    detailFor('g13', '아크릴 블록', 12000),
    detailFor('g14', '오로라 아크릴 키링', 9000),
  ];
});

describe('/shop/[goodId] page', () => {
  /* 공개 브라우징 — 로그인 상태를 묻지 않고 상세를 넘긴다. */
  it('passes the loaded good detail to the screen', async () => {
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) }));

    expect(mocks.goodDetail.mock.calls[0]?.[0]?.detail).toEqual(mocks.details[0]);
  });

  /* 리뷰도 비로그인에게 열린다(#254). 살지 말지를 정하는 사람은 아직 로그인하지 않았다. */
  it('리뷰 블록을 로그인 없이 함께 넘긴다', async () => {
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) }));

    expect(mocks.reviewSection).toHaveBeenCalledWith('g13', {
      page: 1,
      photoOnly: false,
      sort: 'recent',
    });
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.reviews).toBeTruthy();
  });

  /* 정렬·사진 필터·페이지는 URL에서 온다. 모르는 값은 기본값으로 접는다. */
  it('URL의 리뷰 조건을 정규화해 로더에 넘긴다', async () => {
    renderToStaticMarkup(await Page({
      params: Promise.resolve({ goodId: 'g13' }),
      searchParams: Promise.resolve({ reviewSort: 'stars', reviewPhoto: '1', reviewPage: '3' }),
    }));

    expect(mocks.reviewSection).toHaveBeenCalledWith('g13', {
      page: 3,
      photoOnly: true,
      sort: 'recent',
    });
  });

  it('404s for an unknown good id', async () => {
    await expect(Page({ params: Promise.resolve({ goodId: 'g999' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.goodDetail).not.toHaveBeenCalled();
  });

  /* 굿즈마다 다른 제목이어야 탭·북마크·스크린리더가 상세를 구별한다(WCAG 2.4.2). */
  it('굿즈마다 다른 페이지 제목을 낸다', async () => {
    const block = await generateMetadata({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) });
    const keyring = await generateMetadata({ params: Promise.resolve({ goodId: 'g14' }), searchParams: Promise.resolve({}) });

    expect(block.title).toBe('아크릴 블록 — ICONS');
    expect(keyring.title).toBe('오로라 아크릴 키링 — ICONS');
    expect(block.description).toContain('아크릴 블록');
  });

  /*
   * 없는 굿즈는 제목 생성 단계에서 바로 404 로 보낸다. 폴백 제목을 돌려주면
   * not-found 바운더리가 그 제목을 버리므로 브라우저에 절대 도달하지 않는
   * 죽은 분기가 되고, 테스트만 통과해 404 탭 제목을 오해하게 만든다.
   */
  it('없는 굿즈의 제목 생성은 404 로 보낸다', async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ goodId: 'g999' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
