import { describe, expect, it } from 'vitest';
import { normalizeShippingSettingsFilters, parseShippingSettingsTemplateForm, shippingSettingsExtraChanges, shippingSettingsFeeLabel, shippingSettingsFeeText, shippingSettingsHref,
  shippingSettingsMoney, shippingSettingsPreviewSplit, shippingSettingsRuntimeBlocked, shippingSettingsRuntimeOffSaved, SHIPPING_SETTINGS_BLOCKER_LABELS, type ShippingSettings } from './shipping-settings-templates';
import { shippingFixtures } from '@/test/fixtures/shipping-settings';
function form(values: Record<string, string> = {}) { const data = new FormData(); for (const [key, value] of Object.entries({
  id: '00000000-0000-4000-8000-000000063211', revision: '0', name: '기본 배송', enabled: 'true', originId: '00000000-0000-4000-8000-000000042201',
  feeType: 'policy', individualFee: '3500', claimReturnAllowed: '', claimExchangeAllowed: 'true', claimRestrictionReason: '', claimReturnFee: '', claimReturnFreeShippingFee: '0', claimExchangeFee: '6000', ...values,
})) data.set(key, value); return data; }
describe('배송정보 템플릿 입력 계약', () => {
  it('개별 배송비가 비활성일 때도 입력을 보관하고 비용의 미확인/무료를 구분한다', () => {
    expect(parseShippingSettingsTemplateForm(form())).toMatchObject({ ok: true, settings: { feeType: 'policy', individualFee: 3500,
      claimPolicy: { returnAllowed: null, exchangeAllowed: true, returnFee: null, returnFreeShippingFee: 0, exchangeFee: 6000 } } });
    expect(shippingSettingsFeeLabel({ feeType: 'policy', individualFee: 3500 })).toBe('출고지 정책 따름');
    expect(shippingSettingsMoney(null)).toBe('미확인'); expect(shippingSettingsMoney(0)).toBe('0원');
  });
  it('출고지 누락, 지원하지 않는 운임, 과도한 비용과 이유 없는 제한을 거부한다', () => {
    expect(parseShippingSettingsTemplateForm(form({ originId: '', feeType: 'cod', individualFee: '1000001', claimReturnAllowed: 'false' }))).toMatchObject({ ok: false,
      errors: { originId: expect.any(String), feeType: expect.any(String), individualFee: expect.any(String), claimRestrictionReason: expect.any(String) } });
    expect(parseShippingSettingsTemplateForm(form({ claimReturnFee: '1.5' }))).toMatchObject({ ok: false });
  });
  it('출고지 정책 따름에는 그 출고지의 금액을 붙여 보인다', () => {
    expect(shippingSettingsFeeText({ feeType: 'policy', individualFee: 0 }, { baseFee: 3000, freeThreshold: 50000 })).toBe('출고지 정책 따름 · 3,000원 · 50,000원 이상 무료');
    expect(shippingSettingsFeeText({ feeType: 'policy', individualFee: 0 }, { baseFee: 3000, freeThreshold: null })).toBe('출고지 정책 따름 · 3,000원');
    expect(shippingSettingsFeeText({ feeType: 'policy', individualFee: 0 })).toBe('출고지 정책 따름');
    expect(shippingSettingsFeeText({ feeType: 'individual', individualFee: 3500 }, { baseFee: 3000, freeThreshold: null })).toBe('개별 3,500원');
  });
  it('템플릿이 함께 바꾸는 것과, 주문 설정이 꺼져 있으면 적용되지 않는 것을 가른다', () => {
    const { settings, policy } = shippingFixtures();
    const fulfillment = { mode: 'replace' as const, policy: { mode: 'no_delivery' as const, methods: [{ method: 'none' as const, feeAmount: 0, feeBasis: 'per_order' as const, installationFee: 0 }], publicNote: '' } };
    expect(shippingSettingsExtraChanges(settings)).toEqual([]); expect(shippingSettingsRuntimeBlocked(settings)).toEqual([]);
    const off: ShippingSettings = { ...settings, delivery: { mode: 'replace', policy: { ...policy, status: 'disabled' } }, chargeGroup: { mode: 'preserve' }, fulfillment: { mode: 'preserve' } };
    expect(shippingSettingsExtraChanges(off)).toEqual(['수량별·착불 설정']);
    /* '사용 안 함'으로 바꾸는 것은 주문 설정과 관계없이 적용된다(DB의 shipping_settings_delivery_blocker와 같다). */
    expect(shippingSettingsRuntimeBlocked(off)).toEqual([]);
    const all: ShippingSettings = { ...settings, delivery: { mode: 'replace', policy }, chargeGroup: { mode: 'clear' }, fulfillment };
    expect(shippingSettingsExtraChanges(all)).toEqual(['수량별·착불 설정', '묶음그룹', '수령 방식']);
    expect(shippingSettingsRuntimeBlocked(all)).toEqual(['수량별·착불 설정', '묶음그룹', '수령 방식']);
    expect(shippingSettingsRuntimeOffSaved(['묶음그룹', '수령 방식'])).toContain('함께 바꾸는 것(묶음그룹, 수령 방식)의 체크를 끄고 저장하면');
  });
  it('미리보기에서 조건이 안 맞는 상품만 건너뛰고 이유를 붙인다', () => {
    const { preview } = shippingFixtures(), good = preview.goods[0];
    expect(shippingSettingsPreviewSplit(preview)).toEqual({ ready: [good], skipped: [] });
    const mixed = { ...preview, canApply: false, goods: [good, { ...good, id: 'good-2', name: '착불 상품', blocker: 'collect_contract_not_ready' as const },
      { ...good, id: 'child', name: '나눈 상품', ownerGoodId: 'good-1', familyGoodIds: ['child', 'good-1'], editable: false, blocker: 'goods_aggregation_policy_owned_by_source' as const }] };
    const split = shippingSettingsPreviewSplit(mixed);
    expect(split.ready).toEqual([good]);
    expect(split.skipped).toEqual([{ id: 'good-2', name: '착불 상품', reason: SHIPPING_SETTINGS_BLOCKER_LABELS.collect_contract_not_ready },
      { id: 'child', name: '나눈 상품', reason: SHIPPING_SETTINGS_BLOCKER_LABELS.goods_aggregation_policy_owned_by_source }]);
  });
  it('검색과 사용 상태를 페이지 이동에 보존한다', () => {
    const filters = normalizeShippingSettingsFilters({ q: ' 기본 ', state: 'disabled', page: '2' });
    expect(shippingSettingsHref(filters)).toBe('/admin/settings/shipping-templates?q=%EA%B8%B0%EB%B3%B8&state=disabled&page=2');
    expect(normalizeShippingSettingsFilters({ state: 'bogus', page: '-2' })).toEqual({ query: '', state: 'all', page: 1 });
  });
});
