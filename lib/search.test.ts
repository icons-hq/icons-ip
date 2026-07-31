import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSearchSnapshot, normalizeSearchQuery } from './search';

const mocks = vi.hoisted(() => ({
  isConfigured: false,
  rpc: vi.fn(),
}));
const originalVercelEnv = process.env.VERCEL_ENV;
const originalCatalogSource = process.env.ICONS_CATALOG_SOURCE;

vi.mock('@/lib/data', async () => await import('./data'));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.isConfigured }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    rpc: mocks.rpc,
  }),
}));

beforeEach(() => {
  mocks.isConfigured = false;
  mocks.rpc.mockReset();
  if (originalVercelEnv === undefined) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnv;
  }
  if (originalCatalogSource === undefined) {
    delete process.env.ICONS_CATALOG_SOURCE;
  } else {
    process.env.ICONS_CATALOG_SOURCE = originalCatalogSource;
  }
});

describe('normalizeSearchQuery', () => {
  it('trims repeated whitespace and caps long search input', () => {
    expect(normalizeSearchQuery('  리락   쿠마  ')).toBe('리락 쿠마');
    expect(normalizeSearchQuery('x'.repeat(120))).toHaveLength(80);
  });
});

describe('getSearchSnapshot', () => {
  it('uses mock catalog data when Supabase is not configured', async () => {
    const snapshot = await getSearchSnapshot('리락쿠마');

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(snapshot.source).toBe('mock');
    expect(snapshot.query).toBe('리락쿠마');
    expect(snapshot.groups.map((group) => group.kind)).toEqual(['ip', 'good', 'card', 'post']);
    expect(snapshot.displayedTotal).toBe(
      snapshot.groups.reduce((total, group) => total + group.results.length, 0),
    );
    expect(snapshot.groups.find((group) => group.kind === 'ip')?.results).toEqual([
      expect.objectContaining({ id: 'rilakkuma', label: '리락쿠마', ipId: 'rilakkuma' }),
    ]);
    expect(snapshot.groups.find((group) => group.kind === 'post')?.results).toEqual([
      expect.objectContaining({ id: 'p1', label: expect.stringContaining('낮잠 쿠션') }),
    ]);
  });

  it('uses mock catalog data on Vercel Preview even when Supabase is configured', async () => {
    mocks.isConfigured = true;
    process.env.VERCEL_ENV = 'preview';

    const snapshot = await getSearchSnapshot('메이플');

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(snapshot.source).toBe('mock');
    expect(snapshot.groups.find((group) => group.kind === 'ip')?.results).toEqual([
      expect.objectContaining({ id: 'maplestory', label: '메이플스토리' }),
    ]);
  });

  it('maps Supabase RPC results into ordered public result groups', async () => {
    mocks.isConfigured = true;
    mocks.rpc.mockResolvedValue({
      data: [
        {
          kind: 'good',
          id: 'g2',
          label: '리락쿠마 낮잠 쿠션',
          subtitle: '리락쿠마 · 쿠션',
          ip_id: 'rilakkuma',
          ip_title: '리락쿠마',
          image_path: null,
          bg: 'good-bg',
          accent: '#FFD84D',
          score: 0.9,
        },
        {
          kind: 'ip',
          id: 'rilakkuma',
          label: '리락쿠마',
          subtitle: '캐릭터 IP · San-X · 캐릭터 IP',
          ip_id: 'rilakkuma',
          ip_title: '리락쿠마',
          image_path: null,
          bg: 'ip-bg',
          accent: '#FFD84D',
          score: 1,
        },
        {
          kind: 'card',
          id: 'c2',
          label: '리락쿠마 · 낮잠 시간',
          subtitle: '리락쿠마 · HOLO',
          ip_id: 'rilakkuma',
          ip_title: '리락쿠마',
          image_path: null,
          bg: 'card-bg',
          accent: '#FFD84D',
          score: 0.8,
        },
        {
          kind: 'post',
          id: '00000000-0000-4000-8000-000000000015',
          label: '리락쿠마 팝업 후기',
          subtitle: '리락쿠마 · #후기',
          ip_id: 'rilakkuma',
          ip_title: '리락쿠마',
          image_path: null,
          bg: null,
          accent: '#FFD84D',
          score: 0.7,
        },
        {
          kind: 'tag',
          id: '후기',
          label: '#후기',
          subtitle: '커뮤니티 태그',
          ip_id: null,
          ip_title: null,
          image_path: null,
          bg: null,
          accent: '#8B5CFF',
          score: 0.6,
        },
        {
          kind: 'unknown',
          id: 'ignored',
          label: 'ignored',
          subtitle: null,
          ip_id: null,
          ip_title: null,
          image_path: null,
          bg: null,
          accent: null,
          score: 0,
        },
      ],
      error: null,
    });

    const snapshot = await getSearchSnapshot('  리락  ');

    expect(mocks.rpc).toHaveBeenCalledWith('search_public_content', {
      search_query: '리락',
      per_group_limit: 6,
    });
    expect(snapshot).toEqual({
      source: 'supabase',
      query: '리락',
      displayedTotal: 5,
      groups: [
        expect.objectContaining({ kind: 'ip', label: 'IP', results: [expect.objectContaining({ id: 'rilakkuma' })] }),
        expect.objectContaining({ kind: 'good', label: '굿즈', results: [expect.objectContaining({ id: 'g2' })] }),
        expect.objectContaining({ kind: 'card', label: '카드', results: [expect.objectContaining({ id: 'c2' })] }),
        expect.objectContaining({ kind: 'post', label: '포스트', results: [expect.objectContaining({ id: '00000000-0000-4000-8000-000000000015' })] }),
        expect.objectContaining({ kind: 'tag', label: '태그', results: [expect.objectContaining({ id: '후기' })] }),
      ],
    });
  });
});
