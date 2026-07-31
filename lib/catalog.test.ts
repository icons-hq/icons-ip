import { describe, expect, it, vi } from 'vitest';
import { buildCatalogIpDetail, getBinderCatalogOverlay, getCatalogIpDetail, getCatalogSnapshot, getHomeSnapshot, type CatalogPostPreview, type CatalogSnapshot } from './catalog';
import { getHomeSelectableIps } from './home-catalog';
import type { Ip } from './data';

const mocks = vi.hoisted(() => ({
  isConfigured: false,
  client: null as unknown,
}));

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
  gt: [string, number][];
  lte: [string, string][];
  is: [string, unknown][];
  in: [string, unknown[]][];
  not: [string, string, string][];
  or: string[];
  order: [string, { ascending?: boolean } | undefined][];
  limit?: number;
};

type QueryResult<T> = {
  data: T[] | null;
  count?: number | null;
  error: { message: string } | null;
};

type SupabaseRows = Record<
  'verticals' | 'ips' | 'goods' | 'cards' | 'events' | 'posts' | 'public_profiles' | 'likes' | 'comments' | 'blocks' | 'user_cards' | 'home_curations',
  Record<string, unknown>[]
>;

function makeResult<T>(data: T[] | null, count?: number | null): QueryResult<T> {
  return { data, count, error: null };
}

function createQuery(
  table: string,
  rows: Record<string, unknown>[],
  records: QueryRecord[],
  errorMessage?: string,
) {
  const record: QueryRecord = { table, eq: [], gt: [], lte: [], is: [], in: [], not: [], or: [], order: [] };
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
    gt(column: string, value: number) {
      record.gt.push([column, value]);
      return query;
    },
    lte(column: string, value: string) {
      record.lte.push([column, value]);
      return query;
    },
    is(column: string, value: unknown) {
      record.is.push([column, value]);
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
    or(value: string) {
      record.or.push(value);
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
        if (errorMessage) {
          return Promise.resolve({ data: null, error: { message: errorMessage } }).then(onfulfilled, onrejected);
        }
        let data = rows;
        for (const [column, value] of record.eq) {
          data = data.filter((row) => row[column] === value);
        }
        for (const [column, value] of record.gt) {
          data = data.filter((row) => Number(row[column]) > value);
        }
        for (const [column, value] of record.lte) {
          data = data.filter((row) => String(row[column]) <= value);
        }
        for (const [column, value] of record.is) {
          data = data.filter((row) => value === null ? row[column] == null : row[column] === value);
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
        for (const expression of record.or) {
          const activeToMatch = /^active_to\.is\.null,active_to\.gt\.(.+)$/.exec(expression);
          if (activeToMatch) {
            const boundary = activeToMatch[1];
            data = data.filter((row) => row.active_to == null || String(row.active_to) > boundary);
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
    user_cards: [],
    home_curations: [],
  };
}

function createSupabaseClient(
  records: QueryRecord[],
  overrides: Partial<SupabaseRows> = {},
  userId: string | null = 'viewer-1',
  errors: Partial<Record<keyof SupabaseRows, string>> = {},
) {
  const rows: SupabaseRows = {
    ...defaultSupabaseRows(),
    ...overrides,
  };

  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: userId ? { id: userId } : null } }),
    },
    from(table: keyof SupabaseRows) {
      return createQuery(table, rows[table] as unknown as Record<string, unknown>[], records, errors[table]);
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
  it('orders public IPs by audience without consulting the legacy featured flag', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records);

    await getCatalogSnapshot();

    expect(records.find((record) => record.table === 'ips')?.order).toEqual([
      ['fans_count', { ascending: false }],
    ]);

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('excludes archived catalog records from every public Supabase collection', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records, {
      ips: [
        ...defaultSupabaseRows().ips,
        {
          ...defaultSupabaseRows().ips[0],
          id: 'archived-ip',
          title: '보관 IP',
          archived_at: '2026-07-17T00:00:00.000Z',
        },
      ],
      goods: [
        { id: 'g-active', ip_id: 'hwasan', name: '운영 굿즈', type: '아크릴', price: 1000, badge: null, stock: 'ok', stock_qty: 1, bg: null, image_path: null, archived_at: null },
        { id: 'g-archived', ip_id: 'hwasan', name: '보관 굿즈', type: '아크릴', price: 1000, badge: null, stock: 'soldout', stock_qty: 0, bg: null, image_path: null, archived_at: '2026-07-17T00:00:00.000Z' },
      ],
      cards: [
        { id: 'c-active', ip_id: 'hwasan', name: '운영 카드', no: '001', rarity: 'N', bg: null, image_path: null, archived_at: null },
        { id: 'c-archived', ip_id: 'hwasan', name: '보관 카드', no: '002', rarity: 'N', bg: null, image_path: null, archived_at: '2026-07-17T00:00:00.000Z' },
      ],
      events: [
        { id: 'e-active', ip_id: 'hwasan', title: '운영 이벤트', mode: '온라인', status: '예정', starts_at: null, ends_at: null, location: null, accent: null, bg: null, image_path: null, archived_at: null },
        { id: 'e-archived', ip_id: 'hwasan', title: '보관 이벤트', mode: '온라인', status: '종료', starts_at: null, ends_at: null, location: null, accent: null, bg: null, image_path: null, archived_at: '2026-07-17T00:00:00.000Z' },
      ],
    });

    const snapshot = await getCatalogSnapshot();

    expect(snapshot.ips.map((item) => item.id)).toEqual(['hwasan']);
    expect(snapshot.goods.map((item) => item.id)).toEqual(['g-active']);
    expect(snapshot.cards.map((item) => item.id)).toEqual(['c-active']);
    expect(snapshot.events.map((item) => item.id)).toEqual(['e-active']);
    for (const table of ['ips', 'goods', 'cards', 'events']) {
      expect(records.find((record) => record.table === table)?.is).toContainEqual(['archived_at', null]);
    }

    mocks.isConfigured = false;
    mocks.client = null;
  });

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

