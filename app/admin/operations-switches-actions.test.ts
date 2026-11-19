import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveOrderDelayNoticeSwitchAction, savePartialCancelSwitchAction, saveReturnFeeDeductionSwitchAction } from './operations-switches-actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(), dispatcher: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/email/dispatcher.server', () => ({ emailDispatcherFromEnvironment: mocks.dispatcher }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));

const id = 'c3a00000-0000-4000-9000-0000000000a1';
const stamp = { updatedBy: '운영자' };
const state = (over: { delay?: boolean; fee?: boolean; partial?: boolean } = {}) => ({
  delayNotice: { revision: 2, enabled: over.delay ?? false, smsEnabled: false, evidence: null, changedAt: '2026-11-19T01:00:00Z', ...stamp },
  returnFee: { revision: 2, enabled: over.fee ?? false, oneWayAmount: over.fee ? 3000 : null, evidence: null, enabledAt: null, updatedAt: '2026-11-19T01:00:00Z', ...stamp },
  partialCancel: { revision: 2, enabled: over.partial ?? false, evidence: null, enabledAt: null, updatedAt: '2026-11-19T01:00:00Z', ...stamp },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ user: { id: 'admin' } });
  mocks.dispatcher.mockReturnValue({});
  mocks.rpc.mockResolvedValue({ data: state({ delay: true, fee: true, partial: true }), error: null });
});

describe('운영 스위치 저장 액션', () => {
  it('통합·계정 주매니저(platform.manage, 전환 전 admin) 권한이 없으면 DB에 접근하지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    for (const result of [
      await saveOrderDelayNoticeSwitchAction(true, 'TEST 근거 확인', 1, id),
      await saveReturnFeeDeductionSwitchAction(true, 3000, 'TEST 근거 확인', 1, id),
      await savePartialCancelSwitchAction(true, 'TEST 근거 확인', 1, id),
    ]) expect(result).toHaveProperty('error');
    expect(mocks.access).toHaveBeenCalledWith('/admin/settings/switches', { capability: 'platform.manage', adminOnly: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('지연 안내 이메일은 정확한 매개변수로 저장하고 응답이 요청과 같을 때만 성공 처리한다', async () => {
    expect(await saveOrderDelayNoticeSwitchAction(true, 'TEST 발신자·웹훅 승인', 1, id)).toEqual({ state: state({ delay: true, fee: true, partial: true }) });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_order_delay_notice_switch', { p_enabled: true, p_evidence: 'TEST 발신자·웹훅 승인', p_expected_revision: 1, p_operation_id: id });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/switches');
    mocks.rpc.mockResolvedValueOnce({ data: state({ delay: false }), error: null });
    expect(await saveOrderDelayNoticeSwitchAction(true, 'TEST 발신자·웹훅 승인', 1, id)).toHaveProperty('uncertain', true);
  });

  it('이메일 공급자·서명 설정이 없으면 지연 안내를 켜지 못하지만 끄는 것은 막지 않는다', async () => {
    mocks.dispatcher.mockReturnValue(null);
    const blocked = await saveOrderDelayNoticeSwitchAction(true, 'TEST 발신자·웹훅 승인', 1, id);
    expect(blocked).toHaveProperty('error');
    expect(blocked).not.toHaveProperty('uncertain');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: state({ delay: false }), error: null });
    expect(await saveOrderDelayNoticeSwitchAction(false, null, 1, id)).toHaveProperty('state');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_order_delay_notice_switch', { p_enabled: false, p_evidence: null, p_expected_revision: 1, p_operation_id: id });
  });

  it('켤 때는 근거가 필수이고 끌 때는 근거 없이 보낸다', async () => {
    expect(await saveOrderDelayNoticeSwitchAction(true, null, 1, id)).toHaveProperty('error');
    expect(await saveOrderDelayNoticeSwitchAction(true, '', 1, id)).toHaveProperty('error');
    expect(await saveOrderDelayNoticeSwitchAction(true, ' 앞뒤 공백 ', 1, id)).toHaveProperty('error');
    expect(await saveOrderDelayNoticeSwitchAction(true, '가', 1, id)).toHaveProperty('error');
    expect(await saveOrderDelayNoticeSwitchAction(true, `${'가'.repeat(501)}`, 1, id)).toHaveProperty('error');
    expect(await saveOrderDelayNoticeSwitchAction(true, '줄\n바꿈', 1, id)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: state({ partial: false }), error: null });
    expect(await savePartialCancelSwitchAction(false, undefined, 1, id)).toHaveProperty('state');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_partial_cancel_switch', { p_enabled: false, p_evidence: null, p_expected_revision: 1, p_operation_id: id });
  });

  it('반품배송비 차감은 켤 때 편도 금액이 필수이고 응답 금액이 같아야 성공이다', async () => {
    expect(await saveReturnFeeDeductionSwitchAction(true, null, 'TEST 약관 개정 공지', 1, id)).toHaveProperty('error');
    for (const amount of [0, -1, 1.5, 1_000_001, '3000', Number.NaN]) {
      expect(await saveReturnFeeDeductionSwitchAction(true, amount, 'TEST 약관 개정 공지', 1, id)).toHaveProperty('error');
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await saveReturnFeeDeductionSwitchAction(true, 3000, 'TEST 약관 개정 공지', 2, id)).toHaveProperty('state');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_return_fee_deduction_switch', {
      p_enabled: true, p_one_way_amount: 3000, p_evidence: 'TEST 약관 개정 공지', p_expected_revision: 2, p_operation_id: id,
    });
    expect(await saveReturnFeeDeductionSwitchAction(true, 4000, 'TEST 약관 개정 공지', 2, id)).toHaveProperty('uncertain', true);
  });

  it('잘못된 요청 번호·리비전·불리언은 저장하지 않는다', async () => {
    expect(await savePartialCancelSwitchAction('yes', 'TEST 근거 확인', 1, id)).toHaveProperty('error');
    expect(await savePartialCancelSwitchAction(true, 'TEST 근거 확인', 0, id)).toHaveProperty('error');
    expect(await savePartialCancelSwitchAction(true, 'TEST 근거 확인', 1.5, id)).toHaveProperty('error');
    expect(await savePartialCancelSwitchAction(true, 'TEST 근거 확인', 1, 'not-uuid')).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('충돌·권한 거절·잘못된 값은 확정 실패, 통신 실패·알 수 없는 오류·모양이 틀린 응답은 결과 불명이다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'operations_switch_changed' } });
    expect(await savePartialCancelSwitchAction(true, 'TEST 근거 확인', 1, id))
      .toEqual({ error: '다른 관리자가 먼저 설정을 바꿨습니다. 새로고침해 현재 설정을 확인해주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'operator_capability_required' } });
    expect(await savePartialCancelSwitchAction(true, 'TEST 근거 확인', 1, id)).not.toHaveProperty('uncertain');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'operations_switch_evidence_required' } });
    expect(await savePartialCancelSwitchAction(true, 'TEST 근거 확인', 1, id)).not.toHaveProperty('uncertain');
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await savePartialCancelSwitchAction(true, 'TEST 근거 확인', 1, id)).toHaveProperty('uncertain', true);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'operation_conflict' } });
    expect(await savePartialCancelSwitchAction(true, 'TEST 근거 확인', 1, id)).toHaveProperty('uncertain', true);
    mocks.rpc.mockResolvedValueOnce({ data: { delayNotice: {} }, error: null });
    expect(await savePartialCancelSwitchAction(true, 'TEST 근거 확인', 1, id)).toHaveProperty('uncertain', true);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
