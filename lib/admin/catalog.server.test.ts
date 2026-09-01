import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAdminCardPoolStatus,
  getAdminCatalogRecords,
  getAdminGameStatus,
  getAdminRewardPolicyStatus,
} from './catalog.server';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };

interface QueryRecord {
  table: string;
  select: string | null;
  order: Array<[string, { ascending?: boolean } | undefined]>;
  limit: Array<[number, { referencedTable?: string } | undefined]>;
}

function createClient({
  errors = {},
  records,
  rpcErrors = {},
  rpcRecords = [],
  rpcRows = {},
  rows = {},
}: {
  errors?: Record<string, string>;
  records: QueryRecord[];
  rpcErrors?: Record<string, string>;
  rpcRecords?: string[];
  rpcRows?: Record<string, Row[]>;
  rows?: Record<string, Row[]>;
}) {
  return {
    from(table: string) {
      const record: QueryRecord = { table, select: null, order: [], limit: [] };
      records.push(record);
      const resolve = (): Result => ({
        data: rows[table] ?? [],
        error: errors[table] ? { message: errors[table] } : null,
      });
      const query = {
        select(columns: string) {
          record.select = columns;
          return query;
        },
        order(column: string, options?: { ascending?: boolean }) {
          record.order.push([column, options]);
          return query;
        },
        limit(count: number, options?: { referencedTable?: string }) {
          record.limit.push([count, options]);
          return query;
        },
        then<TResult1 = Result, TResult2 = never>(
          onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(resolve()).then(onfulfilled, onrejected);
        },
      };
      return query;
    },
    rpc(name: string) {
      rpcRecords.push(name);
      return Promise.resolve({
        data: rpcRows[name] ?? [],
        error: rpcErrors[name] ? { message: rpcErrors[name] } : null,
      });
    },
    storage: {
      from(bucket: string) {
        if (bucket !== 'public-media') throw new Error(`Unexpected bucket ${bucket}`);
        return {
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://cdn.example/public-media/${path}` } };
          },
        };
      },
    },
  };
}

