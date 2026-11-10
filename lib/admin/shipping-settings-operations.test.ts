import { describe, expect, it } from 'vitest';
import {
  parseShippingSettingsApplyInput, parseShippingSettingsDelivery, parseShippingSettingsOperationContext, parseShippingSettingsOperationReceipt,
  parseShippingSettingsSaveRequest, parseShippingSettingsTemplateForm, shippingSettingsDelivery, shippingSettingsOperationContext, shippingSettingsReceiptMatches,
  type ShippingSettingsApplyInput, type ShippingSettingsOperationReceipt, type ShippingSettingsSaveRequest,
} from './shipping-settings-templates';

const actor = 'a7150000-0000-4000-8000-000000000001', session = 'a7150000-0000-4000-8000-000000000011';
const templateId = 'a7150000-0000-4000-8000-000000000201', operationId = 'a7150000-0000-4000-8000-000000000301';
const instant = '2026-10-14T10:00:00.123456Z';
const settings = { originId: 'a7150000-0000-4000-8000-000000000101', feeType: 'free' as const, individualFee: 100,
  claimPolicy: { returnAllowed: true, exchangeAllowed: true, restrictionReason: null, returnFee: 0, returnFreeShippingFee: null, exchangeFee: 6000 } };
const policy = { status: 'active' as const, paymentMode: 'collect' as const, quantityTerms: { kind: 'repeat' as const, baseFee: 3000, interval: 2 }, draftValues: {} };
const context = { operationId, command: 'apply' as const, templateId, expectedRevision: 1, expectedActorId: actor, expectedSessionId: session };
const apply: ShippingSettingsApplyInput = { ...context, originUpdatedAt: instant, collectRevision: 0, collectVersionId: null,
  goods: [{ id: 'good-one', updatedAt: instant, ownerGoodId: 'good-one', ownerUpdatedAt: instant, familyGoodIds: ['good-one'], transactionRevision: 0, deliveryVersionId: null }] };
const save: ShippingSettingsSaveRequest = { ...context, command: 'save', expectedRevision: 0, name: '확장 배송', enabled: true,
  settings: { ...settings, delivery: { mode: 'replace', policy } } };
const receipt: ShippingSettingsOperationReceipt = { state: 'applied', operationId, command: 'apply', templateId, expectedRevision: 1, actorId: actor, sessionId: session,
  template: { id: templateId, name: '확장 배송', revision: 1, enabled: true, settings, createdAt: instant, updatedAt: instant }, appliedCount: 1,
  goods: [{ id: 'good-one', updatedAt: instant, transactionRevision: 1, deliveryVersionId: 'a7150000-0000-4000-8000-000000000401' }] };

