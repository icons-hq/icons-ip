import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminCatalogRecords } from './catalog.server';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };

interface QueryRecord {
  table: string;
  select: string | null;
  order: Array<[string, { ascending?: boolean } | undefined]>;
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
      const record: QueryRecord = { table, select: null, order: [] };
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
            tickets: [{ count: 14 }],
            updated_at: '2026-07-14T12:00:00.000Z',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            event_id: 'missing-event',
            name: '이력 없는 회차',
            price: 0,
            capacity: 0,
            sold: 0,
            tickets: [{ count: 0 }],
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
      select: 'id,event_id,name,price,capacity,sold,updated_at,tickets(count)',
      order: [['event_id', undefined], ['name', undefined]],
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
});