describe('getAdminCatalogRecords', () => {
  beforeEach(() => {
    mocks.client = null;
  });

  it('classifies card-pool operating windows at a stable instant', () => {
    const now = Date.parse('2026-07-15T00:00:00.000Z');

    expect(getAdminCardPoolStatus('2026-07-15T01:00:00.000Z', null, now)).toBe('scheduled');
    expect(getAdminCardPoolStatus('2026-07-14T00:00:00.000Z', null, now)).toBe('active');
    expect(getAdminCardPoolStatus('2026-07-14T00:00:00.000Z', '2026-07-15T00:00:00.000Z', now)).toBe('ended');
  });

  it('preserves stored artwork paths and exposes their public preview URLs', async () => {
    mocks.client = createClient({
      records: [],
      rows: {
        ips: [{
          id: 'hwasan',
          title: '화산강림',
          sub: null,
          vertical_key: 'rofan',
          tagline: null,
          synopsis: null,
          glyph: null,
          bg: null,
          image_path: 'public-media/catalog/ip/11111111-1111-4111-8111-111111111111.webp',
          featured: true,
          fans_count: 0,
        }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.ips[0]).toMatchObject({
      imagePath: 'public-media/catalog/ip/11111111-1111-4111-8111-111111111111.webp',
      imageUrl: 'https://cdn.example/public-media/catalog/ip/11111111-1111-4111-8111-111111111111.webp',
    });
  });

  /*
   * 아트워크를 Storage에 올리기 전 레코드는 이미지가 `bg` 안에만 있다.
   * 공개 화면은 그 값을 그대로 그리는데 어드민만 빈 칸이면 운영자가 레코드를 식별할 수 없다.
   */
  it('아트워크 경로가 없으면 bg 안의 이미지로 미리보기를 채운다', async () => {
    mocks.client = createClient({
      records: [],
      rows: {
        ips: [{
          id: 'rilakkuma',
          bg: 'url("/generated/ip/rilakkuma.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)',
          image_path: null,
        }],
        goods: [{
          id: 'g1',
          bg: 'url("/generated/goods/g1.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)',
          image_path: null,
        }],
        cards: [{
          id: 'c1',
          bg: 'url("/generated/cards/c1.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)',
          image_path: null,
        }],
        events: [{
          id: 'e1',
          bg: 'url("/generated/events/e1.png") center / cover no-repeat, linear-gradient(150deg, #5a3517, #D68A2D 55%, #FFD84D)',
          image_path: null,
        }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.ips[0]).toMatchObject({ imagePath: null, imageUrl: '/generated/ip/rilakkuma.png' });
    expect(result.goods[0]).toMatchObject({ imagePath: null, imageUrl: '/generated/goods/g1.png' });
    expect(result.cards[0]).toMatchObject({ imagePath: null, imageUrl: '/generated/cards/c1.png' });
    expect(result.events[0]).toMatchObject({ imagePath: null, imageUrl: '/generated/events/e1.png' });
  });

  /* gradient만 담은 bg는 이미지가 아니다 — 없는 아트워크를 있는 것처럼 만들지 않는다. */
  it('bg가 gradient뿐이면 미리보기를 만들지 않는다', async () => {
    mocks.client = createClient({
      records: [],
      rows: {
        ips: [{ id: 'no-art', bg: 'linear-gradient(150deg, #2A2440, #4A3F73)', image_path: null }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.ips[0]).toMatchObject({ imagePath: null, imageUrl: null });
  });

  it('loads active and archived catalog records with their archived timestamps', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        ips: [
          {
            id: 'active-ip',
            title: '운영 IP',
            sub: null,
            vertical_key: 'webtoon',
            tagline: null,
            synopsis: null,
            glyph: null,
            bg: null,
            image_path: null,
            featured: true,
            fans_count: 3,
            archived_at: null,
          },
          {
            id: 'archived-ip',
            title: '보관 IP',
            sub: null,
            vertical_key: 'webtoon',
            tagline: null,
            synopsis: null,
            glyph: null,
            bg: null,
            image_path: null,
            featured: false,
            fans_count: 0,
            archived_at: '2026-07-17T01:02:03.000Z',
          },
        ],
        goods: [
          {
            id: 'active-good',
            ip_id: 'active-ip',
            name: '운영 굿즈',
            type: '아크릴',
            price: 1000,
            badge: null,
            stock: 'ok',
            stock_qty: 2,
            bg: null,
            image_path: null,
            archived_at: null,
          },
          {
            id: 'archived-good',
            ip_id: 'archived-ip',
            name: '보관 굿즈',
            type: '아크릴',
            price: 1000,
            badge: null,
            stock: 'soldout',
            stock_qty: 0,
            bg: null,
            image_path: null,
            archived_at: '2026-07-17T02:02:03.000Z',
          },
        ],
        cards: [
          {
            id: 'active-card',
            ip_id: 'active-ip',
            pool_id: null,
            name: '운영 카드',
            no: '001',
            rarity: 'N',
            bg: null,
            image_path: null,
            archived_at: null,
          },
          {
            id: 'archived-card',
            ip_id: 'archived-ip',
            pool_id: null,
            name: '보관 카드',
            no: '002',
            rarity: 'R',
            bg: null,
            image_path: null,
            archived_at: '2026-07-17T03:02:03.000Z',
          },
        ],
        events: [
          {
            id: 'active-event',
            ip_id: 'active-ip',
            title: '운영 이벤트',
            mode: '온라인',
            status: '예정',
            starts_at: null,
            ends_at: null,
            location: null,
            accent: null,
            bg: null,
            image_path: null,
            archived_at: null,
          },
          {
            id: 'archived-event',
            ip_id: 'archived-ip',
            title: '보관 이벤트',
            mode: '오프라인',
            status: '종료',
            starts_at: null,
            ends_at: null,
            location: null,
            accent: null,
            bg: null,
            image_path: null,
            archived_at: '2026-07-17T04:02:03.000Z',
          },
        ],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.ips.map(({ id, archivedAt }) => ({ id, archivedAt }))).toEqual([
      { id: 'active-ip', archivedAt: null },
      { id: 'archived-ip', archivedAt: '2026-07-17T01:02:03.000Z' },
    ]);
    expect(result.goods.map(({ id, archivedAt }) => ({ id, archivedAt }))).toEqual([
      { id: 'active-good', archivedAt: null },
      { id: 'archived-good', archivedAt: '2026-07-17T02:02:03.000Z' },
    ]);
    expect(result.cards.map(({ id, archivedAt }) => ({ id, archivedAt }))).toEqual([
      { id: 'active-card', archivedAt: null },
      { id: 'archived-card', archivedAt: '2026-07-17T03:02:03.000Z' },
    ]);
    expect(result.events.map(({ id, archivedAt }) => ({ id, archivedAt }))).toEqual([
      { id: 'active-event', archivedAt: null },
      { id: 'archived-event', archivedAt: '2026-07-17T04:02:03.000Z' },
    ]);

    for (const table of ['ips', 'goods', 'cards', 'events']) {
      expect(records.find((record) => record.table === table)?.select).toContain('archived_at');
    }
  });

  /* 정가는 어드민 폼의 기본값이자 미리보기의 할인 표기 근거다 — 목록 select 에서
     빠지면 운영자가 저장한 할인이 다음 편집에서 조용히 지워진다(#326). */
  it('굿즈 목록에 정가를 싣는다', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        goods: [
          { id: 'on-sale', compare_at_price: 26000 },
          { id: 'not-on-sale', compare_at_price: null },
        ],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(records.find((record) => record.table === 'goods')?.select)
      .toContain('compare_at_price');
    expect(result.goods.map(({ id, compareAtPrice }) => ({ id, compareAtPrice }))).toEqual([
      { id: 'on-sale', compareAtPrice: 26000 },
      { id: 'not-on-sale', compareAtPrice: null },
    ]);
  });

  it('classifies reward-policy status in the required priority order', () => {
    const now = Date.parse('2026-07-15T00:00:00.000Z');
    const activePolicy = {
      active: true,
      activeFrom: '2026-07-14T00:00:00.000Z',
      activeTo: '2026-07-16T00:00:00.000Z',
    };
    const readyPool = {
      activeFrom: '2026-07-14T00:00:00.000Z',
      activeTo: '2026-07-16T00:00:00.000Z',
      ready: true,
    };

    expect(getAdminRewardPolicyStatus({ ...activePolicy, active: false }, null, now)).toBe('inactive');
    expect(getAdminRewardPolicyStatus({
      ...activePolicy,
      activeFrom: '2026-07-16T00:00:00.000Z',
    }, null, now)).toBe('scheduled');
    expect(getAdminRewardPolicyStatus({
      ...activePolicy,
      activeTo: '2026-07-15T00:00:00.000Z',
    }, null, now)).toBe('ended');
    expect(getAdminRewardPolicyStatus(activePolicy, null, now)).toBe('pool-unavailable');
    expect(getAdminRewardPolicyStatus(activePolicy, { ...readyPool, ready: false }, now)).toBe('pool-unavailable');
    expect(getAdminRewardPolicyStatus(activePolicy, {
      ...readyPool,
      activeFrom: '2026-07-16T00:00:00.000Z',
    }, now)).toBe('pool-unavailable');
    expect(getAdminRewardPolicyStatus(activePolicy, readyPool, now)).toBe('active');
  });

  it('classifies game half-open windows and card-pool availability', () => {
    const now = Date.parse('2026-07-15T00:00:00.000Z');
    const activeGame = {
      activeFrom: '2026-07-14T00:00:00.000Z',
      activeTo: '2026-07-16T00:00:00.000Z',
      variantKind: 'card' as const,
    };
    const coveringPool = {
      activeFrom: '2026-07-14T00:00:00.000Z',
      activeTo: '2026-07-16T00:00:00.000Z',
      ready: true,
    };

    expect(getAdminGameStatus({
      ...activeGame,
      activeFrom: '2026-07-15T00:00:00.001Z',
    }, coveringPool, now)).toBe('scheduled');
    expect(getAdminGameStatus({
      ...activeGame,
      activeTo: '2026-07-15T00:00:00.000Z',
    }, coveringPool, now)).toBe('ended');
    expect(getAdminGameStatus(activeGame, { ...coveringPool, ready: false }, now)).toBe('pool-unavailable');
    expect(getAdminGameStatus(activeGame, null, now)).toBe('pool-unavailable');
    expect(getAdminGameStatus(activeGame, coveringPool, now)).toBe('active');
    expect(getAdminGameStatus({ ...activeGame, variantKind: 'goods' }, null, now)).toBe('active');
  });

  it('loads PII-free card and goods game summaries from the staff RPC', async () => {
    const rpcRecords: string[] = [];
    mocks.client = createClient({
      records: [],
      rpcRecords,
      rpcRows: {
        admin_list_games: [
          {
            id: 'marble-maple',
            type: 'marble_roulette',
            title: '메이플 마블 룰렛',
            event_id: 'e2',
            event_title: '메이플 온라인 팝업',
            config: { marbleCount: 10, variant: { kind: 'card', rarityLineup: ['R'] } },
            variant_kind: 'card',
            marble_count: 10,
            reward_pool_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            reward_pool_name: '메이플 풀',
            reward_pool_active_from: '2020-01-01T00:00:00.000Z',
            reward_pool_active_to: null,
            reward_pool_ready: true,
            ip_id: 'maplestory',
            ip_title: '메이플스토리',
            per_user_daily_limit: 2,
            active_from: '2020-01-01T00:00:00.000Z',
            active_to: null,
            created_at: '2026-07-14T00:00:00.000Z',
            updated_at: '2026-07-15T00:00:00.000Z',
            play_count: '12',
            last_played_at: '2026-07-15T01:00:00.000Z',
          },
          {
            id: 'goods-marble',
            type: 'marble_roulette',
            title: '굿즈 마블 룰렛',
            event_id: null,
            event_title: null,
            config: { marbleCount: 10, variant: { kind: 'goods' } },
            variant_kind: 'goods',
            marble_count: 10,
            reward_pool_id: null,
            reward_pool_name: null,
            reward_pool_active_from: null,
            reward_pool_active_to: null,
            reward_pool_ready: false,
            ip_id: null,
            ip_title: null,
            per_user_daily_limit: 1,
            active_from: '2020-01-01T00:00:00.000Z',
            active_to: null,
            created_at: '2026-07-14T00:00:00.000Z',
            updated_at: '2026-07-15T00:00:00.000Z',
            play_count: 0,
            last_played_at: null,
          },
        ],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(rpcRecords).toEqual(['admin_list_reward_policies', 'admin_list_games']);
    expect(result.games).toEqual([
      expect.objectContaining({
        id: 'marble-maple',
        variantKind: 'card',
        marbleCount: 10,
        ipId: 'maplestory',
        playCount: 12,
        hasPlays: true,
        status: 'active',
      }),
      expect.objectContaining({
        id: 'goods-marble',
        variantKind: 'goods',
        rewardPoolId: null,
        playCount: 0,
        hasPlays: false,
        status: 'active',
      }),
    ]);
    expect(result.games[0]).not.toHaveProperty('config');
    expect(result.games[0]).not.toHaveProperty('userId');
    expect(result.games[0]).not.toHaveProperty('result');
  });

  it('loads ticket history counts and maps event titles for the ticket console', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        events: [{
          id: 'e100',
          ip_id: null,
          title: '화산강림 팝업',
          mode: '오프라인',
          status: '예정',
          starts_at: null,
          ends_at: null,
          location: '성수',
          accent: '#8B5CFF',
          bg: null,
          image_path: null,
        }],
        ticket_types: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            event_id: 'e100',
            name: '7월 25일 1회차',
            price: 25000,
            capacity: 80,
            sold: 12,
            tickets: [{ id: '33333333-3333-4333-8333-333333333333' }],
            updated_at: '2026-07-14T12:00:00.000Z',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            event_id: 'missing-event',
            name: '이력 없는 회차',
            price: 0,
            capacity: 0,
            sold: 0,
            tickets: [],
            updated_at: '2026-07-14T13:00:00.000Z',
          },
        ],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.ticketTypes).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        eventId: 'e100',
        eventTitle: '화산강림 팝업',
        name: '7월 25일 1회차',
        price: 25000,
        capacity: 80,
        sold: 12,
        hasTicketHistory: true,
        updatedAt: '2026-07-14T12:00:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        eventId: 'missing-event',
        eventTitle: 'missing-event',
        name: '이력 없는 회차',
        price: 0,
        capacity: 0,
        sold: 0,
        hasTicketHistory: false,
        updatedAt: '2026-07-14T13:00:00.000Z',
      },
    ]);
    expect(records.find((record) => record.table === 'ticket_types')).toEqual({
      table: 'ticket_types',
      select: 'id,event_id,name,price,capacity,sold,updated_at,tickets(id)',
      order: [['event_id', undefined], ['name', undefined]],
      limit: [[1, { referencedTable: 'tickets' }]],
    });
  });

  it('loads card-pool odds and card bindings as a normalized admin record', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        cards: [{
          id: 'c100',
          ip_id: 'hwasan',
          pool_id: '11111111-1111-4111-8111-111111111111',
          name: '청명 홀로 카드',
          no: '001/120',
          rarity: 'HOLO',
          bg: null,
          image_path: null,
        }],
        card_pools: [{
          id: '11111111-1111-4111-8111-111111111111',
          ip_id: 'hwasan',
          name: '화산강림 무상 리워드 풀',
          active_from: '2026-07-15T00:00:00.000Z',
          active_to: null,
          updated_at: '2026-07-15T01:00:00.000Z',
          pool_odds: [
            { rarity: 'R', probability: 0.7 },
            { rarity: 'SSR', probability: 0.2 },
            { rarity: 'HOLO', probability: 0.1 },
          ],
        }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.cards[0]).toMatchObject({
      id: 'c100',
      poolId: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.cardPools).toEqual([{
      id: '11111111-1111-4111-8111-111111111111',
      ipId: 'hwasan',
      name: '화산강림 무상 리워드 풀',
      activeFrom: '2026-07-15T00:00:00.000Z',
      activeTo: null,
      updatedAt: '2026-07-15T01:00:00.000Z',
      status: expect.stringMatching(/^(scheduled|active|ended)$/),
      oddsConfigured: true,
      rewardReady: false,
      odds: { N: 0, R: 0.7, SR: 0, SSR: 0.2, HOLO: 0.1 },
    }]);
    expect(records.find((record) => record.table === 'cards')?.select).toContain('pool_id');
    expect(records.find((record) => record.table === 'card_pools')).toEqual({
      table: 'card_pools',
      select: 'id,ip_id,name,active_from,active_to,updated_at,pool_odds(rarity,probability)',
      order: [['active_from', { ascending: false }], ['name', undefined]],
      limit: [],
    });
  });

  it('keeps an unconfigured card pool distinct from explicit zero odds', async () => {
    mocks.client = createClient({
      records: [],
      rows: {
        card_pools: [{
          id: '11111111-1111-4111-8111-111111111111',
          ip_id: 'hwasan',
          name: '미설정 카드풀',
          active_from: '2026-07-15T00:00:00.000Z',
          active_to: null,
          updated_at: '2026-07-15T01:00:00.000Z',
          pool_odds: [],
        }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.cardPools[0]).toMatchObject({
      oddsConfigured: false,
      rewardReady: false,
      odds: { N: 0, R: 0, SR: 0, SSR: 0, HOLO: 0 },
    });
  });

  it('loads PII-free reward-policy summaries and normalizes numeric aggregates', async () => {
    const rpcRecords: string[] = [];
    mocks.client = createClient({
      records: [],
      rpcRecords,
      rpcRows: {
        admin_list_reward_policies: [{
          id: '11111111-1111-4111-8111-111111111111',
          pool_id: '22222222-2222-4222-8222-222222222222',
          trigger: 'order_paid',
          target_ip_id: 'hwasan',
          target_good_id: 'g100',
          min_amount: '30000',
          tickets_per_grant: 2,
          active: true,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: '2099-01-01T00:00:00.000Z',
          created_at: '2026-07-15T00:00:00.000Z',
          updated_at: '2026-07-15T01:00:00.000Z',
          issued_count: '12',
          available_count: 7,
          opened_count: '4',
          revoked_count: 1,
          order_count: '6',
          last_issued_at: '2026-07-15T02:00:00.000Z',
        }],
      },
      rows: {
        cards: [{
          id: 'c100',
          archived_at: null,
          ip_id: 'lumen',
          pool_id: '22222222-2222-4222-8222-222222222222',
          name: '청명 카드',
          no: '001',
          rarity: 'R',
          bg: null,
          image_path: null,
        }],
        card_pools: [{
          id: '22222222-2222-4222-8222-222222222222',
          ip_id: 'lumen',
          name: '독립 보상 카드풀',
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: '2099-01-01T00:00:00.000Z',
          updated_at: '2026-07-15T01:00:00.000Z',
          pool_odds: [
            { rarity: 'N', probability: '0' },
            { rarity: 'R', probability: '1' },
            { rarity: 'SR', probability: '0' },
            { rarity: 'SSR', probability: '0' },
            { rarity: 'HOLO', probability: '0' },
          ],
        }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(rpcRecords).toEqual(['admin_list_reward_policies', 'admin_list_games']);
    expect(result.cardPools[0]).toMatchObject({
      oddsConfigured: true,
      rewardReady: true,
    });
    expect(result.rewardPolicies).toEqual([{
      id: '11111111-1111-4111-8111-111111111111',
      poolId: '22222222-2222-4222-8222-222222222222',
      trigger: 'order_paid',
      targetIpId: 'hwasan',
      targetGoodId: 'g100',
      minAmount: 30000,
      ticketsPerGrant: 2,
      active: true,
      activeFrom: '2020-01-01T00:00:00.000Z',
      activeTo: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T01:00:00.000Z',
      issuedCount: 12,
      availableCount: 7,
      openedCount: 4,
      revokedCount: 1,
      orderCount: 6,
      lastIssuedAt: '2026-07-15T02:00:00.000Z',
      status: 'active',
    }]);
  });

  it('does not count archived cards toward card-pool reward readiness', async () => {
    mocks.client = createClient({
      records: [],
      rows: {
        cards: [{
          id: 'c100',
          archived_at: '2026-07-17T00:00:00.000Z',
          ip_id: 'lumen',
          pool_id: '22222222-2222-4222-8222-222222222222',
          name: '보관된 R 카드',
          no: '001',
          rarity: 'R',
          bg: null,
          image_path: null,
        }],
        card_pools: [{
          id: '22222222-2222-4222-8222-222222222222',
          ip_id: 'lumen',
          name: '보관 카드만 남은 카드풀',
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: '2099-01-01T00:00:00.000Z',
          updated_at: '2026-07-15T01:00:00.000Z',
          pool_odds: [
            { rarity: 'N', probability: 0 },
            { rarity: 'R', probability: 1 },
            { rarity: 'SR', probability: 0 },
            { rarity: 'SSR', probability: 0 },
            { rarity: 'HOLO', probability: 0 },
          ],
        }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.cardPools[0]).toMatchObject({
      oddsConfigured: true,
      rewardReady: false,
    });
  });

  it('marks a policy pool-unavailable when its current pool has incomplete odds', async () => {
    mocks.client = createClient({
      records: [],
      rpcRows: {
        admin_list_reward_policies: [{
          id: '11111111-1111-4111-8111-111111111111',
          pool_id: '22222222-2222-4222-8222-222222222222',
          trigger: 'order_paid',
          target_ip_id: 'hwasan',
          target_good_id: null,
          min_amount: 0,
          tickets_per_grant: 1,
          active: true,
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: '2099-01-01T00:00:00.000Z',
          created_at: '2026-07-15T00:00:00.000Z',
          updated_at: '2026-07-15T01:00:00.000Z',
          issued_count: 0,
          available_count: 0,
          opened_count: 0,
          revoked_count: 0,
          order_count: 0,
          last_issued_at: null,
        }],
      },
      rows: {
        cards: [
          { id: 'c-r', ip_id: 'lumen', pool_id: '22222222-2222-4222-8222-222222222222', name: 'R', no: null, rarity: 'R', bg: null, image_path: null },
          { id: 'c-ssr', ip_id: 'lumen', pool_id: '22222222-2222-4222-8222-222222222222', name: 'SSR', no: null, rarity: 'SSR', bg: null, image_path: null },
          { id: 'c-holo', ip_id: 'lumen', pool_id: '22222222-2222-4222-8222-222222222222', name: 'HOLO', no: null, rarity: 'HOLO', bg: null, image_path: null },
        ],
        card_pools: [{
          id: '22222222-2222-4222-8222-222222222222',
          ip_id: 'lumen',
          name: '확률 행이 부족한 카드풀',
          active_from: '2020-01-01T00:00:00.000Z',
          active_to: '2099-01-01T00:00:00.000Z',
          updated_at: '2026-07-15T01:00:00.000Z',
          pool_odds: [
            { rarity: 'R', probability: 0.7 },
            { rarity: 'SSR', probability: 0.2 },
            { rarity: 'HOLO', probability: 0.1 },
          ],
        }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(result.rewardPolicies[0].status).toBe('pool-unavailable');
  });

  it('fails closed when the ticket session query fails', async () => {
    mocks.client = createClient({
      errors: { ticket_types: 'ticket query unavailable' },
      records: [],
    });

    await expect(getAdminCatalogRecords()).rejects.toThrow(
      'Failed to load admin ticket types: ticket query unavailable',
    );
  });

  it('fails closed when the card-pool query fails', async () => {
    mocks.client = createClient({
      errors: { card_pools: 'card pool query unavailable' },
      records: [],
    });

    await expect(getAdminCatalogRecords()).rejects.toThrow(
      'Failed to load admin card pools: card pool query unavailable',
    );
  });

  it('fails closed when the reward-policy summary RPC fails', async () => {
    mocks.client = createClient({
      records: [],
      rpcErrors: { admin_list_reward_policies: 'policy summary unavailable' },
    });

    await expect(getAdminCatalogRecords()).rejects.toThrow(
      'Failed to load admin reward policies: policy summary unavailable',
    );
  });

  it('fails closed when the game summary RPC fails', async () => {
    mocks.client = createClient({
      records: [],
      rpcErrors: { admin_list_games: 'game summary unavailable' },
    });

    await expect(getAdminCatalogRecords()).rejects.toThrow(
      'Failed to load admin games: game summary unavailable',
    );
  });
  /*
   * 화면별 라우트가 갈라지기 전에는 어떤 화면을 열어도 8종 쿼리가 전부 나갔다.
   * include는 그 낭비를 막는 계약이므로 "요청하지 않은 테이블은 건드리지 않는다"를 고정한다.
   */
  it('include에 없는 종류는 쿼리하지 않는다', async () => {
    const records: QueryRecord[] = [];
    const rpcRecords: string[] = [];
    mocks.client = createClient({ records, rpcRecords, rows: { ips: [{ id: 'hwasan' }] } });

    const result = await getAdminCatalogRecords({ include: ['ips'] });

    expect(records.map((record) => record.table)).toEqual(['ips']);
    expect(rpcRecords).toEqual([]);
    expect(result.ips).toHaveLength(1);
    expect(result.goods).toEqual([]);
    expect(result.cards).toEqual([]);
    expect(result.cardPools).toEqual([]);
    expect(result.rewardPolicies).toEqual([]);
    expect(result.games).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.ticketTypes).toEqual([]);
  });

  /* include를 생략한 호출부(레거시 어드민 페이지)가 조용히 빈 화면이 되지 않아야 한다. */
  it('include를 생략하면 8종을 모두 조회해 돌려준다', async () => {
    const records: QueryRecord[] = [];
    const rpcRecords: string[] = [];
    mocks.client = createClient({
      records,
      rpcRecords,
      rows: {
        ips: [{ id: 'hwasan' }],
        goods: [{ id: 'g1', ip_id: 'hwasan' }],
        cards: [{ id: 'c1', ip_id: 'hwasan', pool_id: null, rarity: 'N' }],
        card_pools: [{
          id: '11111111-1111-4111-8111-111111111111',
          ip_id: 'hwasan',
          name: '풀',
          active_from: '2026-07-15T00:00:00.000Z',
          active_to: null,
          updated_at: '2026-07-15T00:00:00.000Z',
          pool_odds: [],
        }],
        events: [{ id: 'e1', title: '화산강림 팝업' }],
        ticket_types: [{ id: 't1', event_id: 'e1', name: '1회차', price: 0, capacity: 1, sold: 0 }],
      },
      rpcRows: {
        admin_list_reward_policies: [{
          id: 'p1',
          pool_id: '11111111-1111-4111-8111-111111111111',
          trigger: 'order_paid',
          target_ip_id: 'hwasan',
          target_good_id: null,
          min_amount: 0,
          tickets_per_grant: 1,
          active: false,
          active_from: '2026-07-15T00:00:00.000Z',
          active_to: null,
          created_at: '2026-07-15T00:00:00.000Z',
          updated_at: '2026-07-15T00:00:00.000Z',
          issued_count: 0,
          available_count: 0,
          opened_count: 0,
          revoked_count: 0,
          order_count: 0,
          last_issued_at: null,
        }],
        admin_list_games: [{
          id: 'game-1',
          type: 'marble_roulette',
          title: '마블',
          variant_kind: 'goods',
          per_user_daily_limit: 1,
          active_from: '2026-07-15T00:00:00.000Z',
          active_to: null,
          created_at: '2026-07-15T00:00:00.000Z',
          updated_at: '2026-07-15T00:00:00.000Z',
          play_count: 0,
        }],
      },
    });

    const result = await getAdminCatalogRecords();

    expect(records.map((record) => record.table).sort()).toEqual([
      'card_pools',
      'cards',
      'events',
      'goods',
      'ips',
      'ticket_types',
    ]);
    expect(rpcRecords.sort()).toEqual(['admin_list_games', 'admin_list_reward_policies']);
    expect(Object.entries(result).every(([, value]) => value.length === 1)).toBe(true);
  });

  /*
   * 파생값이 다른 종류의 행을 본다 — 티켓 회차 제목은 events, 정책 status는 카드풀(과 그 카드)이다.
   * include를 곧이곧대로 따르면 화면은 조용히 틀린 값(제목 대신 id, 전부 pool-unavailable)을 본다.
   */
  it('파생에 필요한 종류는 조회하되 반환하지는 않는다', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        events: [{ id: 'e1', title: '화산강림 팝업' }],
        ticket_types: [{ id: 't1', event_id: 'e1', name: '1회차', price: 0, capacity: 1, sold: 0 }],
      },
    });

    const result = await getAdminCatalogRecords({ include: ['ticketTypes'] });

    expect(records.map((record) => record.table).sort()).toEqual(['events', 'ticket_types']);
    expect(result.ticketTypes[0].eventTitle).toBe('화산강림 팝업');
    expect(result.events).toEqual([]);
  });

  it('카드풀만 요청해도 카드로 계산하는 rewardReady를 유지한다', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        cards: [
          { id: 'c1', ip_id: 'hwasan', pool_id: 'pool-1', rarity: 'R', archived_at: null },
          { id: 'c2', ip_id: 'hwasan', pool_id: 'pool-1', rarity: 'SSR', archived_at: null },
          { id: 'c3', ip_id: 'hwasan', pool_id: 'pool-1', rarity: 'HOLO', archived_at: null },
        ],
        card_pools: [{
          id: 'pool-1',
          ip_id: 'hwasan',
          name: '풀',
          active_from: '2026-07-15T00:00:00.000Z',
          active_to: null,
          updated_at: '2026-07-15T00:00:00.000Z',
          pool_odds: [
            { rarity: 'N', probability: 0 },
            { rarity: 'R', probability: 0.7 },
            { rarity: 'SR', probability: 0 },
            { rarity: 'SSR', probability: 0.2 },
            { rarity: 'HOLO', probability: 0.1 },
          ],
        }],
      },
    });

    const result = await getAdminCatalogRecords({ include: ['cardPools'] });

    expect(records.map((record) => record.table).sort()).toEqual(['card_pools', 'cards']);
    expect(result.cardPools[0].rewardReady).toBe(true);
    expect(result.cards).toEqual([]);
  });
});
