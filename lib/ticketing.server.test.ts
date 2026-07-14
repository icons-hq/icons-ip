import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listTicketOrders,
  loadPublicTicketTypes,
  loadTicketOrder,
  loadTicketOrderDetail,
} from './ticketing.server';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | Row | null; error: { message: string } | null };

interface QueryRecord {
  table: string;
  select?: string;
  eq: [string, unknown][];
  in: [string, unknown[]][];
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
  const record: QueryRecord = { table, eq: [], in: [], order: [], maybeSingle: false };
  options.records.push(record);

  const resolve = (): QueryResult => {
    const message = options.errors?.[table];
    if (message) return { data: null, error: { message } };

    let rows = [...(options.rows[table] ?? [])];
    for (const [column, value] of record.eq) rows = rows.filter((row) => row[column] === value);
    for (const [column, values] of record.in) rows = rows.filter((row) => values.includes(row[column]));
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
    in(column: string, values: unknown[]) {
      record.in.push([column, values]);
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

describe('my ticket orders', () => {
  const secondOrderId = '6dc4cafe-313e-4787-9c10-2333c5e0fced';
  const paymentId = '9ecfe3bc-7d87-4f1b-9155-3c0f833a83fb';

  function historyRows(): Record<string, Row[]> {
    return {
      ticket_orders: [{
        id: ticketOrderId,
        user_id: userId,
        event_id: eventId,
        status: 'paid',
        total: 44000,
        created_at: '2026-07-15T02:00:00.000Z',
      }, {
        id: secondOrderId,
        user_id: userId,
        event_id: 'rinne-popup',
        status: 'pending',
        total: 19000,
        created_at: '2026-07-14T02:00:00.000Z',
      }],
      tickets: [{
        id: '19b0d848-7192-4b40-a675-f508822f99c9',
        ticket_order_id: ticketOrderId,
        ticket_type_id: ticketTypeId,
        status: 'valid',
        qr_token: 'must-not-leak',
      }, {
        id: '2ab1e959-8203-4c51-b786-0619933a00da',
        ticket_order_id: ticketOrderId,
        ticket_type_id: ticketTypeId,
        status: 'valid',
        qr_token: 'must-not-leak',
      }, {
        id: '3bc2fa6a-9314-4d62-8797-1720a44b11eb',
        ticket_order_id: secondOrderId,
        ticket_type_id: '8be5d078-4e59-4f8b-a776-75842bd44073',
        status: 'valid',
      }],
      ticket_types: [{
        id: ticketTypeId,
        event_id: eventId,
        name: '7월 25일 오후 회차',
      }, {
        id: '8be5d078-4e59-4f8b-a776-75842bd44073',
        event_id: 'rinne-popup',
        name: '8월 2일 오전 회차',
      }],
      events: [{
        id: eventId,
        title: '메이플 팝업',
        starts_at: '2026-07-25T05:00:00.000Z',
        ends_at: '2026-07-25T08:00:00.000Z',
        location: '성수 ICONS 팝업',
      }, {
        id: 'rinne-popup',
        title: '린네 팝업',
        starts_at: null,
        ends_at: null,
        location: null,
      }],
      payments: [{
        id: paymentId,
        user_id: userId,
        purpose: 'ticket',
        ref_id: ticketOrderId,
        amount: 44000,
        status: 'paid',
        created_at: '2026-07-15T02:01:00.000Z',
        payment_key: 'must-not-leak',
        raw: { secret: true },
      }],
      ticket_cancellation_requests: [{
        id: '40d30b7b-a425-4e73-98a8-2831b55c22fc',
        ticket_order_id: secondOrderId,
        source: 'user',
        status: 'requested',
        policy_code: 'event_start_full_refund_v1',
        cutoff_at: '2026-08-02T01:00:00.000Z',
        gross_amount: 19000,
        fee_amount: 0,
        refund_amount: 19000,
        requested_at: '2026-07-15T02:30:00.000Z',
        completed_at: null,
        updated_at: '2026-07-15T02:30:00.000Z',
        attempt_token: 'must-not-leak',
        last_error_code: 'must-not-leak',
      }],
      refunds: [{
        payment_id: paymentId,
        amount: 44000,
        status: 'done',
        created_at: '2026-07-15T02:40:00.000Z',
        reason: 'private reason',
      }],
    };
  }

  it('batch-loads only owner-scoped, browser-safe list fields', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({ records, rows: historyRows() });

    const result = await listTicketOrders(userId);

    expect(result).toEqual([{
      id: ticketOrderId,
      eventId,
      eventTitle: '메이플 팝업',
      ticketTypeId,
      ticketTypeName: '7월 25일 오후 회차',
      qty: 2,
      total: 44000,
      status: 'paid',
      paymentStatus: 'paid',
      createdAt: '2026-07-15T02:00:00.000Z',
      startsAt: '2026-07-25T05:00:00.000Z',
      endsAt: '2026-07-25T08:00:00.000Z',
      location: '성수 ICONS 팝업',
      ticketStatuses: ['valid', 'valid'],
      cancellationRequest: null,
      refund: { status: 'done', amount: 44000, createdAt: '2026-07-15T02:40:00.000Z' },
    }, {
      id: secondOrderId,
      eventId: 'rinne-popup',
      eventTitle: '린네 팝업',
      ticketTypeId: '8be5d078-4e59-4f8b-a776-75842bd44073',
      ticketTypeName: '8월 2일 오전 회차',
      qty: 1,
      total: 19000,
      status: 'pending',
      paymentStatus: null,
      createdAt: '2026-07-14T02:00:00.000Z',
      startsAt: null,
      endsAt: null,
      location: null,
      ticketStatuses: ['valid'],
      cancellationRequest: {
        status: 'requested',
        requestedAt: '2026-07-15T02:30:00.000Z',
        completedAt: null,
        grossAmount: 19000,
        feeAmount: 0,
        refundAmount: 19000,
      },
      refund: null,
    }]);

    expect(records[0]).toMatchObject({
      table: 'ticket_orders',
      select: 'id,user_id,event_id,status,total,created_at',
      eq: [['user_id', userId]],
      order: [['created_at', { ascending: false }], ['id', { ascending: false }]],
    });
    expect(records.find((record) => record.table === 'tickets')).toMatchObject({
      select: 'id,ticket_order_id,ticket_type_id,status',
      in: [['ticket_order_id', [ticketOrderId, secondOrderId]]],
    });
    expect(records.find((record) => record.table === 'payments')).toMatchObject({
      select: 'id,user_id,ref_id,amount,status,created_at',
      eq: [['user_id', userId], ['purpose', 'ticket']],
      in: [['ref_id', [ticketOrderId, secondOrderId]]],
    });
    expect(records.find((record) => record.table === 'ticket_cancellation_requests')).toMatchObject({
      select: 'id,ticket_order_id,source,status,policy_code,cutoff_at,gross_amount,fee_amount,refund_amount,requested_at,completed_at,updated_at',
      in: [['ticket_order_id', [ticketOrderId, secondOrderId]]],
    });
    expect(JSON.stringify(records)).not.toMatch(/qr_token|payment_key|raw|attempt_token|last_error_code|requested_by|reason/);
    expect(JSON.stringify(result)).not.toMatch(/qr_token|payment_key|raw|attempt_token|last_error_code|requested_by|reason/);
  });

  it('returns an owner detail with per-ticket safe state and fails closed on mixed types', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({ records, rows: historyRows() });

    await expect(loadTicketOrderDetail(userId, ticketOrderId)).resolves.toEqual({
      id: ticketOrderId,
      eventId,
      eventTitle: '메이플 팝업',
      ticketTypeId,
      ticketTypeName: '7월 25일 오후 회차',
      qty: 2,
      total: 44000,
      status: 'paid',
      paymentStatus: 'paid',
      createdAt: '2026-07-15T02:00:00.000Z',
      startsAt: '2026-07-25T05:00:00.000Z',
      endsAt: '2026-07-25T08:00:00.000Z',
      location: '성수 ICONS 팝업',
      tickets: [
        { id: '19b0d848-7192-4b40-a675-f508822f99c9', status: 'valid' },
        { id: '2ab1e959-8203-4c51-b786-0619933a00da', status: 'valid' },
      ],
      cancellationRequest: null,
      refund: { status: 'done', amount: 44000, createdAt: '2026-07-15T02:40:00.000Z' },
    });

    expect(records[0]).toMatchObject({
      table: 'ticket_orders',
      select: 'id,user_id,event_id,status,total,created_at',
      eq: [['id', ticketOrderId], ['user_id', userId]],
      maybeSingle: true,
    });
    expect(JSON.stringify(records)).not.toMatch(/qr_token|payment_key|raw|attempt_token|last_error_code|requested_by|reason/);

    const inconsistent = historyRows();
    inconsistent.tickets[1].ticket_type_id = '8be5d078-4e59-4f8b-a776-75842bd44073';
    mocks.client = createClient({ records: [], rows: inconsistent });
    await expect(loadTicketOrderDetail(userId, ticketOrderId)).resolves.toBeNull();
  });

  it('keeps the safe refund summary when a different payment attempt is newer', async () => {
    const records: QueryRecord[] = [];
    const data = historyRows();
    data.payments.push({
      id: 'af10f4cd-8e98-402c-a266-4d10844b940c',
      user_id: userId,
      purpose: 'ticket',
      ref_id: ticketOrderId,
      amount: 44000,
      status: 'failed',
      created_at: '2026-07-15T02:50:00.000Z',
    });
    mocks.client = createClient({ records, rows: data });

    const [result] = await listTicketOrders(userId);

    expect(result.paymentStatus).toBe('failed');
    expect(result.refund).toEqual({
      status: 'done',
      amount: 44000,
      createdAt: '2026-07-15T02:40:00.000Z',
    });
  });

  it('uses the latest cancellation ledger entry deterministically', async () => {
    const data = historyRows();
    data.ticket_cancellation_requests.push({
      id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
      ticket_order_id: secondOrderId,
      source: 'user',
      status: 'completed',
      policy_code: 'event_start_full_refund_v1',
      cutoff_at: '2026-08-02T01:00:00.000Z',
      gross_amount: 19000,
      fee_amount: 0,
      refund_amount: 19000,
      requested_at: '2026-07-14T01:00:00.000Z',
      completed_at: '2026-07-14T01:30:00.000Z',
      updated_at: '2026-07-14T01:30:00.000Z',
    });
    mocks.client = createClient({ records: [], rows: data });

    const result = await listTicketOrders(userId);

    expect(result[1].cancellationRequest?.status).toBe('requested');
    expect(result[1].cancellationRequest?.requestedAt).toBe('2026-07-15T02:30:00.000Z');
  });

  it('returns null before child queries for a foreign or missing detail', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({ records, rows: historyRows() });

    await expect(loadTicketOrderDetail('another-user', ticketOrderId)).resolves.toBeNull();
    expect(records.map((record) => record.table)).toEqual(['ticket_orders']);
  });
});
