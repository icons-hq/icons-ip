import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getShellNotices } from './notice-strip.server';

const IMAGE = 'public-media/catalog/curation/11111111-1111-4111-8111-111111111111.webp';
const MOBILE = 'public-media/catalog/curation/22222222-2222-4222-8222-222222222222.webp';

type Row = { id: string; kind: string; title: string; image_path: string | null; link_path: string | null; payload: Record<string, unknown> | null };

const mocks = vi.hoisted(() => ({
  published: true,
  rows: [] as Row[],
  error: null as { message: string } | null,
  calls: [] as Array<[string, ...unknown[]]>,
  createServerClient: vi.fn(),
  cookieClient: vi.fn(() => { throw new Error('shell notices must not read cookies'); }),
  cache: vi.fn((fn: unknown) => fn),
}));
vi.mock('next/cache', () => ({ unstable_cache: mocks.cache }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.cookieClient }));
vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true, url: 'https://preview.example.test', key: 'test-public-key' }) }));

beforeEach(() => {
  mocks.published = true;
  mocks.error = null;
  mocks.calls = [];
  mocks.rows = [];
  mocks.cookieClient.mockClear();
  mocks.createServerClient.mockReset().mockImplementation(() => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: (columns: string) => { mocks.calls.push(['select', table, columns]); return query; },
        in: (column: string, values: unknown) => { mocks.calls.push(['in', column, values]); return query; },
        eq: (column: string, value: unknown) => { filters[column] = value; mocks.calls.push(['eq', column, value]); return query; },
        lte: () => query, or: () => query,
        order: (column: string) => { mocks.calls.push(['order', column]); return query; },
        then: (resolve: (value: unknown) => unknown) => resolve({ error: mocks.error, data: mocks.error ? null : mocks.rows }),
        maybeSingle: async () => ({ error: null, data: table === 'ip_public_slug_aliases'
          ? { slug: 'old-ip', ip_id: 'internal-ip' }
          : filters.id === 'internal-ip' || filters.public_slug === 'current-ip'
            ? { id: 'internal-ip', public_slug: 'current-ip', archived_at: null, published_at: mocks.published ? '2026-09-01' : null }
            : null }),
      };
      return query;
    },
    storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example.test/${path}` } }) }) },
  }));
});

const bar = (id: string, patch: Partial<Row> = {}): Row => ({
  id, kind: 'notice_bar', title: '이용약관 개정 안내', image_path: null, link_path: '/legal/terms',
  payload: { page_types: ['home', 'product'], cta_label: '자세히 보기' }, ...patch,
});
const strip = (id: string, patch: Partial<Row> = {}): Row => ({
  id, kind: 'notice_strip', title: '키링 기획전', image_path: IMAGE, link_path: '/events', payload: null, ...patch,
});

describe('셸 공지 캐시 읽기', () => {
  it('쿠키 없이 공지 바·스트립 전체를 운영 순서대로 읽고, 캐시 키를 이전 단일 스트립과 분리한다', async () => {
    mocks.rows = [bar('b1'), strip('s1'), strip('s2', { payload: { page_types: ['home'], mobile_image_path: MOBILE } })];
    const notices = await getShellNotices();
    expect(mocks.cookieClient).not.toHaveBeenCalled();
    expect(mocks.cache).toHaveBeenCalledWith(expect.any(Function), ['shell-notices'], { revalidate: 300, tags: ['home-curations'] });
    expect(mocks.calls).toEqual(expect.arrayContaining([
      ['in', 'kind', ['notice_bar', 'notice_strip']], ['eq', 'enabled', true],
      ['order', 'display_order'], ['order', 'active_from'], ['order', 'id'],
    ]));
    expect(notices.bars).toEqual([{
      id: 'b1', key: expect.stringMatching(/^b1:[0-9a-f]{12}$/), message: '이용약관 개정 안내',
      cta: { label: '자세히 보기', href: '/legal/terms' }, pageTypes: ['home', 'product'],
    }]);
    expect(notices.strips).toEqual([
      { id: 's1', title: '키링 기획전', imageUrl: `https://cdn.example.test/${IMAGE.replace('public-media/', '')}`, mobileImageUrl: null, href: '/events', pageTypes: null },
      expect.objectContaining({ id: 's2', mobileImageUrl: `https://cdn.example.test/${MOBILE.replace('public-media/', '')}`, pageTypes: ['home'] }),
    ]);
  });

  it('문구·버튼·대상을 바꾸면 닫힘 키가 바뀌고, 순서·기간만 바뀌면 그대로다', async () => {
    mocks.rows = [bar('b1')];
    const first = (await getShellNotices()).bars[0].key;
    mocks.rows = [bar('b1', { title: '이용약관 개정 사전 안내' })];
    expect((await getShellNotices()).bars[0].key).not.toBe(first);
    mocks.rows = [bar('b1', { payload: { page_types: ['home'], cta_label: '자세히 보기' } })];
    expect((await getShellNotices()).bars[0].key).not.toBe(first);
    mocks.rows = [bar('b1')];
    expect((await getShellNotices()).bars[0].key).toBe(first);
  });

  it('버튼 없는 공지 바를 받고, 계약을 어긴 행은 그리지 않는다', async () => {
    mocks.rows = [
      bar('copy', { link_path: null, payload: { page_types: ['home'] } }),
      bar('no-label', { payload: { page_types: ['home'] } }),
      bar('label-only', { link_path: null }),
      bar('no-targets', { payload: { cta_label: '보기' } }),
      bar('bad-target', { payload: { page_types: ['checkout'], cta_label: '보기' } }),
      bar('long', { title: '가'.repeat(61) }),
      bar('control', { title: '배송\n공지' }),
      bar('unsafe', { link_path: '//outside' }),
      bar('with-image', { image_path: IMAGE }),
      strip('strip-bad-target', { payload: { page_types: [] } }),
      strip('strip-no-image', { image_path: null }),
    ];
    const notices = await getShellNotices();
    expect(notices.bars.map((item) => [item.id, item.cta])).toEqual([['copy', null]]);
    expect(notices.strips).toEqual([]);
  });

  it.each(['/ip/old-ip?tab=goods#detail', '/ip?ip=internal-ip&tab=goods#detail'])(
    '공지 바 버튼·스트립의 IP 링크를 현재 공개 주소로 바꾼다: %s', async (href) => {
      mocks.rows = [bar('b1', { link_path: href }), strip('s1', { link_path: href })];
      const notices = await getShellNotices();
      expect(notices.bars[0].cta?.href).toBe('/ip/current-ip?tab=goods#detail');
      expect(notices.strips[0].href).toBe('/ip/current-ip?tab=goods#detail');
    },
  );

  it('비공개 대상은 바꾸지 않고, 읽기 실패는 공지 없음으로 수렴한다', async () => {
    mocks.published = false;
    mocks.rows = [bar('b1', { link_path: '/ip/old-ip' }), strip('s1', { link_path: '/ip/old-ip' })];
    const notices = await getShellNotices();
    expect(notices.bars[0].cta?.href).toBe('/ip/old-ip');
    expect(notices.strips[0].href).toBe('/ip/old-ip');
    mocks.error = { message: 'offline' };
    expect(await getShellNotices()).toEqual({ bars: [], strips: [] });
    expect(mocks.cookieClient).not.toHaveBeenCalled();
  });

  /* 예약 팝업 주소는 IP 별칭 해석을 타지 않는다. 대역은 어떤 슬러그든 공개 IP로 풀어 주므로(published), 예약 검사가
     빠지면 이 주소가 '/ip/current-ip'로 바뀌어 실패한다. */
  it.each(['/ip/aouad', '/ip/aouad?tab=goods#detail', '/ip?ip=aouad'])(
    '공지 바 버튼·스트립의 예약 팝업 주소는 그대로 둔다: %s', async (href) => {
      mocks.rows = [bar('b1', { link_path: href }), strip('s1', { link_path: href })];
      const notices = await getShellNotices();
      expect(notices.bars[0].cta?.href).toBe(href);
      expect(notices.strips[0].href).toBe(href);
    },
  );
});
