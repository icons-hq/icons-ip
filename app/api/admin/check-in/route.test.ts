import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const QR_TOKEN = '0123456789abcdef0123456789abcdef';
const CHECKED_AT = '2026-07-15T04:05:00.000Z';
const STAFF_ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  supabaseConfigured: true,
  serviceConfigured: true,
  adminState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  getAuth: vi.fn(),
  createServiceClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: mocks.getAuth,
}));
vi.mock('@/lib/ticket-check-in', async () => await import('../../../../lib/ticket-check-in'));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.supabaseConfigured }),
}));
vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleConfig: () => ({ isConfigured: mocks.serviceConfigured }),
  createServiceClient: mocks.createServiceClient,
}));

function request(input: {
  origin?: string | null;
  body?: string;
} = {}) {
  const origin = input.origin === undefined ? 'https://icons.local' : input.origin;
  return new Request('https://icons.local/api/admin/check-in', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin === null ? {} : { Origin: origin }),
    },
    body: input.body ?? JSON.stringify({ qrToken: QR_TOKEN }),
  });
}

function rpcRow(overrides: Record<string, unknown> = {}) {
  return {
    result: 'checked_in',
    checked_at: CHECKED_AT,
    event_id: 'event-1',
    event_title: '화산강림 팝업',
    ticket_type_id: '22222222-2222-4222-8222-222222222222',
    ticket_type_name: '7월 25일 1회차',
    ...overrides,
  };
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('pragma')).toBe('no-cache');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('POST /api/admin/check-in', () => {
  beforeEach(() => {
    mocks.supabaseConfigured = true;
    mocks.serviceConfigured = true;
    mocks.adminState = {
      isConfigured: true,
      user: { id: STAFF_ID, email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.getAuth.mockReset();
    mocks.getAuth.mockImplementation(async () => mocks.adminState);
    mocks.createServiceClient.mockReset();
    mocks.createServiceClient.mockImplementation(() => ({ rpc: mocks.rpc }));
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: [rpcRow()], error: null });
  });

  it.each([
    ['missing', null],
    ['mismatch', 'https://attacker.example'],
  ])('%s Origin은 body·auth·DB 전에 403으로 차단한다', async (_label, origin) => {
    const input = request({ origin });
    const json = vi.spyOn(input, 'json');

    const response = await POST(input);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: 'forbidden' } });
    expectPrivateNoStore(response);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(['supabase', 'service'])('%s 설정이 없으면 body·auth·DB 전에 503을 반환한다', async (missing) => {
    mocks.supabaseConfigured = missing !== 'supabase';
    mocks.serviceConfigured = missing !== 'service';
    const input = request();
    const json = vi.spyOn(input, 'json');

    const response = await POST(input);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_configured' } });
    expectPrivateNoStore(response);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.getAuth).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('인증이 없으면 401, 일반 사용자는 존재를 숨긴 404를 반환한다', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };
    const unauthorized = await POST(request());
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ error: { code: 'auth_required' } });
    expectPrivateNoStore(unauthorized);

    mocks.adminState = {
      isConfigured: true,
      user: { id: '33333333-3333-4333-8333-333333333333', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };
    const hidden = await POST(request());
    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toEqual({ error: { code: 'not_found' } });
    expectPrivateNoStore(hidden);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{'],
    ['array body', JSON.stringify([{ qrToken: QR_TOKEN }])],
    ['missing qrToken', JSON.stringify({})],
    ['extra field', JSON.stringify({ qrToken: QR_TOKEN, owner: 'private-user' })],
    ['uppercase token', JSON.stringify({ qrToken: QR_TOKEN.toUpperCase() })],
    ['internal whitespace', JSON.stringify({ qrToken: `${QR_TOKEN.slice(0, 16)} ${QR_TOKEN.slice(16)}` })],
  ])('%s는 존재하지 않는 티켓과 같은 404로 처리한다', async (_label, body) => {
    const response = await POST(request({ body }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_found' } });
    expectPrivateNoStore(response);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['checked_in', CHECKED_AT],
    ['already_used', CHECKED_AT],
    ['refunded', null],
  ] as const)('%s 결과를 안전한 metadata만 담아 반환한다', async (status, checkedAt) => {
    const providerRow = rpcRow({ result: status, checked_at: checkedAt });
    mocks.rpc.mockResolvedValue({ data: [providerRow], error: null });

    const response = await POST(request({
      body: JSON.stringify({ qrToken: ` \r\n${QR_TOKEN}\t ` }),
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      result: status,
      checkedAt,
      event: { id: 'event-1', title: '화산강림 팝업' },
      ticketType: {
        id: '22222222-2222-4222-8222-222222222222',
        name: '7월 25일 1회차',
      },
    });
    expectPrivateNoStore(response);
    expect(mocks.createServiceClient).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('check_in_ticket', {
      p_staff_id: STAFF_ID,
      p_qr_token: QR_TOKEN,
    });
    expect(JSON.stringify(json)).not.toMatch(/0123456789abcdef|staff@icons\.gg/);
  });

  it('not_found RPC 결과도 형식 오류와 같은 404로 숨긴다', async () => {
    mocks.rpc.mockResolvedValue({
      data: [rpcRow({
        result: 'not_found',
        checked_at: null,
        event_id: null,
        event_title: null,
        ticket_type_id: null,
        ticket_type_name: null,
      })],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_found' } });
    expectPrivateNoStore(response);
  });

  it.each([
    [{ code: '23514', message: 'ticket cancellation in progress' }, 409, 'cancellation_in_progress'],
    [{ code: '23514', message: 'invalid qr token' }, 404, 'not_found'],
    [{ code: '42501', message: 'forbidden' }, 404, 'not_found'],
    [{ code: 'P0002', message: 'ticket order not found' }, 502, 'check_in_failed'],
    [{ code: '23514', message: 'ticket check-in ledger mismatch: private-user' }, 502, 'check_in_failed'],
    [{ code: 'XX000', message: `private database failure for ${QR_TOKEN}` }, 502, 'check_in_failed'],
  ])('RPC 오류를 원문 없이 안전한 상태로 매핑한다', async (error, status, code) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.rpc.mockResolvedValue({ data: null, error });

    const response = await POST(request());
    const json = await response.json();

    expect(response.status).toBe(status);
    expect(json).toEqual({ error: { code } });
    expectPrivateNoStore(response);
    expect(JSON.stringify(json)).not.toMatch(/private|0123456789abcdef|staff@icons\.gg/);
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it.each([
    null,
    [],
    [rpcRow(), rpcRow()],
    [rpcRow({ checked_at: null })],
    [rpcRow({ result: 'refunded', checked_at: CHECKED_AT })],
  ])('RPC가 정확한 단일 행 계약을 어기면 502로 fail closed한다', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });

    const response = await POST(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: { code: 'check_in_failed' } });
    expectPrivateNoStore(response);
  });

  it('service client 생성이나 RPC 호출 예외도 원문 없이 502로 제한한다', async () => {
    mocks.createServiceClient.mockImplementationOnce(() => {
      throw new Error(`private service error ${QR_TOKEN}`);
    });
    const clientFailure = await POST(request());
    expect(clientFailure.status).toBe(502);
    await expect(clientFailure.json()).resolves.toEqual({ error: { code: 'check_in_failed' } });
    expectPrivateNoStore(clientFailure);

    mocks.rpc.mockRejectedValueOnce(new Error(`private rpc error ${QR_TOKEN}`));
    const rpcFailure = await POST(request());
    expect(rpcFailure.status).toBe(502);
    await expect(rpcFailure.json()).resolves.toEqual({ error: { code: 'check_in_failed' } });
    expectPrivateNoStore(rpcFailure);
  });
});
