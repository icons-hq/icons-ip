import { describe, expect, it, vi } from 'vitest';
import { buildCatalogIpDetail, getCatalogIpDetail, getCatalogSnapshot, getHomeSnapshot, type CatalogPostPreview, type CatalogSnapshot } from './catalog';
import { getHomeSelectableIps } from './home-catalog';
import type { Ip } from './data';

const mocks = vi.hoisted(() => ({
  isConfigured: false,
  client: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data', async () => await import('./data'));
vi.mock('@/lib/community', async () => await import('./community'));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.isConfigured }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mocks.client,
}));

const vertical = { key: 'rofan', label: '로맨스판타지', color: '#8B5CFF' };

const hwasan: Ip = {
  id: 'hwasan',
  title: '화산강림',
  sub: '리디 · 로판',
  v: vertical,
  glyph: '화산',
  bg: 'linear-gradient(#111, #222)',
  fans: 1200,
  goods: 1,
  cards: 1,
  featured: true,
  tagline: '매화는 다시 핀다',
  synopsis: '화산파의 부활',
};

const otherIp: Ip = { ...hwasan, id: 'lumen', title: 'LUMEN' };

const catalog: CatalogSnapshot = {
  source: 'supabase',
  verticals: [vertical],
  ips: [hwasan, otherIp],
  goods: [
    { id: 'g2', ip: 'hwasan', name: '아크릴 스탠드', type: '아크릴', price: 22000, badge: null, stock: 'ok', stockQty: 12, img: 'g2' },
    { id: 'g1', ip: 'lumen', name: '피규어', type: '피규어', price: 89000, badge: null, stock: 'ok', stockQty: 4, img: 'g1' },
  ],
  cards: [
    { id: 'c2', ip: 'hwasan', name: '화산의 검', no: '014/120', rarity: 'SSR', owned: false, bg: 'c2' },
    { id: 'c1', ip: 'lumen', name: 'LUMEN · Dawn', no: '027/200', rarity: 'SR', owned: false, bg: 'c1' },
  ],
  events: [
    { id: 'e2', ip: 'hwasan', title: '매화 특별전', mode: '오프라인', status: '예정', date: '6.02', loc: '강남', accent: '#8B5CFF', img: 'e2' },
    { id: 'e1', ip: null, title: '합동 팝업', mode: '오프라인', status: '진행중', date: '5.10', loc: '성수', accent: '#FF4D9D', img: 'e1' },
  ],
};

const postForIp: CatalogPostPreview = {
  id: 'p1',
  user: 'neonfan',
  ipName: '화산강림',
  avatar: '#8B5CFF',
  text: '매화 특별전 기대 중',
  likes: 2,
  comments: 1,
  time: '방금 전',
  tag: '팝업',
};

type QueryRecord = {
  table: string;
  select?: string;
  selectOptions?: { count?: string; head?: boolean };
  eq: [string, unknown][];
  in: [string, unknown[]][];
  not: [string, string, string][];
  order: [string, { ascending?: boolean } | undefined][];
  limit?: number;
};

type QueryResult<T> = {
  data: T[] | null;
  count?: number | null;
  error: null;
};

type SupabaseRows = Record<
  'verticals' | 'ips' | 'goods' | 'cards' | 'events' | 'posts' | 'public_profiles' | 'likes' | 'comments' | 'blocks',
  Record<string, unknown>[]
>;

function makeResult<T>(data: T[] | null, count?: number | null): QueryResult<T> {
  return { data, count, error: null };
}

