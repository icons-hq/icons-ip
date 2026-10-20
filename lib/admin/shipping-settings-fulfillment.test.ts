import { expect, it } from 'vitest';
import { shippingChargeSettingsFixtures } from '@/test/fixtures/shipping-settings-charge-groups';
import type { GoodsFulfillment } from '@/lib/goods-fulfillment';
import { parseShippingSettingsFulfillment, prepareShippingFulfillment, shippingFulfillmentAfter, shippingFulfillmentDraft, type ShippingSettingsFulfillment } from './shipping-settings-fulfillment';
import { parseShippingSettingsApplyInput, parseShippingSettingsGoodGuard, parseShippingSettingsOperationReceipt, parseShippingSettingsSaveRequest, shippingSettingsGoodGuard } from './shipping-settings-templates';
import { parseShippingSettingsPreview } from './shipping-settings-templates.server';

const replacement: ShippingSettingsFulfillment = { mode: 'replace', policy: { mode: 'shipping', methods: [
  { method: 'direct', feeAmount: 2500, feeBasis: 'per_item', installationFee: 1000 },
  { method: 'pickup', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 },
], publicNote: '설치 일정 사전 협의', evidence: '계약 확인 완료', confirmed: true } };
function fixture(directive = replacement) {
  const f = shippingChargeSettingsFixtures('preserve');
  const before: GoodsFulfillment = { goodId: f.guard.id, revision: 3, mode: 'digital', methods: [{ method: 'digital', feeAmount: 0, feeBasis: 'per_order', installationFee: 0 }],
    files: [{ id: '92000000-0000-4000-8000-000000000099', name: '합성.pdf', mimeType: 'application/pdf', size: 100 }], publicNote: '' };
  const template = { ...f.template, settings: { ...f.settings, fulfillment: directive } }, guard = { ...f.guard, fulfillmentRevision: 3 };
  const preview = { ...f.preview, template, goods: [{ ...f.preview.goods[0], ...guard, after: template.settings,
    effectiveBefore: { ...f.preview.goods[0].effectiveBefore, fulfillment: before },
    effectiveAfter: { ...f.preview.goods[0].effectiveAfter, fulfillment: shippingFulfillmentAfter(before, directive) } }] };
  return { ...f, guard, preview, template, before, save: { ...f.save, settings: template.settings }, apply: { ...f.apply, goods: [guard] },
    applied: { ...f.applied, template, fulfillmentVersion: 1, goods: [{ ...f.applied.goods[0], fulfillmentRevision: directive.mode === 'replace' ? 4 : 3 }] } };
}
it('기존 파일·수령 조건 유지와 명시적 변경을 미리보기와 영수증에 결속한다', () => {
  for (const d of [replacement, { mode: 'preserve' } as const]) {
    const f = fixture(d);
    expect(parseShippingSettingsSaveRequest(f.save)).toEqual(f.save);
    expect(parseShippingSettingsApplyInput(f.apply)).toEqual(f.apply);
    expect(parseShippingSettingsPreview(f.preview)).toEqual(f.preview);
    expect(parseShippingSettingsOperationReceipt(f.applied)).toEqual(f.applied);
    expect(shippingSettingsGoodGuard(f.preview.goods[0])).toEqual(f.guard);
  }
});
it('템플릿의 디지털 파일 지정·숨은 필드·미확인 요금·잘못된 단위를 거절한다', () => {
  if (replacement.mode !== 'replace') throw Error('fixture');
  const p = replacement.policy;
  for (const policy of [{ ...p, mode: 'digital' }, { ...p, assetIds: [] }, { ...p, confirmed: false }, { ...p, evidence: ' ' },
    { ...p, methods: [] }, { ...p, methods: [p.methods[0], p.methods[0]] }, { ...p, methods: [{ ...p.methods[0], feeAmount: 1.5 }] },
    { ...p, methods: [{ ...p.methods[1], installationFee: 100 }] }, { ...p, publicNote: '제어\n문자' }]) {
    expect(parseShippingSettingsFulfillment({ mode: 'replace', policy })).toBeNull();
  }
  expect(parseShippingSettingsFulfillment({ mode: 'preserve', policy: p })).toBeNull();
});
it('수정 초안은 재확인이 필요하고 숫자를 비우거나 음수로 입력하면 거절한다', () => {
  if (replacement.mode !== 'replace') throw Error('fixture');
  const d = shippingFulfillmentDraft(replacement);
  expect(prepareShippingFulfillment(d)).toBeNull();
  expect(prepareShippingFulfillment({ ...d, confirmed: true })).toEqual({ ...replacement, policy: { ...replacement.policy, methods: [replacement.policy.methods[1], replacement.policy.methods[0]] } });
  expect(prepareShippingFulfillment({ ...d, confirmed: true, methods: d.methods.map(m => ({ ...m, feeAmount: '' })) })).toBeNull();
  expect(prepareShippingFulfillment({ ...d, confirmed: true, methods: d.methods.map(m => ({ ...m, installationFee: '-1' })) })).toBeNull();
  expect(prepareShippingFulfillment({ ...d, action: 'preserve' })).toEqual({ mode: 'preserve' });
});
it('미리보기의 상품·버전·파일 해제·금액 변조를 거절한다', () => {
  const f = fixture(), row = f.preview.goods[0];
  for (const patch of [{ fulfillmentRevision: 2 }, { fulfillmentRevision: undefined },
    { effectiveAfter: { ...row.effectiveAfter, fulfillment: f.before } },
    { effectiveAfter: { ...row.effectiveAfter, fulfillment: { ...row.effectiveAfter.fulfillment, files: f.before.files } } },
    { effectiveBefore: { ...row.effectiveBefore, fulfillment: { ...f.before, goodId: 'other' } } }]) {
    expect(parseShippingSettingsPreview({ ...f.preview, goods: [{ ...row, ...patch }] })).toBeNull();
  }
});
it('잘못된 CAS와 수령 변경 영수증의 버전 누락을 거절한다', () => {
  const f = fixture();
  for (const value of [-1, 0.1, undefined, '3']) expect(parseShippingSettingsGoodGuard({ ...f.guard, fulfillmentRevision: value })).toBeNull();
  const missing: Record<string, unknown> = { ...f.applied }; delete missing.fulfillmentVersion;
  expect(parseShippingSettingsOperationReceipt(missing)).toBeNull();
  expect(parseShippingSettingsOperationReceipt({ ...f.applied, fulfillmentVersion: 2 })).toBeNull();
  expect(parseShippingSettingsOperationReceipt({ ...f.applied, goods: f.applied.goods.map(g => ({ ...g, fulfillmentRevision: undefined })) })).toBeNull();
  expect(parseShippingSettingsApplyInput({ ...f.apply, goods: [f.guard, { ...f.guard, id: 'other', fulfillmentRevision: undefined }] })).toBeNull();
});