describe('배송정보 확장 정책과 원자 적용 요청', () => {
  it('legacy 누락은 유지이고 disabled 교체는 명시적 새 정책이다', () => {
    expect(shippingSettingsDelivery(settings)).toEqual({ mode: 'preserve' });
    expect(parseShippingSettingsDelivery({ mode: 'preserve' })).toEqual({ mode: 'preserve' });
    expect(parseShippingSettingsDelivery({ mode: 'replace', policy: { ...policy, status: 'disabled' } })).toMatchObject({ mode: 'replace', policy: { status: 'disabled' } });
    expect(parseShippingSettingsDelivery(null)).toBeNull();
    expect(parseShippingSettingsDelivery({ mode: 'clear' })).toBeNull();
    expect(parseShippingSettingsDelivery({ mode: 'preserve', policy })).toBeNull();
    expect(parseShippingSettingsDelivery({ mode: 'replace', policy: { ...policy, quantityTerms: { kind: 'tier3', baseFee: 1, firstLimit: 2, secondLimit: 1, extra1: 0, extra2: 0 } } })).toBeNull();
  });
  it('FormData는 확장 미지정 유지와 실제 policy JSON을 구분한다', () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ id: templateId, revision: '0', name: '배송', enabled: 'true', originId: settings.originId,
      feeType: 'free', individualFee: '100', claimReturnAllowed: 'true', claimExchangeAllowed: 'true', claimRestrictionReason: '', claimReturnFee: '0', claimReturnFreeShippingFee: '', claimExchangeFee: '6000' })) form.set(key, value);
    expect(parseShippingSettingsTemplateForm(form)).toMatchObject({ ok: true, settings: { delivery: { mode: 'preserve' } } });
    form.set('delivery', JSON.stringify({ mode: 'replace', policy }));
    expect(parseShippingSettingsTemplateForm(form)).toMatchObject({ ok: true, settings: { delivery: { mode: 'replace', policy } } });
    form.set('delivery', 'null');
    expect(parseShippingSettingsTemplateForm(form)).toMatchObject({ ok: false, errors: { delivery: expect.any(String) } });
  });
  it('상품·정책·출고지·가족 구성의 원문을 보존한다', () => {
    expect(parseShippingSettingsSaveRequest(save)).toEqual(save);
    expect(parseShippingSettingsApplyInput(apply)).toEqual(apply);
    expect(shippingSettingsOperationContext(apply)).toEqual(context);
    expect(parseShippingSettingsOperationContext(context)).toEqual(context);
    expect(parseShippingSettingsOperationContext(apply)).toBeNull();
  });
  it.each([
    { ...apply, expectedSessionId: '' }, { ...apply, command: 'save' }, { ...apply, expectedRevision: 0 },
    { ...apply, collectRevision: 1, collectVersionId: null }, { ...apply, originUpdatedAt: '2026-02-30T00:00:00Z' },
    { ...apply, goods: [] }, { ...apply, goods: [apply.goods[0], apply.goods[0]] },
    { ...apply, goods: [{ ...apply.goods[0], familyGoodIds: [] }] },
    { ...apply, goods: [{ ...apply.goods[0], familyGoodIds: ['another'] }] },
    { ...apply, goods: [{ ...apply.goods[0], familyGoodIds: ['good-one', 'good-one'] }] },
    { ...apply, goods: [{ ...apply.goods[0], ownerUpdatedAt: '2026-10-14T10:00:00.123455Z' }] },
    { ...apply, goods: [{ ...apply.goods[0], deliveryVersionId: operationId }] },
    { ...apply, extra: true },
  ])('인증·CAS·대상 결속이 잘못된 요청을 거절한다 %#', invalid => expect(parseShippingSettingsApplyInput(invalid)).toBeNull());
  it('100개까지 허용하고 101개를 거절한다', () => {
    const goods = Array.from({ length: 101 }, (_, index) => ({ ...apply.goods[0], id: `good-${index}`, ownerGoodId: `good-${index}`, familyGoodIds: [`good-${index}`] }));
    expect(parseShippingSettingsApplyInput({ ...apply, goods: goods.slice(0, 100) })).not.toBeNull();
    expect(parseShippingSettingsApplyInput({ ...apply, goods })).toBeNull();
  });
});

describe('배송정보 operation 복구 영수증', () => {
  it('결과는 actor/session/context에 결속하고 null을 완료로 만들지 않는다', () => {
    expect(parseShippingSettingsOperationReceipt(receipt)).toEqual(receipt);
    expect(parseShippingSettingsOperationReceipt(null)).toBeNull();
    expect(shippingSettingsReceiptMatches(receipt, context)).toBe(true);
    expect(shippingSettingsReceiptMatches(receipt, { ...context, expectedSessionId: operationId })).toBe(false);
    expect(shippingSettingsReceiptMatches(receipt, { ...context, templateId: operationId })).toBe(false);
    expect(shippingSettingsReceiptMatches(receipt, { ...context, expectedRevision: 2 })).toBe(false);
  });
  it('봉인에는 템플릿 변경이나 적용 상품이 없다', () => {
    const sealed = { ...receipt, state: 'sealed', template: null, appliedCount: 0, goods: [] };
    expect(parseShippingSettingsOperationReceipt(sealed)).toEqual(sealed);
    expect(parseShippingSettingsOperationReceipt({ ...sealed, template: receipt.template })).toBeNull();
    expect(parseShippingSettingsOperationReceipt({ ...sealed, goods: receipt.goods })).toBeNull();
  });
  it.each([
    { ...receipt, state: 'saved' }, { ...receipt, appliedCount: 2 }, { ...receipt, sessionId: '' },
    { ...receipt, template: { ...receipt.template!, revision: 2 } }, { ...receipt, template: null },
    { ...receipt, goods: [{ ...receipt.goods[0], transactionRevision: 0 }] },
  ])('잘못된 결과를 성공으로 받아들이지 않는다 %#', invalid => expect(parseShippingSettingsOperationReceipt(invalid)).toBeNull());
});
