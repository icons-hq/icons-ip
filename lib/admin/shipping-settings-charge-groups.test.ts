import { expect, it } from 'vitest';
import { shippingFixtures } from '@/test/fixtures/shipping-settings';
import { shippingChargeSettingsFixtures } from '@/test/fixtures/shipping-settings-charge-groups';
import { parseShippingSettingsApplyInput, parseShippingSettingsChargeGroup, parseShippingSettingsGoodGuard,
  parseShippingSettingsOperationReceipt, parseShippingSettingsSaveRequest, shippingSettingsGoodGuard, SHIPPING_SETTINGS_CHARGE_GUARD_KEYS } from './shipping-settings-templates';
import { parseShippingSettingsPreview } from './shipping-settings-templates.server';

it('구형 요청·영수증과 유지/해제/지정의 새 형식을 각각 읽는다', () => {
  const old = shippingFixtures();
  expect(parseShippingSettingsApplyInput(old.apply)).toEqual(old.apply);
  expect(parseShippingSettingsOperationReceipt(old.applied)).toEqual(old.applied);
  for (const mode of ['preserve', 'clear', 'assign'] as const) {
    const f = shippingChargeSettingsFixtures(mode);
    expect(parseShippingSettingsSaveRequest(f.save)).toEqual(f.save);
    expect(parseShippingSettingsApplyInput(f.apply)).toEqual(f.apply);
    expect(parseShippingSettingsOperationReceipt(f.applied)).toEqual(f.applied);
    expect(parseShippingSettingsPreview(f.preview)).toEqual(f.preview);
    expect(shippingSettingsGoodGuard(f.preview.goods[0])).toEqual(f.guard);
  }
});

it('배정 지시의 null·누락·추가 키와 일부만 있는 CAS를 거절한다', () => {
  for (const input of [null, {}, { mode: 'assign' }, { mode: 'clear', groupId: null }, { mode: 'preserve', revision: 1 }]) {
    expect(parseShippingSettingsChargeGroup(input)).toBeNull();
  }
  const f = shippingChargeSettingsFixtures();
  expect(parseShippingSettingsGoodGuard({ ...f.guard, assignmentVersionId: undefined })).toBeNull();
  expect(parseShippingSettingsGoodGuard({ ...f.guard, groupId: f.group.id })).toBeNull();
  expect(parseShippingSettingsApplyInput({ ...f.apply, goods: [shippingFixtures().guard] })).toBeNull();
  const noTarget = { ...f.apply }; delete (noTarget as { targetGroup?: unknown }).targetGroup;
  expect(parseShippingSettingsApplyInput(noTarget)).toBeNull();
});

it('미리보기의 그룹 버전·현재 배정·지정 대상과 변경 후가 일치해야 한다', () => {
  const f = shippingChargeSettingsFixtures();
  expect(parseShippingSettingsPreview({ ...f.preview, targetGroup: { ...f.group, revision: 3 } })).toBeNull();
  expect(parseShippingSettingsPreview({ ...f.preview, goods: [{ ...f.preview.goods[0], groupId: f.group.id, groupRevision: 2 }] })).toBeNull();
  expect(parseShippingSettingsPreview({ ...f.preview, goods: [{ ...f.preview.goods[0], effectiveAfter: { ...f.preview.goods[0].effectiveAfter, chargeGroup: null } }] })).toBeNull();
  const unknown = { ...f.preview }; delete (unknown as { targetGroup?: unknown }).targetGroup;
  expect(parseShippingSettingsPreview(unknown)).toBeNull();
});

it('신규 applied receipt의 marker와 모든 행의 배정 guard를 함께 요구한다', () => {
  const { applied } = shippingChargeSettingsFixtures();
  const withoutGuard = (row: object) => Object.fromEntries(Object.entries(row).filter(([key]) => !SHIPPING_SETTINGS_CHARGE_GUARD_KEYS.includes(key as typeof SHIPPING_SETTINGS_CHARGE_GUARD_KEYS[number])));
  const noMarker: Record<string, unknown> = { ...applied }; delete noMarker.chargeGroupVersion;
  expect(parseShippingSettingsOperationReceipt(noMarker)).toBeNull();
  expect(parseShippingSettingsOperationReceipt({ ...noMarker, goods: applied.goods.map(withoutGuard) })).toBeNull();
  expect(parseShippingSettingsOperationReceipt({ ...applied, goods: applied.goods.map(withoutGuard) })).toBeNull();
  expect(parseShippingSettingsOperationReceipt({ ...applied, appliedCount: 2, goods: [applied.goods[0], { ...withoutGuard(applied.goods[0]), id: 'other-good' }] })).toBeNull();
});

it.each([null, undefined, 0, 2, '1'])('잘못된 신규 receipt marker %s를 구형 형식으로 우회하지 않는다', chargeGroupVersion => {
  const { applied } = shippingChargeSettingsFixtures();
  expect(parseShippingSettingsOperationReceipt({ ...applied, chargeGroupVersion })).toBeNull();
});

it('구형 템플릿의 v3 적용도 명시 marker로 읽고 저장·봉인에는 marker를 허용하지 않는다', () => {
  const old = shippingFixtures(), enhanced = shippingChargeSettingsFixtures();
  const receipt = { ...enhanced.applied, template: old.applied.template };
  expect(parseShippingSettingsOperationReceipt(receipt)).toEqual(receipt);
  expect(parseShippingSettingsOperationReceipt(old.applied)).toEqual(old.applied);
  expect(parseShippingSettingsOperationReceipt({ ...enhanced.saved, chargeGroupVersion: 1 })).toBeNull();
  expect(parseShippingSettingsOperationReceipt({ ...old.sealed, chargeGroupVersion: 1 })).toBeNull();
});
