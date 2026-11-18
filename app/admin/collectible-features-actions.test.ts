import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCollectibleFeaturesAction } from './collectible-features-actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath, updateTag: mocks.updateTag }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));

const id = 'c0f00000-0000-4000-9000-0000000000a1';
const state = { revision: 2, binder: true, market: false, exchange: false, updatedAt: '2026-11-18T01:00:00Z', updatedBy: '운영자' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ user: { id: 'admin' } });
  mocks.rpc.mockResolvedValue({ data: state, error: null });
});

describe('카드 바인더·굿즈 마켓·카드 트레이드 공개 스위치 저장', () => {
  it('관리자 전용 platform.manage 권한이 없으면 DB 에 접근하지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await saveCollectibleFeaturesAction(true, false, false, 1, id)).toHaveProperty('error');
    expect(mocks.access).toHaveBeenCalledWith('/admin/settings/features', { capability: 'platform.manage', adminOnly: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it('정확한 매개변수로 저장하고, 응답이 요청과 같을 때만 성공 처리하며 셸 캐시를 즉시 만료한다', async () => {
    expect(await saveCollectibleFeaturesAction(true, false, false, 1, id)).toEqual({ state });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_collectible_features', {
      p_binder: true, p_market: false, p_exchange: false, p_expected_revision: 1, p_operation_id: id,
    });
    expect(mocks.updateTag).toHaveBeenCalledWith('collectible-features');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout');

    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ user: { id: 'admin' } });
    mocks.rpc.mockResolvedValue({ data: state, error: null });
    expect(await saveCollectibleFeaturesAction(true, true, false, 1, id)).toHaveProperty('uncertain', true);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it('잘못된 입력은 저장하지 않는다', async () => {
    const cases: unknown[][] = [['yes', false, false, 1, id], [true, null, false, 1, id], [true, false, 0, 1, id],
      [true, false, false, 0, id], [true, false, false, 1.5, id], [true, false, false, 1, 'not-uuid']];
    for (const [binder, market, exchange, revision, operation] of cases) {
      expect(await saveCollectibleFeaturesAction(binder, market, exchange, revision, operation)).toHaveProperty('error');
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('충돌·권한 거절은 확정 실패, 통신 실패·알 수 없는 오류·모양이 틀린 응답은 결과 불명이다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'collectible_features_changed' } });
    const conflict = await saveCollectibleFeaturesAction(true, false, false, 1, id);
    expect(conflict).toEqual({ error: '다른 관리자가 먼저 설정을 바꿨습니다. 새로고침해 현재 설정을 확인해주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'operator_capability_required' } });
    expect(await saveCollectibleFeaturesAction(true, false, false, 1, id)).not.toHaveProperty('uncertain');
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await saveCollectibleFeaturesAction(true, false, false, 1, id)).toHaveProperty('uncertain', true);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'operation_conflict' } });
    expect(await saveCollectibleFeaturesAction(true, false, false, 1, id)).toHaveProperty('uncertain', true);
    mocks.rpc.mockResolvedValueOnce({ data: { ...state, extra: 1 }, error: null });
    expect(await saveCollectibleFeaturesAction(true, false, false, 1, id)).toHaveProperty('uncertain', true);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});
