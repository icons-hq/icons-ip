import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogGoodDetail } from '@/lib/catalog';
import Page, { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({
  details: [] as CatalogGoodDetail[],
  goodDetail: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('@/components/screens/GoodDetail', () => ({ GoodDetail: mocks.goodDetail }));
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
  mocks.details = [
    detailFor('g13', '아크릴 블록', 12000),
    detailFor('g14', '오로라 아크릴 키링', 9000),
  ];
});

describe('/shop/[goodId] page', () => {
  /* 공개 브라우징 — 로그인 상태를 묻지 않고 상세를 넘긴다. */
  it('passes the loaded good detail to the screen', async () => {
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }) }));

    expect(mocks.goodDetail.mock.calls[0]?.[0]).toEqual({ detail: mocks.details[0] });
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

  /* 없는 굿즈에서 제목 생성이 깨지면 404 페이지 자체가 500 이 된다. */
  it('없는 굿즈에서도 제목 생성이 깨지지 않는다', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ goodId: 'g999' }) });

    expect(metadata.title).toBe('굿즈를 찾을 수 없습니다 — ICONS');
  });
});
