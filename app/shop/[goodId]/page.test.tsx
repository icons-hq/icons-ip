import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogGoodDetail } from '@/lib/catalog';
import Page, { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({
  details: [] as CatalogGoodDetail[],
  goodDetail: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  goodDetailPrototype: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('@/components/screens/GoodDetail', () => ({ GoodDetail: mocks.goodDetail }));
vi.mock('@/components/prototype/line-friends/LineFriendsGoodDetailPrototype', () => ({
  LineFriendsGoodDetailPrototype: mocks.goodDetailPrototype,
}));
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
  delete process.env.ICONS_PROTOTYPE;
  delete process.env.VERCEL_ENV;
  mocks.goodDetail.mockClear();
  mocks.goodDetailPrototype.mockClear();
  mocks.details = [
    detailFor('g13', '아크릴 블록', 12000),
    detailFor('g14', '오로라 아크릴 키링', 9000),
  ];
});

afterEach(() => {
  delete process.env.ICONS_PROTOTYPE;
  delete process.env.VERCEL_ENV;
});

describe('/shop/[goodId] page', () => {
  /* 공개 브라우징 — 로그인 상태를 묻지 않고 상세를 넘긴다. */
  it('passes the loaded good detail to the screen', async () => {
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }) }));

    expect(mocks.goodDetail.mock.calls[0]?.[0]).toEqual({ detail: mocks.details[0] });
  });

  it('keeps the current detail screen when the prototype flag is not configured', async () => {
    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ goodId: 'g13' }),
        searchParams: Promise.resolve({ variant: 'B' }),
      }),
    );

    expect(mocks.goodDetail.mock.calls[0]?.[0]).toEqual({ detail: mocks.details[0] });
    expect(mocks.goodDetailPrototype).not.toHaveBeenCalled();
    expect(html).not.toContain('/prototype/line-friends/');
  });

  it.each(['A', 'B', 'C'] as const)(
    'renders storefront prototype variant %s when enabled',
    async (variant) => {
      process.env.ICONS_PROTOTYPE = '1';

      const html = renderToStaticMarkup(
        await Page({
          params: Promise.resolve({ goodId: 'g13' }),
          searchParams: Promise.resolve({ variant }),
        }),
      );

      expect(mocks.goodDetail).not.toHaveBeenCalled();
      expect(mocks.goodDetailPrototype.mock.calls[0]?.[0]).toEqual({
        detail: mocks.details[0],
        variant,
      });
      expect(html).toContain('/prototype/line-friends/chrome.css');
      expect(html).toContain('/prototype/line-friends/detail.css');
    },
  );

  it.each([
    ['an invalid variant', { variant: 'unexpected' }],
    ['a missing variant', {}],
  ])('falls back to variant A for %s', async (_case, searchParams) => {
    process.env.ICONS_PROTOTYPE = '1';

    renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ goodId: 'g13' }),
        searchParams: Promise.resolve(searchParams),
      }),
    );

    expect(mocks.goodDetailPrototype.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ variant: 'A' }),
    );
  });

  it('keeps the current detail in Vercel production even when the prototype flag is set', async () => {
    process.env.ICONS_PROTOTYPE = '1';
    process.env.VERCEL_ENV = 'production';

    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ goodId: 'g13' }),
        searchParams: Promise.resolve({ variant: 'C' }),
      }),
    );

    expect(mocks.goodDetail).toHaveBeenCalledOnce();
    expect(mocks.goodDetailPrototype).not.toHaveBeenCalled();
    expect(html).not.toContain('/prototype/line-friends/');
  });

  it('keeps the existing 404 behavior while the prototype is enabled', async () => {
    process.env.ICONS_PROTOTYPE = '1';

    await expect(
      Page({
        params: Promise.resolve({ goodId: 'g999' }),
        searchParams: Promise.resolve({ variant: 'A' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.goodDetailPrototype).not.toHaveBeenCalled();
  });

  it('404s for an unknown good id', async () => {
    await expect(Page({ params: Promise.resolve({ goodId: 'g999' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.goodDetail).not.toHaveBeenCalled();
  });

  /* 굿즈마다 다른 제목이어야 탭·북마크·스크린리더가 상세를 구별한다(WCAG 2.4.2). */
  it('굿즈마다 다른 페이지 제목을 낸다', async () => {
    const block = await generateMetadata({ params: Promise.resolve({ goodId: 'g13' }) });
    const keyring = await generateMetadata({ params: Promise.resolve({ goodId: 'g14' }) });

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
      generateMetadata({ params: Promise.resolve({ goodId: 'g999' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
