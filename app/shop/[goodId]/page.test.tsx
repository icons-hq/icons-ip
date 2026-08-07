import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogGoodDetail } from '@/lib/catalog';
import Page from './page';

const mocks = vi.hoisted(() => ({
  detail: null as CatalogGoodDetail | null,
  goodDetail: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('@/components/screens/GoodDetail', () => ({ GoodDetail: mocks.goodDetail }));
vi.mock('@/lib/catalog', () => ({ getCatalogGoodDetail: (id: string) => mocks.detail?.good.id === id ? mocks.detail : null }));

beforeEach(() => {
  mocks.goodDetail.mockClear();
  mocks.detail = {
    source: 'supabase',
    good: {
      id: 'g13',
      name: '아크릴 블록',
      ip: 'hong-sil-quest',
      type: '아크릴 블록',
      price: 12000,
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
});

describe('/shop/[goodId] page', () => {
  /* 공개 브라우징 — 로그인 상태를 묻지 않고 상세를 넘긴다. */
  it('passes the loaded good detail to the screen', async () => {
    renderToStaticMarkup(await Page({ params: Promise.resolve({ goodId: 'g13' }) }));

    expect(mocks.goodDetail.mock.calls[0]?.[0]).toEqual({ detail: mocks.detail });
  });

  it('404s for an unknown good id', async () => {
    await expect(Page({ params: Promise.resolve({ goodId: 'g999' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.goodDetail).not.toHaveBeenCalled();
  });
});
