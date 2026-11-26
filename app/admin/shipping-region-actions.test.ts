import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyShippingRegionPolicy } from '@/lib/admin/shipping-regions';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { changeShippingRegionFeesAction, saveShippingRegionPolicyAction, setShippingRegionPolicyStatusAction } from './shipping-region-actions';
const id = '00000000-0000-4000-8000-000000000001';
const input = emptyShippingRegionPolicy(id, 'hanjin');
const policy = { ...input, id, version: 1, revision: 1, status: 'draft', confirmedAt: null, confirmedBy: null, updatedAt: '2026-09-10T00:00:00Z' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'admin' }, isStaff: true, role: 'admin' });
});
describe('지역 배송 정책 서버 action', () => {
  it('staff와 일반 회원은 정책 저장·활성화에 접근하지 못한다', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' });
    expect(await saveShippingRegionPolicyAction(null, null, input)).toMatchObject({ ok: false });
    expect(await setShippingRegionPolicyStatusAction(id, 1, 'active', true)).toMatchObject({ ok: false });
    expect(await changeShippingRegionFeesAction(id, 1, { 도서산간: 3000 })).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('확인된 출고지·택배사의 공란 초안을 보존하고 충돌을 성공으로 처리하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: policy, error: null });
    expect(await saveShippingRegionPolicyAction(null, null, input)).toMatchObject({ ok: true, policy });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_shipping_region_policy', { p_policy_id: null, p_values: input, p_expected_revision: null });
    mocks.revalidate.mockClear(); mocks.rpc.mockResolvedValue({ data: null, error: { message: 'shipping_region_policy_changed' } });
    expect(await saveShippingRegionPolicyAction(id, 1, input)).toMatchObject({ ok: false, error: expect.stringContaining('먼저 정책을 바꿨습니다') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('원본 확인과 저장 리비전 없이 활성화하지 않고 서버 중첩 거절을 설명한다', async () => {
    expect(await setShippingRegionPolicyStatusAction(id, 1, 'active', false)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'shipping_region_rules_overlap' } });
    expect(await setShippingRegionPolicyStatusAction(id, 1, 'active', true)).toMatchObject({ ok: false, error: expect.stringContaining('겹치는') });
  });
  it('불완전한 성공 응답 때문에 화면의 초안이 사라지지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: { id }, error: null });
    expect(await saveShippingRegionPolicyAction(null, null, input)).toMatchObject({ ok: false, error: expect.stringContaining('저장 결과') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('적용 중인 정책의 지역명별 금액만 보내고, 새 버전과 이전 버전 번호를 함께 돌려준다', async () => {
    const next = { ...policy, id: '00000000-0000-4000-8000-000000000002', version: 2, status: 'active', confirmedAt: '2026-11-26T02:00:00Z', confirmedBy: '관리자' };
    mocks.rpc.mockResolvedValue({ data: next, error: null });
    expect(await changeShippingRegionFeesAction(id, 3, { 도서산간: 3000 })).toMatchObject({ ok: true, policy: next, replacedId: id, message: expect.stringContaining('버전 2') });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_change_shipping_region_fees', { p_policy_id: id, p_expected_revision: 3, p_fees: { 도서산간: 3000 } });
    expect(mocks.revalidate).toHaveBeenCalled();
  });
  it('금액 형식이 틀리면 서버에 보내지 않고, 서버 거절은 고칠 방법으로 알린다', async () => {
    for (const fees of [{}, { 도서산간: -1 }, { 도서산간: 1.5 }, { 도서산간: 1000001 }, { 도서산간: '3000' }, { '': 3000 }, null, []]) {
      expect(await changeShippingRegionFeesAction(id, 3, fees)).toMatchObject({ ok: false, error: expect.stringContaining('원 단위 숫자') });
    }
    expect(await changeShippingRegionFeesAction('not-a-uuid', 3, { 도서산간: 3000 })).toMatchObject({ ok: false });
    expect(await changeShippingRegionFeesAction(id, 0, { 도서산간: 3000 })).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    for (const [message, phrase] of [['shipping_region_policy_changed', '먼저 정책을 바꿨습니다'], ['shipping_region_policy_not_active', '적용 중인 정책만'],
      ['shipping_region_fees_unchanged', '바뀐 금액이 없습니다'], ['shipping_region_fee_label_unknown', '지역명'], ['shipping_region_policy_expired', '종료 일시']] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
      expect(await changeShippingRegionFeesAction(id, 3, { 도서산간: 3000 })).toMatchObject({ ok: false, error: expect.stringContaining(phrase) });
    }
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
