import { describe, expect, it } from 'vitest';
import { normalizeShippingSettingsFilters, parseShippingSettingsTemplateForm, shippingSettingsFeeLabel, shippingSettingsHref, shippingSettingsMoney } from './shipping-settings-templates';
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
  it('검색과 사용 상태를 페이지 이동에 보존한다', () => {
    const filters = normalizeShippingSettingsFilters({ q: ' 기본 ', state: 'disabled', page: '2' });
    expect(shippingSettingsHref(filters)).toBe('/admin/settings/shipping-templates?q=%EA%B8%B0%EB%B3%B8&state=disabled&page=2');
    expect(normalizeShippingSettingsFilters({ state: 'bogus', page: '-2' })).toEqual({ query: '', state: 'all', page: 1 });
  });
});
