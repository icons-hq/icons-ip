import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  serviceConfigured: true,
  supabaseConfigured: true,
  rows: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  records: [] as Array<{
    table: string;
    select?: string;
    eq: Array<[string, unknown]>;
    in: Array<[string, unknown[]]>;
    limit?: number;
  }>,
  toBuffer: vi.fn(),
}));

vi.mock('qrcode', () => ({ toBuffer: mocks.toBuffer }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: (profile: { onboarded_at?: unknown } | null) => Boolean(profile?.onboarded_at),
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.supabaseConfigured }),
}));
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleConfig: () => ({ isConfigured: mocks.serviceConfigured }),
  createServiceClient: () => ({
    from(table: string) {
      const record = {
        table,
        eq: [] as Array<[string, unknown]>,
        in: [] as Array<[string, unknown[]]>,
      };
      mocks.records.push(record);
      const query = {
        select(columns: string) {
          Object.assign(record, { select: columns });
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
        limit(value: number) {
          Object.assign(record, { limit: value });
          return query;
        },
        maybeSingle() {
          return Promise.resolve(mocks.rows[table] ?? { data: null, error: null });
        },
      };
      return query;
    },
  }),
}));
vi.mock('@/lib/ticketing', () => ({
  normalizeTicketReference: (value: unknown) => (
    typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
      ? value.trim().toLowerCase()
      : null
  ),
}));

import { GET } from './route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TICKET_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';

function request(id = TICKET_ID) {
  return GET(
    new Request(`https://icons.local/api/tickets/${id}/qr`),
    { params: Promise.resolve({ ticketId: id }) },
  );
}

beforeEach(() => {
  mocks.auth = {
    isConfigured: true,
    user: { id: USER_ID, email: 'fan@example.test' },
    profile: {
      email: 'fan@example.test',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true, marketing: false },
      onboarded_at: '2026-07-14T00:00:00.000Z',
      role: 'user',
    },
    isStaff: false,
  };
  mocks.serviceConfigured = true;
  mocks.supabaseConfigured = true;
  mocks.rows = {
    tickets: {
      data: {
        id: TICKET_ID,
        ticket_order_id: ORDER_ID,
        status: 'valid',
        qr_token: 'private-qr-token',
        ticket_orders: { user_id: USER_ID, status: 'paid' },
      },
      error: null,
    },
    ticket_cancellation_requests: { data: null, error: null },
  };
  mocks.records = [];
  mocks.toBuffer.mockReset();
  mocks.toBuffer.mockResolvedValue(Buffer.from([137, 80, 78, 71, 1, 2, 3]));
});

describe('GET /api/tickets/[ticketId]/qr', () => {
  it('returns a private no-store PNG for an onboarded owner with a paid valid ticket', async () => {
    const response = await request();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    );
    expect(mocks.toBuffer).toHaveBeenCalledWith('private-qr-token', {
      color: { dark: '#05050AFF', light: '#FFFFFFFF' },
      errorCorrectionLevel: 'M',
      margin: 4,
      type: 'png',
      width: 288,
    });
    expect(mocks.records[0]).toMatchObject({
      table: 'tickets',
      select: 'id,ticket_order_id,status,qr_token,ticket_orders!inner(user_id,status)',
      eq: [['id', TICKET_ID], ['ticket_orders.user_id', USER_ID]],
    });
    expect(mocks.records[1]).toMatchObject({
      table: 'ticket_cancellation_requests',
      select: 'id',
      eq: [['ticket_order_id', ORDER_ID]],
      in: [['status', ['requested', 'processing', 'needs_review']]],
      limit: 1,
    });
  });

  it('fails closed before reading a QR when configuration, auth, or onboarding is missing', async () => {
    mocks.serviceConfigured = false;
    await expect(request()).resolves.toMatchObject({ status: 503 });
    expect(mocks.records).toHaveLength(0);

    mocks.serviceConfigured = true;
    mocks.auth = { ...mocks.auth as object, user: null, profile: null };
    await expect(request()).resolves.toMatchObject({ status: 401 });
    expect(mocks.records).toHaveLength(0);

    mocks.auth = {
      ...mocks.auth as object,
      user: { id: USER_ID, email: 'fan@example.test' },
      profile: null,
    };
    await expect(request()).resolves.toMatchObject({ status: 403 });
    expect(mocks.records).toHaveLength(0);
  });

  it('uses the same not-found response for malformed, foreign, non-paid, and non-valid tickets', async () => {
    await expect(request('not-a-uuid')).resolves.toMatchObject({ status: 404 });

    mocks.rows.tickets = { data: null, error: null };
    await expect(request()).resolves.toMatchObject({ status: 404 });

    mocks.rows.tickets = {
      data: {
        id: TICKET_ID,
        ticket_order_id: ORDER_ID,
        status: 'valid',
        qr_token: 'private-qr-token',
        ticket_orders: { user_id: USER_ID, status: 'canceled' },
      },
      error: null,
    };
    await expect(request()).resolves.toMatchObject({ status: 404 });

    mocks.rows.tickets = {
      data: {
        id: TICKET_ID,
        ticket_order_id: ORDER_ID,
        status: 'used',
        qr_token: 'private-qr-token',
        ticket_orders: { user_id: USER_ID, status: 'paid' },
      },
      error: null,
    };
    await expect(request()).resolves.toMatchObject({ status: 404 });
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });

  it('does not render a QR while a cancellation request is active', async () => {
    mocks.rows.ticket_cancellation_requests = {
      data: { id: '44444444-4444-4444-8444-444444444444' },
      error: null,
    };

    const response = await request();

    expect(response.status).toBe(404);
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });

  it('returns a safe upstream error when private state or QR rendering fails', async () => {
    mocks.rows.tickets = { data: null, error: { message: 'private database detail' } };
    await expect(request()).resolves.toMatchObject({ status: 502 });

    mocks.rows.tickets = {
      data: {
        id: TICKET_ID,
        ticket_order_id: ORDER_ID,
        status: 'valid',
        qr_token: 'private-qr-token',
        ticket_orders: { user_id: USER_ID, status: 'paid' },
      },
      error: null,
    };
    mocks.toBuffer.mockRejectedValueOnce(new Error('renderer internals'));
    const response = await request();
    await expect(response.json()).resolves.toEqual({ error: { code: 'qr_unavailable' } });
    expect(response.status).toBe(500);
  });
});
