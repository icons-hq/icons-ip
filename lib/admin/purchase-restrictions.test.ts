import { describe, expect, it } from 'vitest';
import { normalizePurchaseRestrictionFilters, normalizePurchaseRestrictionRegistration, normalizePurchaseRestrictionRelease, purchaseRestrictionsHref } from './purchase-restrictions';
const id = '11111111-1111-4111-8111-111111111111';
function registration(extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ requestId: id, userId: id, reasonCode: 'other', reasonDetail: ' 근거 ', confirmed: 'on', ...extra })) form.set(key,value);
  return form;
}
describe('purchase restriction inputs', () => {
  it('rejects missing scope acknowledgement, invalid identifiers and excessive reason', () => {
    expect(normalizePurchaseRestrictionRegistration(registration({ confirmed: '' }))).toHaveProperty('error');
    expect(normalizePurchaseRestrictionRegistration(registration({ evidenceOrderId: 'not-an-order' }))).toHaveProperty('error');
    expect(normalizePurchaseRestrictionRegistration(registration({ reasonDetail: 'a'.repeat(201) }))).toHaveProperty('error');
    expect(normalizePurchaseRestrictionRegistration(registration())).toEqual({ value: { requestId: id, userId: id, reasonCode:'other', reasonDetail:'근거', evidenceOrderId:null } });
  });
  it('requires a reason for release and binds the specific restriction', () => {
    const form = new FormData();form.set('restrictionId',id);
    expect(normalizePurchaseRestrictionRelease(form)).toHaveProperty('error');
    form.set('reason',' 확인 후 해제 ');
    expect(normalizePurchaseRestrictionRelease(form)).toEqual({ value: { restrictionId:id,reason:'확인 후 해제' } });
  });
  it('accepts deterministic PostgreSQL UUIDs generated for batch registrations', () => {
    const batchChildId = 'ef06cd85-52d7-cf71-536e-795fbd980ee4';
    const form = new FormData();
    form.set('restrictionId', batchChildId);
    form.set('reason', '복수등록 검토 후 해제');
    expect(normalizePurchaseRestrictionRelease(form)).toEqual({ value: { restrictionId: batchChildId, reason: '복수등록 검토 후 해제' } });
    form.set('restrictionId', 'not-a-uuid');
    expect(normalizePurchaseRestrictionRelease(form)).toEqual({ error: '구매제한 기록을 다시 조회해주세요.' });
  });
  it('bounds pagination and preserves history selection in links', () => {
    const filters = normalizePurchaseRestrictionFilters({ state:'released',query:' fan ',pageSize:'100',page:'999999999' });
    expect(filters).toEqual({ state:'released',query:'fan',pageSize:100,page:1001 });
    expect(purchaseRestrictionsHref(filters)).toContain('state=released&query=fan&page=1001&pageSize=100');
    expect(normalizePurchaseRestrictionFilters({ state:'invalid',page:'-1',pageSize:'999' })).toMatchObject({ state:'active',page:1,pageSize:20 });
  });
});
