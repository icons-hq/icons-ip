import { describe, expect, it } from 'vitest';
import { parsePurchaseConfirmation, parsePurchaseConfirmationPolicy } from './purchase-confirmation';
const at = '2026-10-16T05:00:00Z', id = 'ac160000-0000-4000-8000-000000000001';
const value = { orderId: id, revision: 0, status: 'delivered', confirmedAt: null, confirmationKind: null, autoDueAt: null, automaticActive: false, held: false, holdReason: null,
  extensionUsed: false, extensionDays: null, requestedAt: null, canConfirm: true, canExtend: false, history: [] };
describe('구매확정 응답', () => {
  it('자동 꺼짐과 미설정 기간을 보존하고 활성에 필요한 기간을 검사한다', () => {
    const policy = { revision: 1, autoEnabled: false, autoAfterDays: null, buyerExtensionDays: null, evidence: '', updatedAt: at };
    expect(parsePurchaseConfirmationPolicy(policy)).toEqual(policy);
    expect(parsePurchaseConfirmationPolicy({ ...policy, autoEnabled: true })).toBeNull();
    expect(parsePurchaseConfirmationPolicy({ ...policy, autoAfterDays: 0 })).toBeNull();
  });
  it('고객 확인 버튼에 보류·배송완료·연장 조건이 모순되면 표시하지 않는다', () => {
    expect(parsePurchaseConfirmation(value)).toEqual(value);
    for (const patch of [{ held: true }, { status: 'paid' }, { canExtend: true }, { extensionDays: -1 }, { automaticActive: null }]) expect(parsePurchaseConfirmation({ ...value, ...patch })).toBeNull();
  });
  it('확정 뒤에도 취소 원장은 별도로 남으며 알 수 없는 이력을 성공으로 해석하지 않는다', () => {
    const done = { ...value, status: 'done', confirmedAt: at, confirmationKind: 'buyer', canConfirm: false, history: [{ id, kind: 'confirm', note: '', at }] };
    expect(parsePurchaseConfirmation(done)).toEqual(done);
    expect(parsePurchaseConfirmation({ ...done, history: [{ id, kind: 'fake', note: '', at }] })).toBeNull();
    expect(parsePurchaseConfirmation({ ...done, history: [...done.history, ...done.history] })).toBeNull();
  });
});
