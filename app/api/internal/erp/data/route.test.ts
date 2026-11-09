import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const SECRET = 'erp-sync-secret-0123456789';
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  serviceClientThrows: false,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    if (mocks.serviceClientThrows) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
    return { rpc: mocks.rpc };
  },
}));

const URL_BASE = 'https://icons.local/api/internal/erp/data';
const auth = (secret: string | null): Record<string, string> => (secret === null ? {} : { authorization: `Bearer ${secret}` });
const get = (query = '', secret: string | null = SECRET) => GET(new Request(`${URL_BASE}${query}`, { headers: auth(secret) }));
const post = (body: unknown, secret: string | null = SECRET) =>
  POST(new Request(URL_BASE, { method: 'POST', headers: { ...auth(secret), 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const none = { p_table: null, p_columns: null, p_after: null, p_where: null, p_limit: 500 };

describe('ERP 데이터 읽기 내부 라우트', () => {
  beforeEach(() => {
    vi.stubEnv('ERP_SYNC_SECRET', SECRET);
    mocks.rpc.mockReset();
    mocks.serviceClientThrows = false;
    mocks.rpc.mockResolvedValue({ data: { tables: [] }, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('비밀 값이 없거나 다르면 401, RPC 를 부르지 않는다', async () => {
    expect((await get('', null)).status).toBe(401);
    expect((await get('', 'wrong-secret-0123456789x')).status).toBe(401);
    expect((await post({}, null)).status).toBe(401);
    vi.stubEnv('ERP_SYNC_SECRET', '');
    expect((await get()).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('표를 안 주면 표 목록 — 본문을 그대로, 캐시 없이', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ tables: [] });
    expect(mocks.rpc).toHaveBeenCalledWith('service_erp_read', none);
  });

  it('GET 쿼리 · POST 본문 모두 표·칸·이어 읽기·거르기·한도를 넘긴다', async () => {
    const after = { at: '2026-11-01T00:00:00Z', key: { id: 'a' } };
    const where = { order_id: ['o1', 'o2'] };
    const q = `?table=public.orders&columns=id,total&after=${encodeURIComponent(JSON.stringify(after))}&where=${encodeURIComponent(JSON.stringify(where))}&limit=50`;
    await get(q);
    await post({ table: 'public.orders', columns: ['id', 'total'], after, where, limit: 50 });
    const read = { p_table: 'public.orders', p_columns: ['id', 'total'], p_after: after, p_where: where, p_limit: 50 };
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'service_erp_read', read);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'service_erp_read', read);
  });

  it('잘못된 요청은 400, RPC 를 부르지 않는다', async () => {
    for (const q of ['?table=orders', '?table=auth.sessions;drop', '?columns=a-b', '?limit=0', '?limit=1001', '?after=nope', '?where=[1]']) {
      expect((await get(q)).status).toBe(400);
    }
    for (const body of [[], { where: { id: 'x' } }, { columns: 'id' }, { limit: 1.5 }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('몰이 막은 표·칸(22023)은 400, 그 밖의 RPC 오류·서비스 클라이언트 실패는 502 — 내부 메시지는 싣지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'erp_read_unknown_table' } });
    expect((await get('?table=private.billing_credentials')).status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function' } });
    const res = await get();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'read_failed' });
    mocks.serviceClientThrows = true;
    expect((await get()).status).toBe(502);
  });
});
