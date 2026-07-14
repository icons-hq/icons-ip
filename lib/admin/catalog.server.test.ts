import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminCardPoolStatus, getAdminCatalogRecords } from './catalog.server';

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
  rows = {},
}: {
  errors?: Record<string, string>;
  records: QueryRecord[];
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
      odds: { N: 0, R: 0, SR: 0, SSR: 0, HOLO: 0 },
    });
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
});
