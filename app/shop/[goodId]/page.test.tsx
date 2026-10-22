import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogGoodDetail } from '@/lib/catalog';
import type { GoodsSizeChart } from '@/lib/goods-size-chart';
import type { PublicGoodOtherCompositions } from '@/lib/good-other-compositions';
import Page, { generateMetadata } from './page';

const summary = { average: 4.5, count: 3, distribution: [0, 0, 0, 1, 2], photoCount: 1 };

const mocks = vi.hoisted(() => ({
  details: [] as CatalogGoodDetail[],
  shipping: vi.fn(async () => ({originId:'gimpo',originName:'김포',baseFee:4700,freeThreshold:62000,feeType:'policy',individualFee:0})),
  businessInfo: vi.fn(async () => ({ companyName: '(주)아이콘스', representative: '', registrationNumber: '109-86-27576', mailOrderNumber: '', address: '', phone: '', email: '', hostingProvider: 'Vercel, Inc.' })),
  engagement: vi.fn(async () => ({ restockRequested: false, wished: true })),
  goodDetail: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  goodQna: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  goodReviews: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  sizeChart: vi.fn<(goodId: string) => Promise<GoodsSizeChart | null>>(async () => null),
  otherCompositions: vi.fn<(goodId: string) => Promise<PublicGoodOtherCompositions>>(async () => ({ groups: [], nextChangeAt: null })),
  refresh: vi.fn<(props: { nextChangeAt: string | null }) => null>(() => null),
  questionSection: vi.fn(async () => ({
    questions: [],
    count: 4,
    page: 1,
    pageCount: 1,
  })),
  reviewSection: vi.fn(async () => ({
    unavailable: false,
    reviews: [],
    summary: { average: 4.5, count: 3, distribution: [0, 0, 0, 1, 2], photoCount: 1 },
  })),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/components/screens/GoodDetail', () => ({ GoodDetail: mocks.goodDetail }));
vi.mock('@/components/shop/GoodQna', () => ({ GoodQna: mocks.goodQna }));
vi.mock('@/components/shop/GoodReviews', () => ({ GoodReviews: mocks.goodReviews }));
vi.mock('@/lib/product-questions.server', () => ({ loadGoodQuestions: mocks.questionSection }));
vi.mock('@/lib/reviews.server', () => ({ loadGoodReviewSection: mocks.reviewSection }));
vi.mock('@/lib/wishlist.server', () => ({ getGoodEngagement: mocks.engagement }));
vi.mock('@/lib/fulfillment.server', () => ({loadGoodShippingPolicy:mocks.shipping}));
vi.mock('@/lib/legal/business-info.server', () => ({ getBusinessInfo: mocks.businessInfo }));
vi.mock('@/lib/product-detail-experiences.server', () => ({ loadPublicDetailExperience: async () => null }));
vi.mock('@/lib/goods-media.server', () => ({ loadPublicGoodMedia: async () => null }));
vi.mock('@/lib/good-announcements.server', () => ({ loadGoodAnnouncements: async () => ({ items: [], nextChangeAt: null }) }));
vi.mock('@/lib/goods-size-chart.server', () => ({ loadPublicGoodsSizeChart: mocks.sizeChart }));
vi.mock('@/lib/good-other-compositions.server', () => ({ loadGoodOtherCompositions: mocks.otherCompositions }));
vi.mock('@/components/shop/ProductDetailRefresh', () => ({ ProductDetailRefresh: mocks.refresh }));
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
  mocks.goodQna.mockClear();
  mocks.goodReviews.mockClear();
  mocks.questionSection.mockClear();
  mocks.reviewSection.mockClear();
  mocks.engagement.mockClear();
  mocks.sizeChart.mockReset().mockResolvedValue(null);
  mocks.otherCompositions.mockReset().mockResolvedValue({ groups: [], nextChangeAt: null });
  mocks.refresh.mockClear();
  mocks.details = [
    detailFor('g13', '아크릴 블록', 12000),
    detailFor('g14', '오로라 아크릴 키링', 9000),
  ];
});

describe('/shop/[goodId] page', () => {
  it('다른 구성을 독립 공개 loader로 읽고 기간·옵션 경계를 기존 갱신기에 전달한다', async () => {
    const other: PublicGoodOtherCompositions = { groups: [{ id: '99000000-0000-4000-8000-000000000301', title: '다른 구성도 살펴보세요', goods: [{
      good: { ...mocks.details[1].good, salePeriod: { startsAt: null, endsAt: null, state: 'open', calculatedAt: '2026-10-15T00:00:00Z', nextChangeAt: '2026-10-15T13:00:00+09:00' } },
      compositionLabel: '다른 색상',
    }] }], nextChangeAt: '2026-10-15T05:00:00Z' };
    mocks.otherCompositions.mockResolvedValue(other);
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) }));
    expect(mocks.otherCompositions).toHaveBeenCalledExactlyOnceWith('g13');
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.otherCompositions).toMatchObject({ props: { data: other } });
    expect(mocks.refresh.mock.calls[0]?.[0]?.nextChangeAt).toBe('2026-10-15T04:00:00.000Z');
  });

  /* 공개 브라우징 — 로그인 상태를 묻지 않고 상세를 넘긴다. */
  it('passes the loaded good detail to the screen', async () => {
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) }));

    expect(mocks.goodDetail.mock.calls[0]?.[0]?.detail).toEqual({ ...mocks.details[0], sizeChart: null });
    expect(mocks.sizeChart).toHaveBeenCalledWith('g13');
    expect(mocks.shipping).toHaveBeenCalledWith('g13');
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.shippingPolicy).toMatchObject({baseFee:4700,freeThreshold:62000});
  });

  /* PD-06 — 추가정보 탭의 판매자 정보는 푸터와 같은 공개 사업자 정보 소스에서 온다. */
  it('추가정보 탭의 판매자 정보로 공개 사업자 정보를 넘긴다', async () => {
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) }));

    expect(mocks.businessInfo).toHaveBeenCalled();
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.sellerInfo).toMatchObject({ companyName: '(주)아이콘스', registrationNumber: '109-86-27576' });
  });

  it('별도 공개 게이트를 통과한 사이즈 안내를 같은 상품 상세에 전달한다', async () => {
    const sizeChart: GoodsSizeChart = { unit: 'cm', sizes: ['M'], measurements: [{ name: '총장', values: ['65'] }], note: '단면 측정' };
    mocks.sizeChart.mockResolvedValue(sizeChart);
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) }));
    expect(mocks.sizeChart).toHaveBeenCalledExactlyOnceWith('g13');
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.detail).toEqual({ ...mocks.details[0], sizeChart });
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

  /* 찜·재입고 신청 여부는 카탈로그·리뷰와 함께 읽어 화면이 하트를 켠 채로 시작한다.
     비로그인·mock 모드에서도 던지지 않으므로 공개 열람을 막지 않는다(#326). */
  it('찜 상태와 리뷰 요약을 화면에 함께 넘긴다', async () => {
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) }));

    expect(mocks.engagement).toHaveBeenCalledWith('g13');
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.engagement).toEqual({ restockRequested: false, wished: true });
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.reviewSummary).toEqual(summary);
  });

  it('리뷰 조회 실패를 상품 상단과 탭의 0건으로 표시하지 않는다', async () => {
    mocks.reviewSection.mockResolvedValueOnce({ unavailable: true, reviews: [], summary: { average: 0, count: 0, distribution: [0, 0, 0, 0, 0], photoCount: 0 } });
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) }));
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.reviewSummary).toBeUndefined();
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.reviews).toBeTruthy();
  });

  /* 상품 Q&A 도 비로그인에게 열린다(#330) — 사기 전에 묻는 글이라 로그인 뒤로 미루면
     물어볼 사람이 아무도 남지 않는다. */
  it('Q&A 블록과 탭 카운트를 로그인 없이 함께 넘긴다', async () => {
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) }));

    expect(mocks.questionSection).toHaveBeenCalledWith('g13', { page: 1 });
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.qna).toBeTruthy();
    expect(mocks.goodDetail.mock.calls[0]?.[0]?.qnaSummary).toEqual({ count: 4 });
  });

  it('URL의 Q&A 페이지를 정규화해 로더에 넘긴다', async () => {
    renderToStaticMarkup(await Page({
      params: Promise.resolve({ goodId: 'g13' }),
      searchParams: Promise.resolve({ qnaPage: '2' }),
    }));
    expect(mocks.questionSection).toHaveBeenCalledWith('g13', { page: 2 });

    renderToStaticMarkup(await Page({
      params: Promise.resolve({ goodId: 'g13' }),
      searchParams: Promise.resolve({ qnaPage: 'last' }),
    }));
    expect(mocks.questionSection).toHaveBeenLastCalledWith('g13', { page: 1 });
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
  /* PD-17 — 공유 미리보기 이미지·가격. 상대 이미지 주소는 사이트 기준 절대 주소로 펼친다. */
  it('Open Graph 제목·이미지·주소를 내고 type·가격은 metadata 에 두지 않는다', async () => {
    vi.stubEnv('SITE_URL', 'https://iconsip.test');
    try {
      mocks.details = [{ ...detailFor('g13', '아크릴 블록', 12000), good: { ...detailFor('g13', '아크릴 블록', 12000).good, img: 'url("/generated/goods/g13.png") center / cover no-repeat' } },
        detailFor('g14', '오로라 아크릴 키링', 9000)];
      const metadata = await generateMetadata({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) });

      expect(metadata.openGraph).toMatchObject({
        siteName: 'ICONS', title: '아크릴 블록', url: 'https://iconsip.test/shop/g13',
        images: [{ url: 'https://iconsip.test/generated/goods/g13.png', alt: '아크릴 블록' }],
      });
      /* og:type=product 와 og:price:* 는 property 속성이어야 수집기가 읽는다 — metadata(other 는 name 속성)로 내지 않는다. */
      expect(metadata.openGraph).not.toHaveProperty('type');
      expect(metadata).not.toHaveProperty('other');
      /* 이미지가 없는 굿즈(gradient 대체 아트)는 og:image 를 내지 않는다. */
      const keyring = await generateMetadata({ params: Promise.resolve({ goodId: 'g14' }), searchParams: Promise.resolve({}) });
      expect(keyring.openGraph).not.toHaveProperty('images');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('공개 상세에 JSON-LD Product·BreadcrumbList 를 싣는다', async () => {
    vi.stubEnv('SITE_URL', 'https://iconsip.test');
    try {
      const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }), searchParams: Promise.resolve({}) }));
      const scripts = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(match => JSON.parse(match[1]));

      expect(scripts).toHaveLength(2);
      expect(scripts[0]).toMatchObject({ '@type': 'Product', name: '아크릴 블록', url: 'https://iconsip.test/shop/g13',
        offers: { '@type': 'Offer', price: 12000, priceCurrency: 'KRW', availability: 'https://schema.org/InStock' } });
      expect(scripts[1]).toMatchObject({ '@type': 'BreadcrumbList' });
      expect(scripts[1].itemListElement).toHaveLength(3);
      /* PD-17 — 상품 Open Graph 는 property 속성이다(레퍼런스와 같은 og:type=product·og:price:*). */
      expect(html).toContain('<meta content="product" property="og:type"/>');
      expect(html).toContain('<meta content="12000" property="og:price:amount"/>');
      expect(html).toContain('<meta content="KRW" property="og:price:currency"/>');
      expect(html).not.toContain('name="og:price');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('없는 굿즈의 제목 생성은 404 로 보낸다', async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ goodId: 'g999' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
