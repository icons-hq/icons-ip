import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

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

function request(query = '', secret: string | null = SECRET) {
  return new Request(`https://icons.local/api/internal/erp/orders${query}`, {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  });
}

describe('ERP 주문 피드 내부 라우트', () => {
  beforeEach(() => {
    vi.stubEnv('ERP_SYNC_SECRET', SECRET);
    mocks.rpc.mockReset();
    mocks.serviceClientThrows = false;
    mocks.rpc.mockResolvedValue({ data: { orders: [], next: null }, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('비밀 값이 없거나 다르면 401, RPC 를 부르지 않는다', async () => {
    expect((await GET(request('', null))).status).toBe(401);
    expect((await GET(request('', 'wrong-secret-0123456789x'))).status).toBe(401);
    vi.stubEnv('ERP_SYNC_SECRET', '');
    expect((await GET(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('커서를 RPC 인자로 넘기고 본문을 그대로 돌려준다', async () => {
    const body = { orders: [{ id: 'a' }], next: { at: '2026-11-09T00:00:00Z', id: 'b' } };
    mocks.rpc.mockResolvedValue({ data: body, error: null });
    const id = '30000000-0000-4000-8000-000000000001';
    const res = await GET(request(`?afterAt=2026-11-01T00:00:00Z&afterId=${id}&limit=50`));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(body);
    expect(mocks.rpc).toHaveBeenCalledWith('service_erp_order_feed', {
      p_after_at: '2026-11-01T00:00:00Z', p_after_id: id, p_limit: 50,
    });
  });

  it('처음 부르면 커서 없이 100건', async () => {
    await GET(request());
    expect(mocks.rpc).toHaveBeenCalledWith('service_erp_order_feed', { p_after_at: null, p_after_id: null, p_limit: 100 });
  });

  it('잘못된 커서·한도는 400', async () => {
    for (const q of ['?afterAt=nope', '?afterId=30000000-0000-4000-8000-000000000001', '?limit=0', '?limit=501', '?afterAt=2026-11-01T00:00:00Z&afterId=x']) {
      expect((await GET(request(q))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('RPC 오류·서비스 클라이언트 실패는 502, 내부 메시지는 싣지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for function' } });
    const res = await GET(request());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'feed_failed' });
    mocks.serviceClientThrows = true;
    expect((await GET(request())).status).toBe(502);
  });
});
