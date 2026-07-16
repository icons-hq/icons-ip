import { describe, expect, it, vi } from 'vitest';
import { getCommunitySnapshot } from './community.server';
import type { CatalogSnapshot } from './catalog';
import { DATA } from './data';

const mocks = vi.hoisted(() => ({
  catalog: null as CatalogSnapshot | null,
  client: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data', async () => await import('./data'));
vi.mock('@/lib/community', async () => await import('./community'));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: () => mocks.catalog,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mocks.client,
}));

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

interface RpcRecord {
  functionName: string;
  args: Record<string, unknown>;
}

interface CreateClientOptions {
  rpcRecords?: RpcRecord[];
  signedUrlFailures?: ReadonlySet<string>;
  trendingError?: string;
  trendingRows?: Array<{
    tag: string;
    usage_count: number;
    latest_post_at: string;
  }>;
  rows?: Partial<TestRows>;
}

interface TestPostRow {
  id: string;
  user_id: string;
  ip_id: string | null;
  text: string;
  tag: string | null;
  created_at: string;
  updated_at?: string;
  image_path: string | null;
  status: 'visible' | 'hidden';
}

interface TestProfileRow {
  id: string;
  nickname: string | null;
}

interface TestLikeRow {
  post_id: string;
  user_id: string;
}

interface TestCommentRow {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  created_at: string;
  status?: 'visible' | 'hidden';
}

interface TestBlockRow {
  user_id: string;
  blocked_user_id: string;
}

interface TestIpFollowRow {
  user_id: string;
  ip_id: string;
  notify_drops: boolean;
  notify_events: boolean;
}

interface TestRows {
  posts: TestPostRow[];
  public_profiles: TestProfileRow[];
  likes: TestLikeRow[];
  comments: TestCommentRow[];
  blocks: TestBlockRow[];
  ip_follows: TestIpFollowRow[];
}

function createDefaultRows(): TestRows {
  return {
    posts: [
      {
        id: 'p1',
        user_id: 'u1',
        ip_id: 'hwasan',
        text: '첫 번째 포스트',
        tag: '후기',
        created_at: '2026-06-22T04:00:00.000Z',
        updated_at: '2026-06-22T04:01:00.000Z',
        image_path: 'u1/community/p1.png',
        status: 'visible',
      },
      {
        id: 'hidden',
        user_id: 'hidden-author',
        ip_id: 'hwasan',
        text: '숨김 포스트',
        tag: '숨김',
        created_at: '2026-06-22T05:00:00.000Z',
        updated_at: '2026-06-22T05:00:00.000Z',
        image_path: 'u1/community/hidden.png',
        status: 'hidden',
      },
    ],
    public_profiles: [
      { id: 'u1', nickname: 'neonfan' },
      { id: 'hidden-author', nickname: 'hidden_author' },
    ],
    likes: [{ post_id: 'p1', user_id: 'u1' }, { post_id: 'p1', user_id: 'u2' }],
    comments: [
      {
        id: 'c1',
        post_id: 'p1',
        user_id: 'u2',
        text: '저도 다녀왔어요',
        created_at: '2026-06-22T04:05:00.000Z',
      },
      {
        id: 'c2',
        post_id: 'p1',
        user_id: 'u1',
        text: '사진 더 올릴게요',
        created_at: '2026-06-22T04:06:00.000Z',
      },
    ],
    blocks: [],
    ip_follows: [],
  };
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
      let data = rows;
      for (const [column, value] of record.eq) {
        data = data.filter((row) => {
          const actual = table === 'comments' && column === 'status' && row[column] === undefined
            ? 'visible'
            : row[column];
          return actual === value;
        });
      }
      for (const [column, values] of record.in) data = data.filter((row) => values.includes(row[column]));
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
      return Promise.resolve({
        data: record.selectOptions?.head ? null : data,
        count: record.selectOptions?.count ? data.length : undefined,
        error: null,
      }).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function createClient(records: QueryRecord[], options: CreateClientOptions = {}) {
  const rows = { ...createDefaultRows(), ...options.rows };

  return {
    from(table: keyof typeof rows) {
      return createQuery(table, rows[table] as unknown as Record<string, unknown>[], records);
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      options.rpcRecords?.push({ functionName, args });

      if (functionName === 'community_trending_tags') {
        return options.trendingError
          ? { data: null, error: { message: options.trendingError } }
          : { data: options.trendingRows ?? [], error: null };
      }

      if (functionName !== 'community_post_reaction_counts') {
        return { data: null, error: { message: `Unexpected RPC: ${functionName}` } };
      }

      const targetPostIds = Array.isArray(args.target_post_ids) ? args.target_post_ids : [];
      const blockedUserIds = new Set(
        Array.isArray(args.blocked_user_ids) ? args.blocked_user_ids.map((value) => String(value)) : [],
      );

      return {
        data: targetPostIds.map((postId) => ({
          post_id: String(postId),
          likes_count: rows.likes.filter((row) => row.post_id === postId).length,
          comments_count: rows.comments.filter((row) =>
            row.post_id === postId
            && (row.status ?? 'visible') === 'visible'
            && !blockedUserIds.has(row.user_id),
          ).length,
        })),
        error: null,
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(path: string, expiresIn: number) {
            if (options.signedUrlFailures?.has(path)) {
              return {
                data: null,
                error: { message: 'Object not found' },
              };
            }

            return {
              data: { signedUrl: `https://cdn.example/${bucket}/${path}?exp=${expiresIn}` },
              error: null,
            };
          },
        };
      },
    },
  };
}