function createQuery(
  table: string,
  rows: Record<string, unknown>[],
  records: QueryRecord[],
) {
  const record: QueryRecord = { table, eq: [], in: [], not: [], order: [] };
  records.push(record);

  const query = {
    select(value: string, options?: { count?: string; head?: boolean }) {
      record.select = value;
      record.selectOptions = options;
      return query;
    },
    eq(column: string, value: unknown) {
      record.eq.push([column, value]);
      return query;
    },
    in(column: string, value: unknown[]) {
      record.in.push([column, value]);
      return query;
    },
    not(column: string, operator: string, value: string) {
      record.not.push([column, operator, value]);
      return query;
    },
    order(column: string, options?: { ascending?: boolean }) {
      record.order.push([column, options]);
      return query;
    },
    limit(value: number) {
      record.limit = value;
      return query;
    },
    then<TResult1 = QueryResult<Record<string, unknown>>, TResult2 = never>(
      onfulfilled?: ((value: QueryResult<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      try {
        let data = rows;
        for (const [column, value] of record.eq) {
          data = data.filter((row) => row[column] === value);
        }
        for (const [column, values] of record.in) {
          data = data.filter((row) => values.includes(row[column]));
        }
        for (const [column, operator, value] of record.not) {
          if (operator === 'in') {
            const excluded = value.replace(/^\(|\)$/g, '').split(',').filter(Boolean);
            data = data.filter((row) => !excluded.includes(String(row[column])));
          }
        }
        for (const [column, options] of record.order) {
          data = [...data].sort((a, b) => {
            const left = String(a[column] ?? '');
            const right = String(b[column] ?? '');
            return (options?.ascending === false ? -1 : 1) * left.localeCompare(right);
          });
        }
        if (typeof record.limit === 'number') data = data.slice(0, record.limit);
        return Promise.resolve(
          makeResult(record.selectOptions?.head ? null : data, record.selectOptions?.count ? data.length : undefined),
        ).then(onfulfilled, onrejected);
      } catch (error) {
        return Promise.reject(error).then(onfulfilled, onrejected);
      }
    },
  };

  return query;
}

function defaultSupabaseRows(): SupabaseRows {
  return {
    verticals: [vertical],
    ips: [{
      id: 'hwasan',
      title: '화산강림',
      sub: '리디 · 로판',
      vertical_key: 'rofan',
      tagline: '매화는 다시 핀다',
      synopsis: '화산파의 부활',
      glyph: '화산',
      bg: 'linear-gradient(#111, #222)',
      image_path: null,
      featured: true,
      fans_count: 1200,
      goods_count: 1,
      cards_count: 1,
    }],
    goods: [],
    cards: [],
    events: [],
    posts: [
      { id: 'p1', user_id: 'u1', ip_id: 'hwasan', text: '첫 번째 포스트', tag: '팝업', created_at: '2026-06-22T04:00:00.000Z', image_path: 'u1/private.png', status: 'visible' },
      { id: 'p2', user_id: 'u2', ip_id: 'hwasan', text: '두 번째 포스트', tag: null, created_at: '2026-06-22T03:00:00.000Z', image_path: null, status: 'visible' },
      { id: 'p3', user_id: 'u1', ip_id: 'hwasan', text: '세 번째 포스트', tag: '후기', created_at: '2026-06-22T02:00:00.000Z', image_path: null, status: 'visible' },
      { id: 'p4', user_id: 'u1', ip_id: 'hwasan', text: '네 번째 포스트', tag: '후기', created_at: '2026-06-22T01:00:00.000Z', image_path: null, status: 'visible' },
      { id: 'hidden', user_id: 'u1', ip_id: 'hwasan', text: '숨김 포스트', tag: '숨김', created_at: '2026-06-22T05:00:00.000Z', image_path: null, status: 'hidden' },
      { id: 'other', user_id: 'u1', ip_id: 'lumen', text: '다른 IP', tag: '타IP', created_at: '2026-06-22T06:00:00.000Z', image_path: null, status: 'visible' },
    ],
    public_profiles: [
      { id: 'u1', nickname: 'neonfan' },
      { id: 'u2', nickname: null },
    ],
    likes: [
      ...Array.from({ length: 1005 }, () => ({ post_id: 'p1' })),
      { post_id: 'p2' },
    ],
    comments: [
      { post_id: 'p1', user_id: 'u3', status: 'visible' },
      { post_id: 'p1', user_id: 'u4', status: 'hidden' },
      { post_id: 'hidden', user_id: 'u3', status: 'visible' },
      ...Array.from({ length: 1001 }, () => ({ post_id: 'p3', user_id: 'u3', status: 'visible' })),
    ],
    blocks: [{ user_id: 'viewer-1', blocked_user_id: 'u1' }],
  };
}

function createSupabaseClient(records: QueryRecord[], overrides: Partial<SupabaseRows> = {}) {
  const rows: SupabaseRows = {
    ...defaultSupabaseRows(),
    ...overrides,
  };

  return {
    from(table: keyof SupabaseRows) {
      return createQuery(table, rows[table] as unknown as Record<string, unknown>[], records);
    },
    storage: {
      from() {
        return {
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://cdn.example/${path}` } };
          },
        };
      },
    },
  };
}

describe('buildCatalogIpDetail', () => {
  it('returns the selected IP with only its related catalog and visible post preview data', () => {
    const detail = buildCatalogIpDetail(catalog, 'hwasan', [
      postForIp,
      { ...postForIp, id: 'p2', ipId: 'lumen', ipName: 'LUMEN' },
    ]);

    expect(detail?.ip).toEqual(hwasan);
    expect(detail?.goods.map((good) => good.id)).toEqual(['g2']);
    expect(detail?.cards.map((card) => card.id)).toEqual(['c2']);
    expect(detail?.events.map((event) => event.id)).toEqual(['e2']);
    expect(detail?.posts.map((post) => post.id)).toEqual(['p1']);
    expect(detail?.posts[0]).not.toHaveProperty('img');
  });

  it('returns null when the IP does not exist', () => {
    expect(buildCatalogIpDetail(catalog, 'missing', [])).toBeNull();
  });
});

describe('getCatalogSnapshot', () => {
  it('derives soldout at zero quantity while preserving a positive manual soldout gate', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records, {
      goods: [
        {
          id: 'g1',
          ip_id: 'hwasan',
          name: '아크릴 스탠드',
          type: '아크릴',
          price: 22000,
          badge: null,
          stock: 'low',
          stock_qty: 0,
          bg: 'good-bg',
          image_path: null,
        },
        {
          id: 'g2',
          ip_id: 'hwasan',
          name: '판매 중지 굿즈',
          type: '아크릴',
          price: 12000,
          badge: null,
          stock: 'soldout',
          stock_qty: 7,
          bg: 'good-bg',
          image_path: null,
        },
      ],
    });

    const snapshot = await getCatalogSnapshot();

    expect(snapshot.goods).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'g1', stock: 'soldout', stockQty: 0 }),
      expect.objectContaining({ id: 'g2', stock: 'soldout', stockQty: 7 }),
    ]));
    expect(records.find((record) => record.table === 'goods')?.select).toContain('stock_qty');

    mocks.isConfigured = false;
    mocks.client = null;
  });
});

