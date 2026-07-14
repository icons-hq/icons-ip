import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPublicTicketTypes, loadTicketOrder } from './ticketing.server';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | Row | null; error: { message: string } | null };

interface QueryRecord {
  table: string;
  select?: string;
  eq: [string, unknown][];
  order: [string, { ascending?: boolean } | undefined][];
  limit?: number;
  maybeSingle: boolean;
}

interface ClientOptions {
  errors?: Partial<Record<string, string>>;
  records: QueryRecord[];
  rows: Record<string, Row[]>;
}

function createQuery(table: string, options: ClientOptions) {
  const record: QueryRecord = { table, eq: [], order: [], maybeSingle: false };
  options.records.push(record);

  const resolve = (): QueryResult => {
    const message = options.errors?.[table];
    if (message) return { data: null, error: { message } };

    let rows = [...(options.rows[table] ?? [])];
    for (const [column, value] of record.eq) rows = rows.filter((row) => row[column] === value);
    for (const [column, settings] of record.order) {
      rows.sort((left, right) => {
        const direction = settings?.ascending === false ? -1 : 1;
        return direction * String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
      });
    }
    if (record.limit !== undefined) rows = rows.slice(0, record.limit);

    return { data: record.maybeSingle ? rows[0] ?? null : rows, error: null };
  };

  const query = {
    select(columns: string) {
      record.select = columns;
      return query;
    },
    eq(column: string, value: unknown) {
      record.eq.push([column, value]);
      return query;
    },
    order(column: string, settings?: { ascending?: boolean }) {
      record.order.push([column, settings]);
      return query;
    },
    limit(value: number) {
      record.limit = value;
      return query;
    },
    maybeSingle() {
      record.maybeSingle = true;
      return Promise.resolve(resolve());
    },
    then<TResult1 = QueryResult, TResult2 = never>(
      onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function createClient(options: ClientOptions) {
  return {
    from(table: string) {
      return createQuery(table, options);
    },
  };
}

const eventId = 'maple-popup';
const ticketTypeId = '7ad4c967-3d48-44da-a665-64731ac33f62';
const ticketOrderId = '5cbcbfed-202d-4676-821a-7706398e57c0';
const userId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';

beforeEach(() => {
  mocks.client = null;
});

describe('loadPublicTicketTypes', () => {
  it('returns only public session fields with pending-inclusive remaining capacity', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        ticket_types: [{
          id: ticketTypeId,
          event_id: eventId,
          name: '7월 25일 오후 회차',
          price: 22000,
          capacity: 25,
          sold: 7,
          per_user_limit: 4,
          sales_open_at: '2026-07-20T00:00:00.000Z',
        }, {
          id: '8be5d078-4e59-4f8b-a776-75842bd44073',
          event_id: eventId,
          name: '마감 회차',
          price: 18000,
          capacity: 10,
          sold: 12,
        }],
      },
    });

    await expect(loadPublicTicketTypes(eventId)).resolves.toEqual([{
      id: ticketTypeId,
      eventId,
      name: '7월 25일 오후 회차',
      price: 22000,
      capacity: 25,
      sold: 7,
      remaining: 18,
    }, {
      id: '8be5d078-4e59-4f8b-a776-75842bd44073',
      eventId,
      name: '마감 회차',
      price: 18000,
      capacity: 10,
      sold: 12,
      remaining: 0,
    }]);

    expect(records[0]).toMatchObject({
      table: 'ticket_types',
      select: 'id,event_id,name,price,capacity,sold',
      eq: [['event_id', eventId]],
      order: [['name', undefined], ['id', undefined]],
    });
    expect(JSON.stringify(await loadPublicTicketTypes(eventId))).not.toMatch(/per_user_limit|sales_open_at|qr_token/);
  });

  it('throws on query failure instead of rendering a false empty state', async () => {
    mocks.client = createClient({
      records: [],
      rows: {},
      errors: { ticket_types: 'private network detail' },
    });

    await expect(loadPublicTicketTypes(eventId)).rejects.toThrow('Failed to load public ticket types');
  });
});

