import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyShippingRegionPolicy } from '@/lib/admin/shipping-regions';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { applyShippingRegionPolicyAction, changeShippingRegionFeesAction, endShippingRegionPolicyAction, saveShippingRegionPolicyAction } from './shipping-region-actions';
const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const input = emptyShippingRegionPolicy(id, 'hanjin');
const policy = { ...input, id, version: 1, revision: 1, status: 'draft', confirmedAt: null, confirmedBy: null, updatedAt: '2026-09-10T00:00:00Z' };
const active = { ...policy, status: 'active', startsAt: '2026-09-10T00:00:00Z', confirmedAt: '2026-11-26T02:00:00Z', confirmedBy: '관리자' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'admin' }, isStaff: true, role: 'admin' });
});
describe('지역별 추가배송비 서버 action', () => {
  it('staff와 일반 회원은 저장·적용·끝내기·금액 바꾸기를 하지 못한다', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' });
    expect(await saveShippingRegionPolicyAction(null, null, input)).toMatchObject({ ok: false, error: expect.stringContaining('최고 관리자만') });
    expect(await applyShippingRegionPolicyAction(null, null, input, [], true)).toMatchObject({ ok: false });
    expect(await endShippingRegionPolicyAction(id, 1)).toMatchObject({ ok: false });
    expect(await changeShippingRegionFeesAction(id, 1, { 도서산간: 3000 })).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('적용하지 않고 저장하면 빈 칸도 그대로 저장하고, 다른 사람이 먼저 바꾼 저장을 성공으로 알리지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: policy, error: null });
    expect(await saveShippingRegionPolicyAction(null, null, input)).toMatchObject({ ok: true, policy, message: expect.stringContaining('아직 주문에는 적용되지 않습니다') });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_shipping_region_policy', { p_policy_id: null, p_values: input, p_expected_revision: null });
    mocks.revalidate.mockClear(); mocks.rpc.mockResolvedValue({ data: null, error: { message: 'shipping_region_policy_changed' } });
    expect(await saveShippingRegionPolicyAction(id, 1, input)).toMatchObject({ ok: false, error: expect.stringContaining('다른 사람이 먼저 바꿨습니다') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('저장 결과를 읽지 못하면 성공으로 알리지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: { id }, error: null });
    expect(await saveShippingRegionPolicyAction(null, null, input)).toMatchObject({ ok: false, error: expect.stringContaining('저장됐는지 확인하지 못했습니다') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('저장과 적용을 한 번에 보내고, 함께 바뀐 설정을 돌려준다', async () => {
    const replaced = { ...active, id: otherId, status: 'retired', revision: 3 };
    mocks.rpc.mockResolvedValue({ data: { policy: active, replaced: [replaced] }, error: null });
    expect(await applyShippingRegionPolicyAction(null, null, input, [otherId], true)).toMatchObject({ ok: true, policy: active, replaced: [replaced], message: expect.stringContaining('지금부터 새 주문에 적용') });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_apply_shipping_region_policy', { p_policy_id: null, p_values: input, p_expected_revision: null, p_replace_policy_ids: [otherId], p_start_now: true });
    expect(mocks.revalidate).toHaveBeenCalled();
    /* 나중에 시작하는 설정은 언제부터 적용되는지를 말한다. 저장해 둔 설정은 번호와 함께 보낸다. */
    const scheduled = { ...active, startsAt: '2999-12-01T00:00:00Z' };
    mocks.rpc.mockResolvedValue({ data: { policy: scheduled, replaced: [] }, error: null });
    const later = await applyShippingRegionPolicyAction(id, 1, { ...input, startsAt: scheduled.startsAt }, [], false);
    expect(later).toMatchObject({ ok: true, message: expect.stringContaining('부터 들어오는 주문에 적용됩니다') });
    expect(later).not.toMatchObject({ message: expect.stringContaining('지금부터') });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_apply_shipping_region_policy', expect.objectContaining({ p_policy_id: id, p_expected_revision: 1, p_replace_policy_ids: [], p_start_now: false }));
  });
  /* '저장하면 바로'의 시작 시각은 DB 시계가 정한다. 이 앱 서버의 시계가 DB보다 느려도(돌려받은 시작 시각이 앱 서버의 지금보다 뒤) '나중에 적용'이라 하지 않는다. */
  it('저장하면 바로 적용한 설정은 시작 시각이 서버의 지금보다 뒤로 와도 지금부터 적용된다고 말한다', async () => {
    const ahead = { ...active, startsAt: new Date(Date.now() + 90_000).toISOString() };
    mocks.rpc.mockResolvedValue({ data: { policy: ahead, replaced: [] }, error: null });
    const now = await applyShippingRegionPolicyAction(null, null, input, [], true);
    expect(now).toMatchObject({ ok: true, policy: ahead, message: expect.stringContaining('적용했습니다. 지금부터 새 주문에 적용') });
    expect(now).not.toMatchObject({ message: expect.stringContaining('부터 들어오는 주문에 적용됩니다') });
    /* 날짜를 정해 보낸 설정은 같은 시각이어도 그 시각부터 적용된다고 말한다. */
    const later = await applyShippingRegionPolicyAction(null, null, { ...input, startsAt: ahead.startsAt }, [], false);
    expect(later).toMatchObject({ ok: true, message: expect.stringContaining('부터 들어오는 주문에 적용됩니다') });
  });
  it('형식이 틀린 적용은 서버에 보내지 않는다', async () => {
    for (const [target, revision, value, replace, startNow] of [[null, null, {}, [], true], [null, 1, input, [], true], [id, null, input, [], true], ['x', 1, input, [], true],
      [null, null, input, ['x'], true], [null, null, input, null, true], [null, null, input, [], 'yes'], [null, null, input, [], undefined]] as const) {
      expect(await applyShippingRegionPolicyAction(target, revision, value, replace, startNow)).toMatchObject({ ok: false });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('확인창에 보인 설정과 실제로 바뀔 설정이 다르면 아무것도 바꾸지 않고 지금 목록을 돌려준다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'shipping_region_replace_changed' } })
      .mockResolvedValueOnce({ data: { policies: [active], adoptions: [] }, error: null });
    expect(await applyShippingRegionPolicyAction(null, null, input, [], true)).toEqual({ ok: false, error: expect.stringContaining('적용 중인 설정이 방금 바뀌었습니다'), policies: [active] });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_list_shipping_region_policies');
    expect(mocks.revalidate).not.toHaveBeenCalled();
    /* 목록도 읽지 못하면 새로고침하라고 한다. */
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'shipping_region_replace_changed' } }).mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    const failed = await applyShippingRegionPolicyAction(null, null, input, [], true);
    expect(failed).toMatchObject({ ok: false, error: expect.stringContaining('새로고침') });
    expect(failed).not.toHaveProperty('policies');
  });
  it('적용 거절은 고칠 방법으로 알리고, 결과를 읽지 못하면 다시 누르지 말라고 한다', async () => {
    for (const [message, phrase] of [['shipping_region_policy_changed', '다른 사람이 먼저 바꿨습니다'], ['shipping_region_rules_overlap', '겹치는 줄'],
      ['shipping_region_carrier_mismatch', '기본 택배사'], ['shipping_region_policy_expired', '적용 종료'], ['shipping_region_period_invalid', '적용 종료는 적용 시작보다 뒤'],
      ['shipping_region_policy_immutable', '[이 내용으로 새로 만들기]'], ['shipping_region_policy_incomplete', '채우지 않은 칸'], ['operator_capability_required', '최고 관리자만']] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
      expect(await applyShippingRegionPolicyAction(null, null, input, [], true)).toMatchObject({ ok: false, error: expect.stringContaining(phrase) });
    }
    mocks.rpc.mockResolvedValue({ data: { policy: { id }, replaced: [] }, error: null });
    expect(await applyShippingRegionPolicyAction(null, null, input, [], true)).toMatchObject({ ok: false, error: expect.stringContaining('다시 누르지 말고 새로고침') });
    mocks.rpc.mockRejectedValue(new Error('network'));
    expect(await applyShippingRegionPolicyAction(null, null, input, [], true)).toMatchObject({ ok: false, error: expect.stringContaining('다시 누르지 말고 새로고침') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('끝내기는 확인 체크 없이 보내고, 이미 끝난 설정이면 그렇게 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...active, status: 'retired', revision: 3 }, error: null });
    expect(await endShippingRegionPolicyAction(id, 2)).toMatchObject({ ok: true, policy: { status: 'retired' }, message: expect.stringContaining('끝냈습니다') });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_shipping_region_policy_status', { p_policy_id: id, p_status: 'retired', p_expected_revision: 2, p_attested: true });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'shipping_region_status_invalid' } });
    expect(await endShippingRegionPolicyAction(id, 2)).toMatchObject({ ok: false, error: expect.stringContaining('이미 끝난 설정') });
    mocks.rpc.mockClear();
    expect(await endShippingRegionPolicyAction('not-a-uuid', 2)).toMatchObject({ ok: false });
    expect(await endShippingRegionPolicyAction(id, 0)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('적용 중인 설정의 지역명별 금액만 보내고, 새 설정과 이전 설정 번호를 함께 돌려준다', async () => {
    const next = { ...policy, id: otherId, version: 2, status: 'active', confirmedAt: '2026-11-26T02:00:00Z', confirmedBy: '관리자' };
    mocks.rpc.mockResolvedValue({ data: next, error: null });
    expect(await changeShippingRegionFeesAction(id, 3, { 도서산간: 3000 })).toMatchObject({ ok: true, policy: next, replacedId: id, message: expect.stringContaining('지금부터 새 주문에 적용') });
    expect((await changeShippingRegionFeesAction(id, 3, { 도서산간: 3000 })) as { message: string }).not.toMatchObject({ message: expect.stringContaining('버전') });
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
    for (const [message, phrase] of [['shipping_region_policy_changed', '다른 사람이 먼저 바꿨습니다'], ['shipping_region_policy_not_active', '적용 중인 설정만'],
      ['shipping_region_fees_unchanged', '바뀐 금액이 없습니다'], ['shipping_region_fee_label_unknown', '지역명'], ['shipping_region_policy_expired', '적용 종료']] as const) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
      expect(await changeShippingRegionFeesAction(id, 3, { 도서산간: 3000 })).toMatchObject({ ok: false, error: expect.stringContaining(phrase) });
    }
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