describe('getCatalogIpDetail', () => {
  it('loads latest visible Supabase post previews without exposing internal filtering fields or upload paths', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records);

    const detail = await getCatalogIpDetail('hwasan');

    expect(detail?.posts).toEqual([
      expect.objectContaining({ id: 'p1', user: 'neonfan', likes: 1005, comments: 1, tag: '팝업' }),
      expect.objectContaining({ id: 'p2', user: 'fan_u2', likes: 1, comments: 0, tag: '커뮤니티' }),
      expect.objectContaining({ id: 'p3', user: 'neonfan', likes: 0, comments: 1001, tag: '후기' }),
    ]);
    expect(detail?.posts).toHaveLength(3);
    expect(detail?.posts).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'hidden' })]));
    expect(detail?.posts).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'other' })]));
    expect(detail?.posts[0]).not.toHaveProperty('ipId');
    expect(detail?.posts[0]).not.toHaveProperty('image_path');
    expect(records.find((record) => record.table === 'posts')).toMatchObject({
      select: 'id,user_id,ip_id,text,tag,created_at,status',
      eq: [['ip_id', 'hwasan'], ['status', 'visible']],
      order: [['created_at', { ascending: false }]],
      limit: 3,
    });
    expect(records.filter((record) => record.table === 'likes')).toEqual([
      expect.objectContaining({
        select: 'post_id',
        selectOptions: { count: 'exact', head: true },
        eq: [['post_id', 'p1']],
      }),
      expect.objectContaining({
        select: 'post_id',
        selectOptions: { count: 'exact', head: true },
        eq: [['post_id', 'p2']],
      }),
      expect.objectContaining({
        select: 'post_id',
        selectOptions: { count: 'exact', head: true },
        eq: [['post_id', 'p3']],
      }),
    ]);
    expect(records.filter((record) => record.table === 'comments')).toEqual([
      expect.objectContaining({
        select: 'post_id',
        selectOptions: { count: 'exact', head: true },
        eq: [['post_id', 'p1'], ['status', 'visible']],
      }),
      expect.objectContaining({
        select: 'post_id',
        selectOptions: { count: 'exact', head: true },
        eq: [['post_id', 'p2'], ['status', 'visible']],
      }),
      expect.objectContaining({
        select: 'post_id',
        selectOptions: { count: 'exact', head: true },
        eq: [['post_id', 'p3'], ['status', 'visible']],
      }),
    ]);

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('keeps hidden post previews visible to their author', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records);

    const detail = await getCatalogIpDetail('hwasan', { viewerId: 'u1' });

    expect(detail?.posts.map((post) => post.id)).toEqual(['hidden', 'p1', 'p2']);
    expect(detail?.posts[0]).toEqual(expect.objectContaining({
      id: 'hidden',
      comments: 1,
      user: 'neonfan',
    }));
    expect(records.find((record) => record.table === 'posts')).toEqual(expect.objectContaining({
      eq: [['ip_id', 'hwasan']],
    }));

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('excludes blocked authors from IP detail community previews', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records);

    const detail = await getCatalogIpDetail('hwasan', { viewerId: 'viewer-1' });

    expect(detail?.posts.map((post) => post.id)).toEqual(['p2']);
    expect(records.filter((record) => record.table === 'blocks')).toEqual([
      expect.objectContaining({
        select: 'blocked_user_id',
        eq: [['user_id', 'viewer-1']],
      }),
    ]);
    expect(records.find((record) => record.table === 'posts')).toEqual(expect.objectContaining({
      not: [['user_id', 'in', '(u1)']],
    }));

    mocks.isConfigured = false;
    mocks.client = null;
  });
});

