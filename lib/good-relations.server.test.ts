import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoodRelationReferences } from './good-relations.server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks }));
beforeEach(() => { vi.clearAllMocks(); });
describe('공개 연관상품 읽기', () => {
  it('현재 상품과 다음 노출 경계를 전달한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { groups: [], nextChangeAt: '2026-10-15T00:00:00Z' }, error: null });
    expect(await loadGoodRelationReferences('good-a')).toEqual({ groups: [], nextChangeAt: '2026-10-15T00:00:00Z' });
    expect(mocks.rpc).toHaveBeenCalledWith('get_good_relation_compositions', { p_good_id: 'good-a' });
  });
  it('조회 실패와 잘못된 응답을 빈 설정과 구별한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await loadGoodRelationReferences('good-a')).toEqual({ groups: [], nextChangeAt: null, unavailable: true });
  });
});
