import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), configured: true }));
vi.mock('./supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
import { loadGoodsTransactionRuntimeMode } from './checkout-transaction.server';
beforeEach(() => { mocks.configured = true; vi.clearAllMocks(); });
it('명시적으로 꺼진 실행과 아직 적용 전인 RPC만 구형 경로를 허용한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: false, error: null }); expect(await loadGoodsTransactionRuntimeMode()).toBe('legacy');
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'get_goods_transaction_runtime_enabled missing' } }); expect(await loadGoodsTransactionRuntimeMode()).toBe('legacy');
  mocks.rpc.mockResolvedValueOnce({ data: true, error: null }); expect(await loadGoodsTransactionRuntimeMode()).toBe('transaction');
});
it('조회 오류를 구형 결제 사용으로 해석하지 않는다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } }); expect(await loadGoodsTransactionRuntimeMode()).toBe('unavailable');
  mocks.rpc.mockResolvedValueOnce({ data: 'true', error: null }); expect(await loadGoodsTransactionRuntimeMode()).toBe('unavailable');
  mocks.rpc.mockRejectedValueOnce(new Error('offline')); expect(await loadGoodsTransactionRuntimeMode()).toBe('unavailable');
});