describe('getHomeSnapshot', () => {
  it('loads first visible post previews for selectable IPs only', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records, {
      ips: [
        {
          id: 'hwasan',
          title: '화산강림',
          sub: '리디 · 로판',
          vertical_key: 'rofan',
          tagline: '매화는 다시 핀다',
          synopsis: '화산파의 부활',
          glyph: '화산',
          bg: 'linear-gradient(#111, #222)',
          image_path: null,
          featured: true,
          fans_count: 1200,
          goods_count: 1,
          cards_count: 1,
        },
        {
          id: 'lumen',
          title: 'LUMEN',
          sub: 'Global Anime',
          vertical_key: 'rofan',
          tagline: 'The light never sleeps',
          synopsis: '글로벌 애니메이션',
          glyph: 'LUMEN',
          bg: 'linear-gradient(#123, #456)',
          image_path: null,
          featured: true,
          fans_count: 900,
          goods_count: 1,
          cards_count: 1,
        },
        {
          id: 'regular',
          title: 'REGULAR',
          sub: 'Not featured',
          vertical_key: 'rofan',
          tagline: '일반 IP',
          synopsis: '선택기에 없는 IP',
          glyph: 'REG',
          bg: 'linear-gradient(#333, #555)',
          image_path: null,
          featured: false,
          fans_count: 5000,
          goods_count: 1,
          cards_count: 1,
        },
      ],
      posts: [
        { id: 'hidden-latest', user_id: 'u1', ip_id: 'hwasan', text: '숨김 최신', tag: '숨김', created_at: '2026-06-22T07:00:00.000Z', status: 'hidden' },
        { id: 'hwasan-latest', user_id: 'u1', ip_id: 'hwasan', text: '화산 최신', tag: '후기', created_at: '2026-06-22T06:00:00.000Z', status: 'visible' },
        { id: 'hwasan-old', user_id: 'u2', ip_id: 'hwasan', text: '화산 예전', tag: '후기', created_at: '2026-06-22T05:00:00.000Z', status: 'visible' },
        { id: 'lumen-latest', user_id: 'u2', ip_id: 'lumen', text: '루멘 최신', tag: '한정굿즈', created_at: '2026-06-22T04:00:00.000Z', status: 'visible' },
        { id: 'regular-latest', user_id: 'u1', ip_id: 'regular', text: '일반 IP', tag: '제외', created_at: '2026-06-22T08:00:00.000Z', status: 'visible' },
      ],
      comments: [
        { post_id: 'hwasan-latest', user_id: 'u3', status: 'visible' },
        { post_id: 'hwasan-latest', user_id: 'u4', status: 'hidden' },
      ],
    });

    const snapshot = await getHomeSnapshot();

    expect(snapshot.postPreviewByIpId).toEqual({
      hwasan: expect.objectContaining({ id: 'hwasan-latest', user: 'neonfan', tag: '후기', comments: 1 }),
      lumen: expect.objectContaining({ id: 'lumen-latest', user: 'fan_u2', tag: '한정굿즈' }),
    });
    expect(snapshot.postPreviewByIpId).not.toHaveProperty('regular');
    expect(records.filter((record) => record.table === 'posts').map((record) => record.eq)).toEqual(
      expect.arrayContaining([
        [['ip_id', 'hwasan'], ['status', 'visible']],
        [['ip_id', 'lumen'], ['status', 'visible']],
      ]),
    );
    expect(records.filter((record) => record.table === 'comments')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eq: [['post_id', 'hwasan-latest'], ['status', 'visible']],
      }),
    ]));

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('provides a home community post for every selectable IP in mock mode', async () => {
    mocks.isConfigured = false;
    mocks.client = null;

    const snapshot = await getHomeSnapshot();
    const selectable = getHomeSelectableIps(snapshot.catalog);

    expect(selectable.length).toBeGreaterThan(0);
    for (const ip of selectable) {
      expect(snapshot.postPreviewByIpId[ip.id], `${ip.title} 홈 팬덤 채널 포스트 누락`).not.toBeNull();
    }
  });
});
