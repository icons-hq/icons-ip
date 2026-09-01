import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import Page from './page';

const mocks = vi.hoisted(() => ({
  catalog: null as unknown as CatalogSnapshot,
  directory: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  redirect: vi.fn<(path: string) => never>((path) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/components/screens/IpDirectory', () => ({ IpDirectory: mocks.directory }));
vi.mock('@/lib/catalog', () => ({ getCatalogSnapshot: () => mocks.catalog }));

const ip = {
  id: 'ip-1',
  title: '화산강림',
  sub: 'ORIGINAL IP',
  v: { key: 'webtoon', label: '웹툰', color: '#38F0C0' },
  glyph: '火',
  tagline: '불꽃처럼 피어나는 이야기',
  synopsis: '화산강림 세계관',
  bg: 'linear-gradient(#111, #222)',
  fans: 100,
  goods: 0,
  cards: 0,
  featured: true,
};

beforeEach(() => {
  mocks.catalog = { source: 'mock', verticals: [], ips: [ip], goods: [], cards: [], events: [] };
  mocks.directory.mockClear();
  mocks.redirect.mockClear();
});

describe('/ip page', () => {
  it('renders the directory with the full catalog ip list', async () => {
    renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.directory.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ ips: [ip] }));
  });

  it('redirects the legacy ?ip= query to the hall route for a valid id', async () => {
    await expect(Page({ searchParams: Promise.resolve({ ip: 'ip-1' }) }))
      .rejects.toThrow('redirect:/ip/ip-1');

    expect(mocks.redirect).toHaveBeenCalledWith('/ip/ip-1');
    expect(mocks.directory).not.toHaveBeenCalled();
  });

  it('renders the directory instead of redirecting for an unknown ?ip=', async () => {
    renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ ip: 'no-such-ip' }) }));

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.directory).toHaveBeenCalledTimes(1);
  });

  it('still renders the directory for an empty catalog — the empty state lives in the screen', async () => {
    mocks.catalog = { ...mocks.catalog, ips: [] };

    renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(mocks.directory.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ ips: [] }));
  });
});
