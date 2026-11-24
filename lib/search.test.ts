import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_ENABLED } from './community-visibility';
import { getSearchSnapshot, normalizeSearchQuery } from './search';

const mocks = vi.hoisted(() => ({
  isConfigured: false,
  rpc: vi.fn(),
  identityRead: vi.fn(),
  identities: [] as { id: string; public_slug: string | null }[],
  identityError: null as { message: string } | null,
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
    from: (table: string) => ({ select: (columns: string) => ({ in: (column: string, ids: string[]) => ({ is: (archive: string, value: null) => ({
      not: async (published: string, operator: string, other: null) => {
        mocks.identityRead({ table, columns, column, ids, archive, value, published, operator, other });
        return { data: mocks.identities.filter(ip => ids.includes(ip.id)), error: mocks.identityError };
      },
    }) }) }) }),
  }),
}));

beforeEach(() => {
  mocks.isConfigured = false;
  mocks.rpc.mockReset();
  mocks.identityRead.mockReset();
  mocks.identities = [];
  mocks.identityError = null;
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
  it('loads current public slugs in one batch while keeping catalog visibility filters', async () => {
    mocks.isConfigured = true;
    mocks.identities = [{ id: 'old-ip', public_slug: 'new-ip' }];
    mocks.rpc.mockResolvedValue({ data: [
      { kind: 'ip', id: 'old-ip', label: 'IP', ip_id: 'old-ip' },
      { kind: 'good', id: 'good-1', label: '상품', ip_id: 'old-ip' },
    ], error: null });
    const snapshot = await getSearchSnapshot('IP');
    expect(snapshot.groups.flatMap(group => group.results).map(result => result.ipPublicSlug)).toEqual(['new-ip', 'new-ip']);
    expect(mocks.identityRead).toHaveBeenCalledExactlyOnceWith({ table: 'ips', columns: 'id,public_slug', column: 'id', ids: ['old-ip'],
      archive: 'archived_at', value: null, published: 'published_at', operator: 'is', other: null });
    mocks.identityError = { message: 'identity unavailable' };
    await expect(getSearchSnapshot('IP')).rejects.toThrow('Failed to load search IP identities: identity unavailable');
  });
  it('uses mock catalog data when Supabase is not configured', async () => {
    const snapshot = await getSearchSnapshot('리락쿠마');

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(snapshot.source).toBe('mock');
    expect(snapshot.query).toBe('리락쿠마');
    /* 커뮤니티 임시 비공개 스위치가 포스트·태그 그룹을 함께 걷어낸다(lib/community-visibility.ts). */
    expect(snapshot.groups.map((group) => group.kind)).toEqual(
      COMMUNITY_ENABLED ? ['ip', 'good', 'post'] : ['ip', 'good'],
    );
    expect(snapshot.displayedTotal).toBe(
      snapshot.groups.reduce((total, group) => total + group.results.length, 0),
    );
    expect(snapshot.groups.find((group) => group.kind === 'ip')?.results).toEqual([
      expect.objectContaining({ id: 'rilakkuma', label: '리락쿠마', ipId: 'rilakkuma' }),
    ]);
    expect(snapshot.groups.find((group) => group.kind === 'post')?.results).toEqual(
      COMMUNITY_ENABLED
        ? [expect.objectContaining({ id: 'p1', label: expect.stringContaining('낮잠 쿠션') })]
        : undefined,
    );
  });

  /* 카드 화면(바인더)은 2026-11-24 일반 쇼핑몰 전환으로 지웠다(ADR-0052) — 검색은 카드 결과를 싣지 않는다. */
  it('never returns card results — the card screens were removed', async () => {
    const snapshot = await getSearchSnapshot('리락쿠마');

    expect(snapshot.groups.map((group) => group.kind as string)).not.toContain('card');
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
    const publicGroups = [
      expect.objectContaining({ kind: 'ip', label: 'IP', results: [expect.objectContaining({ id: 'rilakkuma' })] }),
      expect.objectContaining({ kind: 'good', label: '상품', results: [expect.objectContaining({ id: 'g2' })] }),
    ];
    const communityGroups = [
      expect.objectContaining({ kind: 'post', label: '포스트', results: [expect.objectContaining({ id: '00000000-0000-4000-8000-000000000015' })] }),
      expect.objectContaining({ kind: 'tag', label: '태그', results: [expect.objectContaining({ id: '후기' })] }),
    ];

    /* displayedTotal 은 걷어낸 뒤의 수를 센다 — 표시 개수와 어긋나면 안 된다. */
    expect(snapshot).toEqual({
      source: 'supabase',
      query: '리락',
      displayedTotal: COMMUNITY_ENABLED ? 4 : 2,
      groups: COMMUNITY_ENABLED ? [...publicGroups, ...communityGroups] : publicGroups,
    });

    /* 공개 검색 RPC 가 돌려준 카드 행은 결과 종류가 아니라 버린다(ADR-0052). */
    expect(snapshot.groups.map((group) => group.kind as string)).not.toContain('card');
  });
});