const catalog: CatalogSnapshot = {
  source: 'supabase',
  verticals: [{ key: 'rofan', label: '로맨스판타지', color: '#8B5CFF' }],
  ips: [{
    id: 'hwasan',
    title: '화산강림',
    sub: '리디 · 로판',
    v: { key: 'rofan', label: '로맨스판타지', color: '#8B5CFF' },
    glyph: '화산',
    bg: 'bg',
    fans: 10,
    goods: 1,
    cards: 1,
    featured: true,
    tagline: '매화는 다시 핀다',
    synopsis: '화산파의 부활',
  }],
  goods: [{ id: 'g1', ip: 'hwasan', name: '아크릴', type: '굿즈', price: 1000, badge: null, stock: 'ok', stockQty: 3, img: 'img' }],
  cards: [],
  events: [],
};

describe('getCommunitySnapshot', () => {
  it('filters fandom posts in the database before ordering and limiting while ignoring notification preferences', async () => {
    const records: QueryRecord[] = [];
    mocks.catalog = {
      ...catalog,
      ips: [
        ...catalog.ips,
        {
          ...catalog.ips[0],
          id: 'lumen',
          title: 'LUMEN',
          v: { ...catalog.ips[0].v, color: '#2DE2FF' },
        },
      ],
    };
    mocks.client = createClient(records, {
      rows: {
        posts: [
          ...createDefaultRows().posts,
          {
            id: 'lumen-post',
            user_id: 'u2',
            ip_id: 'lumen',
            text: '다른 IP 포스트',
            tag: '다른팬덤',
            created_at: '2026-06-22T06:00:00.000Z',
            image_path: null,
            status: 'visible',
          },
          {
            id: 'global-post',
            user_id: 'u2',
            ip_id: null,
            text: 'IP 없는 포스트',
            tag: '전체',
            created_at: '2026-06-22T07:00:00.000Z',
            image_path: null,
            status: 'visible',
          },
        ],
        public_profiles: [
          ...createDefaultRows().public_profiles,
          { id: 'u2', nickname: 'lumenfan' },
        ],
        ip_follows: [{
          user_id: 'viewer-1',
          ip_id: 'hwasan',
          notify_drops: false,
          notify_events: false,
        }],
      },
    });

    const snapshot = await getCommunitySnapshot({ viewerId: 'viewer-1', feed: 'fandom' });

    expect(snapshot.channels.map((channel) => channel.id)).toEqual(['hwasan']);
    expect(snapshot.posts.map((post) => post.id)).toEqual(['p1']);
    expect(records.find((record) => record.table === 'ip_follows')).toEqual(expect.objectContaining({
      select: 'ip_id',
      eq: [['user_id', 'viewer-1']],
    }));
    expect(records.find((record) => record.table === 'posts')).toEqual(expect.objectContaining({
      in: [['ip_id', ['hwasan']]],
      order: [['created_at', { ascending: false }]],
      limit: 30,
    }));
  });

  it('returns an empty fandom without querying posts when the viewer follows no IPs', async () => {
    const records: QueryRecord[] = [];
    mocks.catalog = catalog;
    mocks.client = createClient(records);

    const snapshot = await getCommunitySnapshot({ viewerId: 'viewer-1', feed: 'fandom' });

    expect(snapshot.channels).toEqual([]);
    expect(snapshot.posts).toEqual([]);
    expect(records.some((record) => record.table === 'posts')).toBe(false);
  });

  it('keeps guest fandom empty without reading private follow rows', async () => {
    const records: QueryRecord[] = [];
    mocks.catalog = catalog;
    mocks.client = createClient(records);

    const snapshot = await getCommunitySnapshot({ feed: 'fandom' });

    expect(snapshot.channels).toEqual([]);
    expect(snapshot.posts).toEqual([]);
    expect(records.some((record) => record.table === 'ip_follows')).toBe(false);
    expect(records.some((record) => record.table === 'posts')).toBe(false);
  });

  it('loads visible Supabase posts with safe author, reaction, comment and signed image fields', async () => {
    const records: QueryRecord[] = [];
    const rpcRecords: RpcRecord[] = [];
    mocks.catalog = catalog;
    mocks.client = createClient(records, { rpcRecords });

    const snapshot = await getCommunitySnapshot({ viewerId: 'u1' });

    expect(snapshot.posts).toEqual([
      expect.objectContaining({
        id: 'p1',
        user: 'neonfan',
        ipId: 'hwasan',
        ipName: '화산강림',
        avatar: '#8B5CFF',
        text: '첫 번째 포스트',
        tag: '후기',
        likes: 2,
        comments: 2,
        img: 'https://cdn.example/user-uploads/u1/community/p1.png?exp=3600',
        likedByViewer: true,
        canDelete: true,
        canEdit: true,
        isEdited: true,
        commentItems: [
          expect.objectContaining({
            id: 'c1',
            user: 'fan_u2',
            text: '저도 다녀왔어요',
            canDelete: false,
          }),
          expect.objectContaining({
            id: 'c2',
            user: 'neonfan',
            text: '사진 더 올릴게요',
            canDelete: true,
          }),
        ],
      }),
    ]);
    expect(snapshot.posts).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'hidden' })]));
    expect(snapshot.posts[0]).not.toHaveProperty('image_path');
    expect(records.find((record) => record.table === 'posts')).toMatchObject({
      select: 'id,user_id,ip_id,text,tag,created_at,updated_at,image_path,status',
      eq: [],
      order: [['created_at', { ascending: false }]],
      limit: 30,
    });
    expect(records.filter((record) => record.table === 'comments')).toEqual([
      expect.objectContaining({
        select: 'id,post_id,user_id,text,created_at,status',
        eq: [['post_id', 'p1'], ['status', 'visible']],
        order: [['created_at', { ascending: true }]],
        limit: 3,
      }),
    ]);
    expect(records.filter((record) => record.table === 'likes')).toEqual([
      expect.objectContaining({
        select: 'post_id',
        eq: [['user_id', 'u1']],
        in: [['post_id', ['p1']]],
      }),
    ]);
    expect(rpcRecords).toHaveLength(2);
    expect(rpcRecords).toEqual(expect.arrayContaining([{
      functionName: 'community_post_reaction_counts',
      args: { target_post_ids: ['p1'], blocked_user_ids: [] },
    }, {
      functionName: 'community_trending_tags',
      args: { window_days: 7, result_limit: 10 },
    }]));
  });

  it('loads the ordered recent trending tags from Supabase', async () => {
    const records: QueryRecord[] = [];
    const rpcRecords: RpcRecord[] = [];
    mocks.catalog = catalog;
    mocks.client = createClient(records, {
      rpcRecords,
      trendingRows: [
        { tag: '메이플스토리', usage_count: 4, latest_post_at: '2026-07-16T08:00:00.000Z' },
        { tag: '리락쿠마', usage_count: 3, latest_post_at: '2026-07-16T07:00:00.000Z' },
      ],
    });

    const snapshot = await getCommunitySnapshot();

    expect(snapshot.trending).toEqual(['메이플스토리', '리락쿠마']);
    expect(rpcRecords).toContainEqual({
      functionName: 'community_trending_tags',
      args: { window_days: 7, result_limit: 10 },
    });
  });

  it('keeps an empty Supabase aggregate empty instead of falling back to mock tags', async () => {
    mocks.catalog = catalog;
    mocks.client = createClient([], { trendingRows: [] });

    await expect(getCommunitySnapshot()).resolves.toEqual(expect.objectContaining({
      source: 'supabase',
      trending: [],
    }));
  });

  it('fails a Supabase trending query closed without breaking the public feed', async () => {
    mocks.catalog = catalog;
    mocks.client = createClient([], { trendingError: 'aggregate unavailable' });

    await expect(getCommunitySnapshot()).resolves.toEqual(expect.objectContaining({
      source: 'supabase',
      posts: [expect.objectContaining({ id: 'p1' })],
      trending: [],
    }));
  });

  it('uses mock trending tags only when the catalog source is mock', async () => {
    mocks.catalog = { ...catalog, source: 'mock' };
    mocks.client = {
      rpc: () => {
        throw new Error('Supabase must not be called for a mock snapshot');
      },
    };

    const snapshot = await getCommunitySnapshot();

    expect(snapshot).toEqual(expect.objectContaining({
      source: 'mock',
      trending: DATA.TRENDING,
    }));
    expect(snapshot.posts.every((post) => !post.canEdit && !post.isEdited)).toBe(true);
  });

  it('preserves a null post tag in the DTO and exposes edit state separately from delete state', async () => {
    mocks.catalog = catalog;
    mocks.client = createClient([], {
      rows: {
        posts: [{
          id: 'null-tag',
          user_id: 'u1',
          ip_id: 'hwasan',
          text: '태그 없는 포스트',
          tag: null,
          created_at: '2026-06-22T04:00:00.000Z',
          updated_at: '2026-06-22T04:00:00.000Z',
          image_path: null,
          status: 'visible',
        }],
        public_profiles: [{ id: 'u1', nickname: 'neonfan' }],
        likes: [],
        comments: [],
        blocks: [],
      },
    });

    await expect(getCommunitySnapshot({ viewerId: 'u1' })).resolves.toEqual(expect.objectContaining({
      posts: [expect.objectContaining({
        tag: null,
        canDelete: true,
        canEdit: true,
        isEdited: false,
      })],
    }));
  });

  it('loads comment previews per post so busy posts do not starve other cards', async () => {
    const records: QueryRecord[] = [];
    mocks.catalog = catalog;
    mocks.client = createClient(records, {
      rows: {
        posts: [
          {
            id: 'p2',
            user_id: 'u3',
            ip_id: 'hwasan',
            text: '두 번째 포스트',
            tag: '질문',
            created_at: '2026-06-22T04:30:00.000Z',
            image_path: null,
            status: 'visible',
          },
          {
            id: 'p1',
            user_id: 'u1',
            ip_id: 'hwasan',
            text: '첫 번째 포스트',
            tag: '후기',
            created_at: '2026-06-22T04:00:00.000Z',
            image_path: null,
            status: 'visible',
          },
        ],
        public_profiles: [
          { id: 'u1', nickname: 'neonfan' },
          { id: 'u2', nickname: null },
          { id: 'u3', nickname: 'commenter' },
        ],
        likes: [],
        comments: [
          ...Array.from({ length: 91 }, (_, index) => ({
            id: `p1-c${index + 1}`,
            post_id: 'p1',
            user_id: 'u2',
            text: `busy comment ${index + 1}`,
            created_at: new Date(Date.UTC(2026, 5, 22, 4, 0, index)).toISOString(),
          })),
          {
            id: 'p2-c1',
            post_id: 'p2',
            user_id: 'u3',
            text: '다른 포스트 댓글',
            created_at: '2026-06-22T05:40:00.000Z',
          },
        ],
      },
    });

    const snapshot = await getCommunitySnapshot();

    expect(snapshot.posts.map((post) => ({
      id: post.id,
      comments: post.comments,
      previewIds: post.commentItems.map((comment) => comment.id),
    }))).toEqual([
      { id: 'p2', comments: 1, previewIds: ['p2-c1'] },
      { id: 'p1', comments: 91, previewIds: ['p1-c1', 'p1-c2', 'p1-c3'] },
    ]);
    expect(records.filter((record) => record.table === 'comments')).toEqual([
      expect.objectContaining({
        eq: [['post_id', 'p2'], ['status', 'visible']],
        limit: 3,
      }),
      expect.objectContaining({
        eq: [['post_id', 'p1'], ['status', 'visible']],
        limit: 3,
      }),
    ]);
  });

  it('filters hidden comments before the preview limit and excludes them from staff public-feed DTOs', async () => {
    const records: QueryRecord[] = [];
    mocks.catalog = catalog;
    mocks.client = createClient(records, {
      rows: {
        posts: [{
          id: 'p1',
          user_id: 'u1',
          ip_id: 'hwasan',
          text: '댓글 필터 테스트',
          tag: null,
          created_at: '2026-06-22T04:00:00.000Z',
          image_path: null,
          status: 'visible',
        }],
        public_profiles: [
          { id: 'u1', nickname: 'author' },
          { id: 'u2', nickname: 'commenter' },
        ],
        likes: [],
        comments: [
          {
            id: 'hidden-first',
            post_id: 'p1',
            user_id: 'u2',
            text: '운영자에게도 공개 피드에는 나오면 안 됨',
            created_at: '2026-06-22T04:01:00.000Z',
            status: 'hidden',
          },
          ...Array.from({ length: 3 }, (_, index) => ({
            id: `visible-${index + 1}`,
            post_id: 'p1',
            user_id: 'u2',
            text: `visible ${index + 1}`,
            created_at: `2026-06-22T04:0${index + 2}:00.000Z`,
            status: 'visible' as const,
          })),
        ],
        blocks: [],
      },
    });

    const snapshot = await getCommunitySnapshot({ viewerId: 'staff-1', isStaff: true });

    expect(snapshot.posts[0]).toEqual(expect.objectContaining({
      comments: 3,
      commentItems: [
        expect.objectContaining({ id: 'visible-1' }),
        expect.objectContaining({ id: 'visible-2' }),
        expect.objectContaining({ id: 'visible-3' }),
      ],
    }));
    expect(snapshot.posts[0].commentItems).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'hidden-first' })]),
    );
    expect(records.find((record) => record.table === 'comments')).toEqual(expect.objectContaining({
      eq: [['post_id', 'p1'], ['status', 'visible']],
      order: [['created_at', { ascending: true }]],
      limit: 3,
    }));
  });

  it('omits a post image when signed URL creation fails without failing the public feed', async () => {
    const records: QueryRecord[] = [];
    const rpcRecords: RpcRecord[] = [];
    mocks.catalog = catalog;
    mocks.client = createClient(records, {
      rpcRecords,
      signedUrlFailures: new Set(['u1/community/p1.png']),
    });

    const snapshot = await getCommunitySnapshot();

    expect(snapshot.posts).toEqual([
      expect.objectContaining({
        id: 'p1',
        img: null,
      }),
    ]);
    expect(rpcRecords).toHaveLength(2);
    expect(rpcRecords).toEqual(expect.arrayContaining([{
      functionName: 'community_post_reaction_counts',
      args: { target_post_ids: ['p1'], blocked_user_ids: [] },
    }, {
      functionName: 'community_trending_tags',
      args: { window_days: 7, result_limit: 10 },
    }]));
  });

  it('excludes posts from authors blocked by the viewer', async () => {
    const records: QueryRecord[] = [];
    mocks.catalog = catalog;
    mocks.client = createClient(records, {
      rows: {
        posts: [
          {
            id: 'blocked-post',
            user_id: 'u1',
            ip_id: 'hwasan',
            text: '차단한 작성자의 포스트',
            tag: '차단',
            created_at: '2026-06-22T05:00:00.000Z',
            image_path: null,
            status: 'visible',
          },
          {
            id: 'visible-post',
            user_id: 'u2',
            ip_id: 'hwasan',
            text: '볼 수 있는 포스트',
            tag: '후기',
            created_at: '2026-06-22T04:00:00.000Z',
            image_path: null,
            status: 'visible',
          },
        ],
        public_profiles: [
          { id: 'u1', nickname: 'blocked_author' },
          { id: 'u2', nickname: 'visible_author' },
          { id: 'u3', nickname: 'allowed_commenter' },
        ],
        likes: [],
        comments: [
          {
            id: 'blocked-comment',
            post_id: 'visible-post',
            user_id: 'u1',
            text: '차단한 사용자의 댓글',
            created_at: '2026-06-22T04:05:00.000Z',
          },
          {
            id: 'allowed-comment',
            post_id: 'visible-post',
            user_id: 'u3',
            text: '볼 수 있는 댓글',
            created_at: '2026-06-22T04:06:00.000Z',
          },
        ],
        blocks: [{ user_id: 'viewer-1', blocked_user_id: 'u1' }],
      },
    });

    const snapshot = await getCommunitySnapshot({ viewerId: 'viewer-1' });

    expect(snapshot.posts.map((post) => post.id)).toEqual(['visible-post']);
    expect(snapshot.posts[0]).toEqual(expect.objectContaining({
      authorId: 'u2',
      comments: 1,
      commentItems: [expect.objectContaining({ id: 'allowed-comment' })],
      user: 'visible_author',
    }));
    expect(snapshot.posts[0].commentItems).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'blocked-comment' })]),
    );
    expect(records.filter((record) => record.table === 'blocks')).toEqual([
      expect.objectContaining({
        select: 'blocked_user_id',
        eq: [['user_id', 'viewer-1']],
      }),
    ]);
    expect(records.find((record) => record.table === 'posts')).toEqual(expect.objectContaining({
      not: [['user_id', 'in', '(u1)']],
    }));
    expect(records.filter((record) => record.table === 'comments')).toEqual([
      expect.objectContaining({
        eq: [['post_id', 'visible-post'], ['status', 'visible']],
        not: [['user_id', 'in', '(u1)']],
      }),
    ]);
  });

  it('keeps hidden posts visible to their author and staff while excluding public viewers', async () => {
    const records: QueryRecord[] = [];
    mocks.catalog = catalog;
    mocks.client = createClient(records, {
      rows: {
        posts: [
          {
            id: 'hidden-own-post',
            user_id: 'author-1',
            ip_id: 'hwasan',
            text: '작성자에게 보이는 숨김 포스트',
            tag: '숨김',
            created_at: '2026-06-22T05:00:00.000Z',
            image_path: null,
            status: 'hidden',
          },
        ],
        public_profiles: [{ id: 'author-1', nickname: 'author' }],
        likes: [],
        comments: [],
        blocks: [],
      },
    });

    await expect(getCommunitySnapshot()).resolves.toEqual(expect.objectContaining({
      posts: [],
    }));
    await expect(getCommunitySnapshot({ viewerId: 'author-1' })).resolves.toEqual(expect.objectContaining({
      posts: [expect.objectContaining({ id: 'hidden-own-post', canDelete: true, canEdit: false })],
    }));
    await expect(getCommunitySnapshot({ viewerId: 'staff-1', isStaff: true })).resolves.toEqual(expect.objectContaining({
      posts: [expect.objectContaining({ id: 'hidden-own-post', canDelete: false, canEdit: false })],
    }));
  });
});
