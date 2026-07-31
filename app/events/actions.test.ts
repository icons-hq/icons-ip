import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { reserveTicketsAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  from: vi.fn(),
  serviceRpc: vi.fn(),
  eligibility: {
    data: {
      id: '7ad4c967-3d48-44da-a665-64731ac33f62',
      price: 22000,
      events: { status: '예매중' },
    } as unknown,
    error: null as { message: string } | null,
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/ticketing', async () => await import('../../lib/ticketing'));
vi.mock('@/lib/payments/config', async () => await import('../../lib/payments/config'));
vi.mock('@/lib/payments/checkout-availability', async () => (
  await import('../../lib/payments/checkout-availability')
));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ from: mocks.from }),
}));
/* getServiceRoleConfig는 호출 시점에 env를 읽는다. 실제 구현을 남겨야
   SUPABASE_SERVICE_ROLE_KEY를 비우는 "결제 불가" 테스트가 의미를 갖는다. */
vi.mock('@/lib/supabase/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/service')>()),
  createServiceClient: () => ({ rpc: mocks.serviceRpc }),
}));

const ticketTypeId = '7ad4c967-3d48-44da-a665-64731ac33f62';
const reservationKey = '5cbcbfed-202d-4676-821a-7706398e57c0';
const ticketOrderId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';
const input = { ticketTypeId, qty: 2, reservationKey };

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
    },
    isStaff: false,
  };
}

function eligibilityQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve(mocks.eligibility)),
  };
  return query;
}

describe('reserveTicketsAction', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.auth = onboardedAuth();
    mocks.from.mockReset();
    mocks.serviceRpc.mockReset();
    mocks.eligibility = {
      data: { id: ticketTypeId, price: 22000, events: { status: '예매중' } },
      error: null,
    };
    mocks.from.mockImplementation(() => eligibilityQuery());
    mocks.serviceRpc.mockResolvedValue({ data: ticketOrderId, error: null });
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', 'test_gck_example');
    vi.stubEnv('TOSS_SECRET_KEY', 'test_gsk_example');
  });

  it('checks current paid booking eligibility before calling the exact idempotent RPC', async () => {
    const query = eligibilityQuery();
    mocks.from.mockReturnValue(query);

    await expect(reserveTicketsAction(input)).resolves.toEqual({ ok: true, orderId: ticketOrderId });

    expect(mocks.from).toHaveBeenCalledWith('ticket_types');
    expect(query.select).toHaveBeenCalledWith('id,price,events!inner(status)');
    expect(query.eq).toHaveBeenCalledWith('id', ticketTypeId);
    expect(mocks.serviceRpc).toHaveBeenCalledWith('reserve_tickets', {
      p_ticket_type_id: ticketTypeId,
      p_qty: 2,
      p_reservation_key: reservationKey,
      p_user_id: 'user-1',
    });
  });

  it('rejects malformed or browser-priced input before reading or writing', async () => {
    await expect(reserveTicketsAction({ ...input, amount: 1 })).resolves.toEqual({
      ok: false,
      error: 'invalid_request',
    });
    await expect(reserveTicketsAction({ ...input, qty: '2' })).resolves.toEqual({
      ok: false,
      error: 'invalid_request',
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it('requires authentication and completed onboarding before any reservation query', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(reserveTicketsAction(input)).resolves.toEqual({
      ok: false,
      error: 'auth_required',
    });

    mocks.auth = { ...onboardedAuth(), profile: null };
    await expect(reserveTicketsAction(input)).resolves.toEqual({
      ok: false,
      error: 'onboarding_required',
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it('rejects a suspended account before eligibility or capacity reads', async () => {
    mocks.auth = {
      ...onboardedAuth(),
      profile: {
        ...onboardedAuth().profile,
        suspended_at: '2026-07-17T00:00:00.000Z',
      },
    };

    await expect(reserveTicketsAction(input)).resolves.toEqual({
      ok: false,
      error: 'account_suspended',
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it('fails closed before reserving capacity when settlement is unavailable', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    await expect(reserveTicketsAction(input)).resolves.toEqual({
      ok: false,
      error: 'payment_unavailable',
    });

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    vi.stubEnv('TOSS_SECRET_KEY', 'live_gsk_example');
    await expect(reserveTicketsAction(input)).resolves.toEqual({
      ok: false,
      error: 'payment_unavailable',
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: ticketTypeId, price: 0, events: { status: '예매중' } }],
    [{ id: ticketTypeId, price: 22000, events: { status: '예정' } }],
    [{ id: ticketTypeId, price: 22000, events: [] }],
    [null],
  ])('rejects zero-price, non-bookable, and missing ticket types before RPC %#', async (data) => {
    mocks.eligibility = { data, error: null };

    await expect(reserveTicketsAction(input)).resolves.toEqual({
      ok: false,
      error: 'not_bookable',
    });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['account_suspended', 'account_suspended'],
    ['auth required', 'auth_required'],
    ['onboarding required', 'onboarding_required'],
    ['ticket type not found', 'not_bookable'],
    ['event not bookable', 'not_bookable'],
    ['paid ticket required', 'not_bookable'],
    ['sales not open', 'sales_not_open'],
    ['sold out', 'sold_out'],
    ['per-user limit exceeded', 'per_user_limit'],
    ['reservation conflict', 'conflict'],
    ['private database detail', 'unavailable'],
  ] as const)('maps database error %s to safe action error %s', async (message, error) => {
    mocks.serviceRpc.mockResolvedValue({ data: null, error: { message } });
    await expect(reserveTicketsAction(input)).resolves.toEqual({ ok: false, error });
  });

  it('fails closed on eligibility query errors and malformed RPC references', async () => {
    mocks.eligibility = { data: null, error: { message: 'private eligibility error' } };
    await expect(reserveTicketsAction(input)).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();

    mocks.eligibility = {
      data: { id: ticketTypeId, price: 22000, events: { status: '예매중' } },
      error: null,
    };
    mocks.serviceRpc.mockResolvedValue({ data: 'not-a-uuid', error: null });
    await expect(reserveTicketsAction(input)).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    });
  });

  it('returns a safe retryable error when Supabase throws', async () => {
    mocks.from.mockImplementation(() => {
      throw new Error('private network detail');
    });

    await expect(reserveTicketsAction(input)).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });
});