describe('getBinderCatalogOverlay', () => {
  it('loads owned archived card metadata without reopening it in public discovery', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records, {
      user_cards: [
        { card_id: 'c-archived', qty: 1 },
        { card_id: 'c-zero', qty: 0 },
      ],
      ips: [{
        id: 'archived-ip',
        title: '보관된 IP',
        sub: '종료된 시리즈',
        vertical_key: 'rofan',
        tagline: '기억 속에 남은 이야기',
        synopsis: '보관된 IP 설명',
        glyph: '보관',
        bg: 'archived-ip-bg',
        image_path: null,
        featured: false,
        fans_count: 12,
        goods_count: 0,
        cards_count: 1,
        archived_at: '2026-07-17T00:00:00.000Z',
      }],
      cards: [
        {
          id: 'c-archived',
          ip_id: 'archived-ip',
          name: '보관된 보유 카드',
          no: '099',
          rarity: 'SSR',
          bg: null,
          image_path: 'public-media/catalog/card/c-archived.webp',
          archived_at: '2026-07-17T00:00:00.000Z',
        },
        {
          id: 'c-zero',
          ip_id: 'hwasan',
          name: '수량 없는 카드',
          no: '100',
          rarity: 'N',
          bg: null,
          image_path: null,
          archived_at: null,
        },
      ],
    });

    await expect(getBinderCatalogOverlay()).resolves.toEqual({
      ownedCardIds: ['c-archived'],
      cards: [expect.objectContaining({
        id: 'c-archived',
        ip: 'archived-ip',
        name: '보관된 보유 카드',
        owned: false,
        bg: 'url("https://cdn.example/catalog/card/c-archived.webp") center / cover no-repeat',
      })],
      ips: [expect.objectContaining({
        id: 'archived-ip',
        title: '보관된 IP',
        v: vertical,
      })],
    });
    expect(records.find((record) => record.table === 'user_cards')?.gt).toEqual([['qty', 0]]);
    expect(records.find((record) => record.table === 'cards')?.in).toEqual([['id', ['c-archived']]]);
    expect(records.find((record) => record.table === 'cards')?.is).toEqual([]);
    expect(records.find((record) => record.table === 'ips')?.in).toEqual([['id', ['archived-ip']]]);

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('returns public mode for a signed-out viewer', async () => {
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient([], {}, null);

    await expect(getBinderCatalogOverlay()).resolves.toBeNull();

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
  it('loads active home curation in deterministic order and scopes previews to curated IPs', async () => {
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
      home_curations: [
        {
          id: '00000000-0000-0000-0000-000000000000',
          kind: 'hero',
          ip_id: null,
          title: '이미지 없는 히어로',
          image_path: null,
          link_path: '/events/image-required',
          display_order: 0,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000001',
          kind: 'hero',
          ip_id: null,
          title: '여름 홈 히어로',
          image_path: 'public-media/catalog/curation/11111111-1111-4111-8111-111111111111.webp',
          link_path: '/events/summer',
          display_order: 0,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000002',
          kind: 'announcement',
          ip_id: null,
          title: '배송 일정 안내',
          image_path: null,
          link_path: '/community?tag=notice',
          display_order: 0,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000003',
          kind: 'featured_ip',
          ip_id: 'regular',
          title: 'REGULAR 특집',
          image_path: null,
          link_path: '/ip/regular',
          display_order: 1,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000004',
          kind: 'featured_ip',
          ip_id: 'hwasan',
          title: '화산강림 특집',
          image_path: null,
          link_path: '/ip/hwasan',
          display_order: 2,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000005',
          kind: 'featured_ip',
          ip_id: 'lumen',
          title: '비활성 특집',
          image_path: null,
          link_path: '/ip/lumen',
          display_order: 0,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: false,
        },
        {
          id: '00000000-0000-0000-0000-000000000006',
          kind: 'hero',
          ip_id: null,
          title: '예약 히어로',
          image_path: 'public-media/catalog/curation/22222222-2222-4222-8222-222222222222.webp',
          link_path: '/future',
          display_order: 0,
          active_from: '2999-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000007',
          kind: 'announcement',
          ip_id: null,
          title: '종료 공지',
          image_path: null,
          link_path: '/ended',
          display_order: 0,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: '2021-01-01T00:00:00.000Z',
          enabled: true,
        },
      ],
    });

    const snapshot = await getHomeSnapshot();

    expect(snapshot.curation).toEqual({
      hero: {
        id: '00000000-0000-0000-0000-000000000001',
        title: '여름 홈 히어로',
        imageBg: 'url("https://cdn.example/catalog/curation/11111111-1111-4111-8111-111111111111.webp") center / cover no-repeat',
        href: '/events/summer',
      },
      announcement: {
        id: '00000000-0000-0000-0000-000000000002',
        title: '배송 일정 안내',
        imageBg: null,
        href: '/community?tag=notice',
      },
      featuredIpIds: ['regular', 'hwasan'],
    });
    expect(snapshot.postPreviewByIpId).toEqual({
      regular: expect.objectContaining({ id: 'regular-latest' }),
      hwasan: expect.objectContaining({ id: 'hwasan-latest', user: 'neonfan', tag: '후기', comments: 1 }),
    });
    expect(snapshot.postPreviewByIpId).not.toHaveProperty('lumen');
    expect(records.filter((record) => record.table === 'posts').map((record) => record.eq)).toEqual(
      expect.arrayContaining([
        [['ip_id', 'regular'], ['status', 'visible']],
        [['ip_id', 'hwasan'], ['status', 'visible']],
      ]),
    );
    expect(records.filter((record) => record.table === 'comments')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eq: [['post_id', 'hwasan-latest'], ['status', 'visible']],
      }),
    ]));
    const curationQuery = records.find((record) => record.table === 'home_curations');
    expect(curationQuery).toEqual(expect.objectContaining({
      eq: [['enabled', true]],
      order: [
        ['kind', { ascending: true }],
        ['display_order', { ascending: true }],
        ['active_from', { ascending: true }],
        ['id', { ascending: true }],
      ],
    }));
    expect(curationQuery?.lte).toEqual([
      ['active_from', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)],
    ]);
    expect(curationQuery?.or).toEqual([
      expect.stringMatching(/^active_to\.is\.null,active_to\.gt\./),
    ]);

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('treats empty Supabase curation as empty and never falls back to legacy featured IPs', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records, {
      ips: [
        {
          ...defaultSupabaseRows().ips[0],
          id: 'regular-first',
          title: '우선 IP',
          featured: false,
          fans_count: 9000,
        },
        {
          ...defaultSupabaseRows().ips[0],
          id: 'legacy-featured',
          title: '레거시 특집',
          featured: true,
          fans_count: 100,
        },
      ],
      posts: [
        { id: 'regular-post', user_id: 'u1', ip_id: 'regular-first', text: '우선 IP 글', tag: null, created_at: '2026-06-22T04:00:00.000Z', status: 'visible' },
        { id: 'legacy-post', user_id: 'u2', ip_id: 'legacy-featured', text: '레거시 글', tag: null, created_at: '2026-06-22T03:00:00.000Z', status: 'visible' },
      ],
      home_curations: [],
    });

    const snapshot = await getHomeSnapshot();

    expect(snapshot.curation).toEqual({ hero: null, announcement: null, featuredIpIds: [] });
    expect(Object.keys(snapshot.postPreviewByIpId)).toEqual(['regular-first', 'legacy-featured']);
    expect(records.filter((record) => record.table === 'posts').map((record) => record.eq[0])).toEqual([
      ['ip_id', 'regular-first'],
      ['ip_id', 'legacy-featured'],
    ]);

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('returns at most five catalog-valid deduped featured IDs and scopes previews to that same order', async () => {
    const records: QueryRecord[] = [];
    const curatedIds = ['missing-a', 'ip-6', 'ip-6', 'missing-b', 'ip-5', 'ip-4', 'ip-3', 'ip-2', 'ip-1'];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records, {
      ips: Array.from({ length: 6 }, (_, index) => {
        const number = 6 - index;
        return {
          ...defaultSupabaseRows().ips[0],
          id: `ip-${number}`,
          title: `IP ${number}`,
          featured: number === 1,
          fans_count: number * 100,
        };
      }),
      posts: Array.from({ length: 6 }, (_, index) => {
        const number = 6 - index;
        return {
          id: `post-${number}`,
          user_id: 'u1',
          ip_id: `ip-${number}`,
          text: `IP ${number} 글`,
          tag: null,
          created_at: `2026-06-22T0${number}:00:00.000Z`,
          status: 'visible',
        };
      }),
      home_curations: curatedIds.map((ipId, index) => ({
        id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
        kind: 'featured_ip',
        ip_id: ipId,
        title: `${ipId} 특집`,
        image_path: null,
        link_path: `/ip/${ipId}`,
        display_order: index,
        active_from: '2020-01-01T00:00:00.000Z',
        active_to: null,
        enabled: true,
      })),
    });

    const snapshot = await getHomeSnapshot();

    expect(snapshot.curation.featuredIpIds).toEqual(['ip-6', 'ip-5', 'ip-4', 'ip-3', 'ip-2']);
    expect(Object.keys(snapshot.postPreviewByIpId)).toEqual(['ip-6', 'ip-5', 'ip-4', 'ip-3', 'ip-2']);
    expect(records.filter((record) => record.table === 'posts').map((record) => record.eq[0])).toEqual([
      ['ip_id', 'ip-6'],
      ['ip_id', 'ip-5'],
      ['ip_id', 'ip-4'],
      ['ip_id', 'ip-3'],
      ['ip_id', 'ip-2'],
    ]);

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('applies the first featured artwork to the home catalog only and falls back when artwork is absent', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records, {
      ips: [
        {
          ...defaultSupabaseRows().ips[0],
          id: 'art-ip',
          title: '아트 특집',
          bg: 'original-art-bg',
          featured: false,
        },
        {
          ...defaultSupabaseRows().ips[0],
          id: 'fallback-ip',
          title: '기본 키아트 특집',
          bg: 'fallback-catalog-bg',
          featured: false,
        },
      ],
      home_curations: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          kind: 'featured_ip',
          ip_id: 'art-ip',
          title: '첫 번째 아트 특집',
          image_path: 'public-media/catalog/curation/11111111-1111-4111-8111-111111111111.webp',
          link_path: '/ip/art-ip',
          display_order: 0,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000002',
          kind: 'featured_ip',
          ip_id: 'art-ip',
          title: '중복 후순위 아트',
          image_path: 'public-media/catalog/curation/22222222-2222-4222-8222-222222222222.webp',
          link_path: '/ip/art-ip',
          display_order: 1,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000003',
          kind: 'featured_ip',
          ip_id: 'fallback-ip',
          title: '이미지 없는 특집',
          image_path: null,
          link_path: '/ip/fallback-ip',
          display_order: 2,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
      ],
    });

    const publicCatalog = await getCatalogSnapshot();
    const home = await getHomeSnapshot();

    expect(publicCatalog.ips.find((item) => item.id === 'art-ip')?.bg).toBe('original-art-bg');
    expect(home.curation.featuredIpIds).toEqual(['art-ip', 'fallback-ip']);
    expect(home.catalog.ips.find((item) => item.id === 'art-ip')?.bg).toBe(
      'url("https://cdn.example/catalog/curation/11111111-1111-4111-8111-111111111111.webp") center / cover no-repeat',
    );
    expect(home.catalog.ips.find((item) => item.id === 'fallback-ip')?.bg).toBe('fallback-catalog-bg');

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('accepts an internal link at the 2048 Unicode character boundary', async () => {
    const records: QueryRecord[] = [];
    const unicodeBoundaryLink = `/${'😀'.repeat(2047)}`;
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records, {
      home_curations: [{
        id: '00000000-0000-0000-0000-000000000001',
        kind: 'announcement',
        ip_id: null,
        title: '유니코드 경로 공지',
        image_path: null,
        link_path: unicodeBoundaryLink,
        display_order: 0,
        active_from: '2020-01-01T00:00:00.000Z',
        active_to: null,
        enabled: true,
      }],
    });

    const snapshot = await getHomeSnapshot();

    expect(Array.from(unicodeBoundaryLink)).toHaveLength(2048);
    expect(unicodeBoundaryLink.length).toBeGreaterThan(2048);
    expect(snapshot.curation.announcement?.href).toBe(unicodeBoundaryLink);

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('fails closed on unsafe links and malformed curation artwork without hiding later valid rows', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records, {
      home_curations: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          kind: 'hero',
          ip_id: null,
          title: '위험한 히어로',
          image_path: 'public-media/catalog/curation/11111111-1111-4111-8111-111111111111.webp',
          link_path: '/%2f%2fevil.example',
          display_order: 0,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000002',
          kind: 'hero',
          ip_id: null,
          title: '안전한 히어로',
          image_path: 'public-media/catalog/curation/22222222-2222-4222-8222-222222222222.webp',
          link_path: '/events',
          display_order: 1,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000003',
          kind: 'announcement',
          ip_id: null,
          title: '잘못된 이미지 공지',
          image_path: 'public-media/catalog/ip/not-a-curation.webp',
          link_path: '/community',
          display_order: 0,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
        {
          id: '00000000-0000-0000-0000-000000000004',
          kind: 'featured_ip',
          ip_id: 'hwasan',
          title: '안전한 특집',
          image_path: null,
          link_path: '/ip/hwasan',
          display_order: 0,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: null,
          enabled: true,
        },
      ],
    });

    const snapshot = await getHomeSnapshot();

    expect(snapshot.curation).toEqual({
      hero: expect.objectContaining({ title: '안전한 히어로', href: '/events' }),
      announcement: null,
      featuredIpIds: ['hwasan'],
    });

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('throws when the Supabase curation query fails instead of falling back to mock data', async () => {
    const records: QueryRecord[] = [];
    mocks.isConfigured = true;
    mocks.client = createSupabaseClient(records, {}, null, { home_curations: 'curation unavailable' });

    await expect(getHomeSnapshot()).rejects.toThrow('Failed to load home curations: curation unavailable');

    mocks.isConfigured = false;
    mocks.client = null;
  });

  it('provides a home community post for every selectable IP in mock mode', async () => {
    mocks.isConfigured = false;
    mocks.client = null;

    const snapshot = await getHomeSnapshot();
    const selectable = getHomeSelectableIps(snapshot.catalog, undefined);

    expect(snapshot.curation).toEqual({ hero: null, announcement: null, featuredIpIds: [] });
    expect(selectable.length).toBeGreaterThan(0);
    for (const ip of selectable) {
      expect(snapshot.postPreviewByIpId[ip.id], `${ip.title} 홈 팬덤 채널 포스트 누락`).not.toBeNull();
    }
  });
});
