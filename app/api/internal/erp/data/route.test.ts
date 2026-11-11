import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
// 인증 실패 기록의 인스턴스 상태가 시험 사이에 새지 않도록 시험마다 새로 불러온다.
let GET: typeof import('./route').GET;
let POST: typeof import('./route').POST;
const auth = (secret: string | null): Record<string, string> => (secret === null ? {} : { authorization: `Bearer ${secret}` });
const get = (query = '', secret: string | null = SECRET) => GET(new Request(`${URL_BASE}${query}`, { headers: auth(secret) }));
const post = (body: unknown, secret: string | null = SECRET) =>
  POST(new Request(URL_BASE, { method: 'POST', headers: { ...auth(secret), 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const none = { p_table: null, p_columns: null, p_after: null, p_where: null, p_limit: 500, p_settled: null };
const reads = () => mocks.rpc.mock.calls.filter(([name]) => name === 'service_erp_read');
const notes = () => mocks.rpc.mock.calls.filter(([name]) => name === 'service_erp_note_access').map(([, args]) => args);

const clock = Date.parse('2026-11-09T00:00:00Z');

describe('ERP 데이터 읽기 내부 라우트', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ GET, POST } = await import('./route'));
    vi.stubEnv('ERP_SYNC_SECRET', SECRET);
    mocks.rpc.mockReset();
    mocks.serviceClientThrows = false;
    mocks.rpc.mockResolvedValue({ data: { tables: [] }, error: null });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('비밀 값이 없거나 다르면 401, 읽기 RPC 를 부르지 않는다', async () => {
    expect((await get('', null)).status).toBe(401);
    expect((await get('', 'wrong-secret-0123456789x')).status).toBe(401);
    expect((await post({}, null)).status).toBe(401);
    vi.stubEnv('ERP_SYNC_SECRET', '');
    expect((await get()).status).toBe(401);
    expect(reads()).toHaveLength(0);
  });

  it('인증 실패는 건수로만 기록하고, 간격 안에서는 DB 를 부르지 않다가 다음 기록에 더한다', async () => {
    expect((await get('?table=public.orders', 'wrong-secret-0123456789x')).status).toBe(401);
    expect(notes()).toEqual([{ p_outcome: 'denied', p_count: 1 }]);
    await post({ table: 'public.orders' }, 'wrong-secret-0123456789x');
    await post({ table: 'public.orders' }, null);
    expect(notes()).toHaveLength(1);
    vi.setSystemTime(clock + 11_000);
    await post({}, null);
    expect(notes()[1]).toEqual({ p_outcome: 'denied', p_count: 3 });
  });

  it('라우트가 닫혀 있으면 인증 실패를 DB 에 쓰지 않고, 기록 장애가 401 을 바꾸지 않는다', async () => {
    vi.stubEnv('ERP_SYNC_SECRET', '');
    expect((await get('', 'anything')).status).toBe(401);
    expect(notes()).toHaveLength(0);
    vi.stubEnv('ERP_SYNC_SECRET', SECRET);
    mocks.rpc.mockRejectedValue(new Error('db down'));
    expect((await get('', 'wrong-secret-0123456789x')).status).toBe(401);
  });

  it('표를 안 주면 표 목록 — 본문을 그대로, 캐시 없이', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ tables: [] });
    expect(mocks.rpc).toHaveBeenCalledWith('service_erp_read', none);
    expect(notes()).toHaveLength(0);
  });

  it('GET 은 표·칸·한도를, POST 는 이어 읽기·거르기·안전 경계까지 넘긴다', async () => {
    const after = { at: '2026-11-01T00:00:00Z', key: { id: 'a' } };
    const where = { order_id: ['o1', 'o2'] };
    await get('?table=public.orders&columns=id,total&limit=50');
    await post({ table: 'public.orders', columns: ['id', 'total'], after, where, limit: 50, settled: false });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'service_erp_read', { ...none, p_table: 'public.orders', p_columns: ['id', 'total'], p_limit: 50 });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'service_erp_read', { p_table: 'public.orders', p_columns: ['id', 'total'], p_after: after, p_where: where, p_limit: 50, p_settled: false });
  });

  it('GET 쿼리에 값(where·after)을 실으면 접근 로그에 남기 전에 400 — RPC 를 부르지 않는다', async () => {
    const where = encodeURIComponent(JSON.stringify({ email: ['who@example.test'] }));
    const after = encodeURIComponent(JSON.stringify({ at: 'x', key: {} }));
    expect((await get(`?table=public.orders&where=${where}`)).status).toBe(400);
    expect((await get(`?table=public.orders&after=${after}`)).status).toBe(400);
    expect(reads()).toHaveLength(0);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('who@example.test');
  });

  it('잘못된 요청은 400, 읽기 RPC 를 부르지 않고 이름만 기록한다', async () => {
    for (const q of ['?table=orders', '?table=auth.sessions;drop', '?columns=a-b', '?limit=0', '?limit=1001']) {
      expect((await get(q)).status).toBe(400);
    }
    for (const body of [[], { where: { id: 'x' } }, { columns: 'id' }, { limit: 1.5 }, { settled: 'yes' }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(reads()).toHaveLength(0);
    await post({ table: 'public.orders', columns: ['id', 'a;b'], where: { email: 'not-a-list' } });
    const rejected = notes().at(-1) as Record<string, unknown>;
    expect(rejected.p_outcome).toBe('rejected');
    expect(rejected.p_table).toBe('public.orders');
    expect(rejected.p_filters).toEqual(['email']);
    expect(JSON.stringify(rejected)).not.toContain('not-a-list');
  });

  it('몰이 막은 표·칸(22023)은 400, 그 밖의 RPC 오류·서비스 클라이언트 실패는 502 — 내부 메시지는 싣지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'erp_read_unknown_table' } });
    expect((await get('?table=private.billing_credentials')).status).toBe(400);
    expect(notes().at(-1)).toMatchObject({ p_outcome: 'rejected', p_table: 'private.billing_credentials' });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function' } });
    const res = await get();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'read_failed' });
    expect(notes().at(-1)).toMatchObject({ p_outcome: 'failed' });
    mocks.serviceClientThrows = true;
    expect((await get()).status).toBe(502);
  });
});
