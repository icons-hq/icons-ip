import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAdminCardPoolStatus,
  getAdminCatalogRecords,
  getAdminGameStatus,
  getAdminRewardPolicyStatus,
} from './catalog.server';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('server-only', () => ({}));
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
});
