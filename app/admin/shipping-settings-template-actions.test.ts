import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ allowed: true, actor: '', claims: vi.fn(), rpc: vi.fn(), current: vi.fn(), revalidatePath: vi.fn(), revalidateGoods: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: vi.fn(async () => mocks.allowed ? { user: { id: mocks.actor } } : null) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc, auth: { getClaims: mocks.claims }, from: mocks.from })) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodsSurfaces: mocks.revalidateGoods }));
import { applyShippingSettingsTemplateAction, findShippingSettingsGoodsAction, previewShippingSettingsTemplateAction, readShippingSettingsOperationAction,
  readShippingSettingsTemplateAction, saveShippingSettingsTemplateAction, sealShippingSettingsOperationAction } from './shipping-settings-template-actions';
import { shippingFixtures, shippingIdentity as identity, shippingIds as ids } from '@/test/fixtures/shipping-settings';
import { shippingChargeSettingsFixtures } from '@/test/fixtures/shipping-settings-charge-groups';

const ok = (data: unknown) => ({ data, error: null });
beforeEach(() => {
  mocks.allowed = true; mocks.actor = ids.actor;
  for (const key of ['claims', 'rpc', 'current', 'from', 'revalidatePath', 'revalidateGoods'] as const) mocks[key].mockReset();
  mocks.claims.mockResolvedValue({ data: { claims: { sub: ids.actor, session_id: ids.session } }, error: null });
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: mocks.current }) }) });
});
describe('배송정보 템플릿 현재 인증과 엄격 요청', () => {
  it.each(['capability', 'actor', 'subject', 'session', 'claims-error'])('%s 변경이면 RPC에 전달하지 않는다', async kind => {
    if (kind === 'capability') mocks.allowed = false;
    if (kind === 'actor') mocks.actor = ids.other;
    if (kind === 'subject') mocks.claims.mockResolvedValue({ data: { claims: { sub: ids.other, session_id: ids.session } }, error: null });
    if (kind === 'session') mocks.claims.mockResolvedValue({ data: { claims: { sub: ids.actor, session_id: ids.other } }, error: null });
    if (kind === 'claims-error') mocks.claims.mockResolvedValue({ data: null, error: { message: 'secret' } });
    expect(await applyShippingSettingsTemplateAction(shippingFixtures().apply)).toMatchObject({ authChanged: true });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.revalidateGoods).not.toHaveBeenCalled();
  });
  it('지원하지 않는 필드와 과도한 대상·중복·잘못된 시각을 전송하지 않는다', async () => {
    const { save, apply } = shippingFixtures();
    expect(await saveShippingSettingsTemplateAction({ ...save, ignored: true } as typeof save)).toHaveProperty('error');
    expect(await applyShippingSettingsTemplateAction({ ...apply, ignored: true } as typeof apply)).toHaveProperty('error');
    expect(await applyShippingSettingsTemplateAction({ ...apply, goods: [apply.goods[0], apply.goods[0]] })).toHaveProperty('error');
    expect(await applyShippingSettingsTemplateAction({ ...apply, originUpdatedAt: '2026-02-30T00:00:00Z' })).toHaveProperty('error');
    expect(await previewShippingSettingsTemplateAction(ids.template, Array.from({ length: 101 }, (_, i) => `good-${i}`), identity)).toHaveProperty('error');
    expect(await previewShippingSettingsTemplateAction(ids.template, ['good-1', 'good-1'], identity)).toHaveProperty('error');
    expect(await findShippingSettingsGoodsAction('a', 0, identity)).toHaveProperty('error');
    expect(mocks.claims).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
describe('배송 정책 저장·적용과 실제 결과 결속', () => {
  it('저장의 actor/session/operation과 명시적 정책을 v2 요청으로 전달한다', async () => {
    const { save, saved, policy } = shippingFixtures();
    const input = { ...save, settings: { ...save.settings, delivery: { mode: 'replace' as const, policy } } };
    const receipt = { ...saved, template: { ...saved.template!, settings: input.settings } };
    mocks.rpc.mockResolvedValue(ok(receipt));
    expect(await saveShippingSettingsTemplateAction(input)).toEqual({ data: receipt });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_save_shipping_settings_template_v2', { p_request: input });
    expect(mocks.revalidateGoods).not.toHaveBeenCalled(); expect(mocks.revalidatePath).toHaveBeenCalledOnce();
  });
  it('적용의 원상품·합산군·정책 revision·착불 버전을 그대로 전달한다', async () => {
    const { apply, applied } = shippingFixtures(); mocks.rpc.mockResolvedValue(ok(applied));
    expect(await applyShippingSettingsTemplateAction(apply)).toEqual({ data: applied });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_apply_shipping_settings_template_v2', { p_request: apply });
    expect(mocks.revalidateGoods).toHaveBeenCalledOnce();
  });
  it.each(['save', 'apply'] as const)('봉인이 먼저 끝난 %s 요청의 확정 종료 영수증을 받아들인다', async command => {
    const fixtures = shippingFixtures(), input = fixtures[command];
    const receipt = { ...fixtures.sealed, command, expectedRevision: input.expectedRevision };
    mocks.rpc.mockResolvedValueOnce(ok(receipt));
    const result = command === 'save' ? await saveShippingSettingsTemplateAction(fixtures.save) : await applyShippingSettingsTemplateAction(fixtures.apply);
    expect(result).toEqual({ data: receipt }); expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateGoods).not.toHaveBeenCalled(); expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce(ok({ ...receipt, operationId: ids.other }));
    const mismatch = command === 'save' ? await saveShippingSettingsTemplateAction(fixtures.save) : await applyShippingSettingsTemplateAction(fixtures.apply);
    expect(mismatch).toMatchObject({ uncertain: true });
  });
  it('검색 후보의 실제 운임과 원상품 경계를 현재 identity로 읽는다', async () => {
    const { candidates } = shippingFixtures(); mocks.rpc.mockResolvedValue(ok(candidates));
    expect(await findShippingSettingsGoodsAction(' 합성 ', 1, identity)).toEqual({ data: candidates });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_search_goods_for_shipping_settings_v3', { p_query: '합성', p_page: 1,
      p_expected_actor_id: ids.actor, p_expected_session_id: ids.session });
  });
  it('미리보기의 identity·선택 상품을 대조하고 현재 확장 정책을 보존한다', async () => {
    const { preview } = shippingFixtures(); mocks.rpc.mockResolvedValueOnce(ok(preview));
    expect(await previewShippingSettingsTemplateAction(ids.template, ['good-1'], identity)).toEqual({ data: preview });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_preview_shipping_settings_template_v3', { p_template_id: ids.template, p_good_ids: ['good-1'],
      p_expected_actor_id: ids.actor, p_expected_session_id: ids.session });
    for (const data of [{ ...preview, actorId: ids.other }, { ...preview, sessionId: ids.other }, { ...preview, goods: [{ ...preview.goods[0], id: 'another' }] }]) {
      mocks.rpc.mockResolvedValueOnce(ok(data)); expect(await previewShippingSettingsTemplateAction(ids.template, ['good-1'], identity)).toHaveProperty('error');
    }
  });
  it.each(['actorId', 'sessionId', 'operationId', 'templateId'] as const)('다른 %s의 저장 영수증을 성공으로 처리하지 않는다', async field => {
    const { save, saved } = shippingFixtures(); mocks.rpc.mockResolvedValue(ok({ ...saved, [field]: ids.other }));
    expect(await saveShippingSettingsTemplateAction(save)).toMatchObject({ uncertain: true }); expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('템플릿 설정이 다르거나 적용 대상이 바뀐 영수증은 불명확 상태로 남긴다', async () => {
    const { save, saved, apply, applied } = shippingFixtures();
    mocks.rpc.mockResolvedValueOnce(ok({ ...saved, template: { ...saved.template, settings: { ...save.settings, feeType: 'individual' } } }));
    expect(await saveShippingSettingsTemplateAction(save)).toMatchObject({ uncertain: true });
    mocks.rpc.mockResolvedValueOnce(ok({ ...applied, goods: [{ ...applied.goods[0], id: 'another' }] }));
    expect(await applyShippingSettingsTemplateAction(apply)).toMatchObject({ uncertain: true }); expect(mocks.revalidateGoods).not.toHaveBeenCalled();
  });
  it('서버 오류 원문을 노출하지 않고 응답 유실을 자동 재시도하지 않는다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('synthetic secret'));
    expect(await applyShippingSettingsTemplateAction(shippingFixtures().apply)).toMatchObject({ uncertain: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'shipping_settings_goods_changed internal-secret' } });
    const result = await applyShippingSettingsTemplateAction(shippingFixtures().apply);
    expect(result).toMatchObject({ uncertain: false, conflict: true }); expect(JSON.stringify(result)).not.toContain('internal-secret');
  });
  it.each(['collect_contract_not_ready', 'goods_aggregation_policy_owned_by_source', 'checkout_contract_upgrade_required'])('%s를 새 금전 정책으로 우회하지 않는다', async message => {
    mocks.rpc.mockResolvedValue({ error: { code: 'PT409', message } });
    expect(await applyShippingSettingsTemplateAction(shippingFixtures().apply)).toMatchObject({ uncertain: false, conflict: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.revalidateGoods).not.toHaveBeenCalled();
  });
  it('이미 저장된 결과는 캐시 갱신 실패 때문에 실패로 바뀌지 않는다', async () => {
    const { apply, applied } = shippingFixtures(); mocks.rpc.mockResolvedValue(ok(applied)); mocks.revalidateGoods.mockImplementation(() => { throw new Error('cache'); });
    expect(await applyShippingSettingsTemplateAction(apply)).toEqual({ data: applied });
  });
});
describe('묶음그룹 배정과 배송 템플릿 v3 결과 결속', () => {
  it.each(['preserve', 'replace'] as const)('수령 설정 %s의 실제 적용 버전이 맞는지 확인하고 복구한다', async mode => {
    const f = shippingChargeSettingsFixtures('preserve');
    const fulfillment = mode === 'preserve' ? { mode } : { mode, policy: { mode: 'no_delivery' as const,
      methods: [{ method: 'none' as const, feeAmount: 0, feeBasis: 'per_order' as const, installationFee: 0 }], publicNote: '직접 전달', evidence: '전달 계약 확인', confirmed: true as const } };
    const settings = { ...f.settings, fulfillment }, template = { ...f.template, settings };
    const input = { ...f.apply, goods: f.apply.goods.map(g => ({ ...g, fulfillmentRevision: 2 })) };
    const receipt = { ...f.applied, template, fulfillmentVersion: 1, goods: f.applied.goods.map(g => ({ ...g, fulfillmentRevision: mode === 'replace' ? 3 : 2 })) };
    mocks.rpc.mockResolvedValueOnce(ok({ ...f.saved, template })).mockResolvedValueOnce(ok(receipt)).mockResolvedValueOnce(ok(receipt));
    expect(await saveShippingSettingsTemplateAction({ ...f.save, settings })).toEqual({ data: { ...f.saved, template } });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_save_shipping_settings_template_v3', { p_request: { ...f.save, settings } });
    expect(await applyShippingSettingsTemplateAction(input)).toEqual({ data: receipt });
    expect(await readShippingSettingsOperationAction(f.context)).toEqual({ data: receipt });
    mocks.rpc.mockResolvedValueOnce(ok({ ...receipt, goods: receipt.goods.map(g => ({ ...g, fulfillmentRevision: 9 })) }));
    expect(await applyShippingSettingsTemplateAction(input)).toMatchObject({ uncertain: true });
    expect(mocks.revalidateGoods).toHaveBeenCalledTimes(2);
  });
  it.each(['preserve', 'clear', 'assign'] as const)('%s 저장·미리보기·적용을 v3 계약으로 전달한다', async mode => {
    const f = shippingChargeSettingsFixtures(mode);
    mocks.rpc.mockResolvedValueOnce(ok(f.saved)).mockResolvedValueOnce(ok(f.preview)).mockResolvedValueOnce(ok(f.applied));
    expect(await saveShippingSettingsTemplateAction(f.save)).toEqual({ data: f.saved });
    expect(await previewShippingSettingsTemplateAction(ids.template, [f.guard.id], identity)).toEqual({ data: f.preview });
    expect(await applyShippingSettingsTemplateAction(f.apply)).toEqual({ data: f.applied });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_save_shipping_settings_template_v3', { p_request: f.save });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_preview_shipping_settings_template_v3', {
      p_template_id: ids.template, p_good_ids: [f.guard.id], p_expected_actor_id: ids.actor, p_expected_session_id: ids.session,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, 'admin_apply_shipping_settings_template_v3', { p_request: f.apply });
    expect(mocks.revalidateGoods).toHaveBeenCalledOnce();
  });
  it.each(['group', 'group-version', 'assignment-version', 'assignment-revision', 'directive'] as const)('%s가 요청과 다른 결과를 성공으로 확정하지 않는다', async field => {
    const f = shippingChargeSettingsFixtures();
    const receipt = structuredClone(f.applied);
    if (field === 'group') receipt.goods[0].groupId = ids.other;
    if (field === 'group-version') receipt.goods[0].groupRevision = f.group.revision + 1;
    if (field === 'assignment-version') Object.assign(receipt.goods[0], { assignmentVersionId: null });
    if (field === 'assignment-revision') receipt.goods[0].assignmentRevision += 1;
    if (field === 'directive') receipt.template.settings.chargeGroup = { mode: 'preserve' };
    mocks.rpc.mockResolvedValueOnce(ok(receipt));
    expect(await applyShippingSettingsTemplateAction(f.apply)).toMatchObject({ uncertain: true });
    expect(mocks.revalidateGoods).not.toHaveBeenCalled();
  });
  it('동일 그룹 재적용에서는 배정 버전을 바꾸지 않아야 한다', async () => {
    const f = shippingChargeSettingsFixtures('preserve');
    const template = { ...f.template, settings: { ...f.settings, chargeGroup: { mode: 'assign' as const, groupId: f.group.id } } };
    const apply = { ...f.apply, targetGroup: { id: f.group.id, revision: f.group.revision } };
    const receipt = { ...f.applied, template };
    mocks.rpc.mockResolvedValueOnce(ok(receipt));
    expect(await applyShippingSettingsTemplateAction(apply)).toEqual({ data: receipt });
    mocks.rpc.mockResolvedValueOnce(ok({ ...receipt, goods: [{ ...receipt.goods[0], assignmentRevision: receipt.goods[0].assignmentRevision + 1 }] }));
    expect(await applyShippingSettingsTemplateAction(apply)).toMatchObject({ uncertain: true });
    expect(mocks.revalidateGoods).toHaveBeenCalledOnce();
  });
  it('새 receipt는 결과 조회와 봉인에서도 원래 context로 복구한다', async () => {
    const f = shippingChargeSettingsFixtures('clear');
    mocks.rpc.mockResolvedValueOnce(ok(f.applied)).mockResolvedValueOnce(ok(f.applied));
    expect(await readShippingSettingsOperationAction(f.context)).toEqual({ data: f.applied });
    expect(await sealShippingSettingsOperationAction(f.context)).toEqual({ data: f.applied });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_read_shipping_settings_operation', { p_context: f.context });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_seal_shipping_settings_operation', { p_context: f.context });
  });
});
describe('결과 조회·미처리 봉인과 최신 저장본', () => {
  it('null 조회는 별도의 write 없이 null을 유지한다', async () => {
    const { context } = shippingFixtures(); mocks.rpc.mockResolvedValue(ok(null));
    expect(await readShippingSettingsOperationAction(context)).toEqual({ data: null });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_read_shipping_settings_operation', { p_context: context });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('봉인은 같은 operation context를 전달하며 늦은 원요청의 결과도 받아들인다', async () => {
    const { context, sealed, applied } = shippingFixtures(); mocks.rpc.mockResolvedValueOnce(ok(sealed));
    expect(await sealShippingSettingsOperationAction(context)).toEqual({ data: sealed });
    mocks.rpc.mockResolvedValueOnce(ok(applied)); expect(await sealShippingSettingsOperationAction(context)).toEqual({ data: applied });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_seal_shipping_settings_operation', { p_context: context }); expect(mocks.revalidateGoods).toHaveBeenCalledOnce();
  });
  it('새 actor/session의 조회와 봉인으로 기존 요청을 복구하지 않는다', async () => {
    mocks.claims.mockResolvedValue({ data: { claims: { sub: ids.actor, session_id: ids.other } }, error: null });
    expect(await readShippingSettingsOperationAction(shippingFixtures().context)).toMatchObject({ authChanged: true });
    expect(await sealShippingSettingsOperationAction(shippingFixtures().context)).toMatchObject({ authChanged: true }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('다른 요청의 조회 결과와 null 봉인 결과는 확정 성공이 아니다', async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ ...shippingFixtures().applied, actorId: ids.other }));
    expect(await readShippingSettingsOperationAction(shippingFixtures().context)).toMatchObject({ uncertain: true });
    mocks.rpc.mockResolvedValueOnce(ok(null)); expect(await sealShippingSettingsOperationAction(shippingFixtures().context)).toMatchObject({ uncertain: true });
  });
  it('현재 권한으로 단건 최신 템플릿을 검증해 입력과 비교할 수 있다', async () => {
    const { template } = shippingFixtures(); mocks.current.mockResolvedValue(ok({ id: template.id, name: template.name, revision: template.revision,
      enabled: template.enabled, settings: template.settings, created_at: template.createdAt, updated_at: template.updatedAt }));
    expect(await readShippingSettingsTemplateAction(ids.template, identity)).toEqual({ data: template });
    mocks.current.mockResolvedValueOnce(ok(null)); expect(await readShippingSettingsTemplateAction(ids.template, identity)).toEqual({ data: null });
    mocks.allowed = false; expect(await readShippingSettingsTemplateAction(ids.template, identity)).toMatchObject({ authChanged: true });
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
});