describe('loadTicketOrder', () => {
  function rows(): Record<string, Row[]> {
    return {
      ticket_orders: [{
        id: ticketOrderId,
        user_id: userId,
        event_id: eventId,
        status: 'pending',
        total: 44000,
        expires_at: '2026-07-14T12:10:00.000Z',
      }],
      tickets: [{
        ticket_order_id: ticketOrderId,
        ticket_type_id: ticketTypeId,
        qr_token: 'must-not-leak',
      }, {
        ticket_order_id: ticketOrderId,
        ticket_type_id: ticketTypeId,
        qr_token: 'must-not-leak-either',
      }],
      ticket_types: [{
        id: ticketTypeId,
        event_id: eventId,
        name: '7월 25일 오후 회차',
        price: 999999,
        per_user_limit: 4,
        sales_open_at: null,
      }],
      events: [{ id: eventId, title: '메이플 팝업' }],
      payments: [{
        purpose: 'ticket',
        ref_id: ticketOrderId,
        status: 'failed',
        created_at: '2026-07-14T11:59:00.000Z',
        payment_key: 'must-not-leak',
        raw: { cardNumber: 'must-not-leak' },
      }, {
        purpose: 'ticket',
        ref_id: ticketOrderId,
        status: 'pending',
        created_at: '2026-07-14T12:00:00.000Z',
        payment_key: 'must-not-leak',
      }],
    };
  }

  it('loads an owner-scoped order using only safe ticket and payment fields', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({ records, rows: rows() });

    await expect(loadTicketOrder(userId, ticketOrderId)).resolves.toEqual({
      id: ticketOrderId,
      eventId,
      eventTitle: '메이플 팝업',
      ticketTypeId,
      ticketTypeName: '7월 25일 오후 회차',
      qty: 2,
      total: 44000,
      status: 'pending',
      paymentStatus: 'pending',
      expiresAt: '2026-07-14T12:10:00.000Z',
    });

    expect(records.find((record) => record.table === 'ticket_orders')).toMatchObject({
      select: 'id,user_id,event_id,status,total,expires_at',
      eq: [['id', ticketOrderId], ['user_id', userId]],
      maybeSingle: true,
    });
    expect(records.find((record) => record.table === 'tickets')).toMatchObject({
      select: 'ticket_type_id',
      eq: [['ticket_order_id', ticketOrderId]],
    });
    expect(records.find((record) => record.table === 'payments')).toMatchObject({
      select: 'status',
      eq: [['purpose', 'ticket'], ['ref_id', ticketOrderId]],
      order: [['created_at', { ascending: false }]],
      limit: 1,
      maybeSingle: true,
    });
    expect(JSON.stringify(records)).not.toMatch(/qr_token|payment_key|raw|per_user_limit|sales_open_at/);
  });

  it('returns null without querying child records when the order is not owned by the viewer', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({ records, rows: rows() });

    await expect(loadTicketOrder('another-user', ticketOrderId)).resolves.toBeNull();
    expect(records.map((record) => record.table)).toEqual(['ticket_orders']);
  });

  it('fails closed when placeholder tickets disagree on their ticket type', async () => {
    const records: QueryRecord[] = [];
    const inconsistent = rows();
    inconsistent.tickets[1].ticket_type_id = '8be5d078-4e59-4f8b-a776-75842bd44073';
    mocks.client = createClient({ records, rows: inconsistent });

    await expect(loadTicketOrder(userId, ticketOrderId)).resolves.toBeNull();
  });

  it('throws on owned-order query failures instead of returning a false not-found result', async () => {
    mocks.client = createClient({
      records: [],
      rows: rows(),
      errors: { payments: 'private payment error' },
    });

    await expect(loadTicketOrder(userId, ticketOrderId)).rejects.toThrow('Failed to load ticket order payment');
  });
});
