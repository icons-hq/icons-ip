import { describe, expect, it } from 'vitest';
import {
  parsePurchaseConfirmationAutoPreview, purchaseConfirmationAutoEnableConfirm, purchaseConfirmationAutoEnableUnreadConfirm,
  purchaseConfirmationPolicyReadback, purchaseConfirmationPolicySavedMessage, validConfirmationDays,
} from './purchase-confirmation-preview';

const preview = { autoAfterDays: 7, orderCount: 12, storeCreditTotal: 3400, perRunLimit: 1000, remainingDueCount: 0, asOf: '2026-11-26T03:00:00.123456+00:00' };

describe('자동 거래확정 미리 읽은 값', () => {
  it('DB가 돌려주는 모양만 받는다', () => {
    expect(parsePurchaseConfirmationAutoPreview(preview)).toEqual(preview);
    for (const bad of [null, [], { ...preview, extra: 1 }, { ...preview, orderCount: -1 }, { ...preview, storeCreditTotal: 1.5 }, { ...preview, autoAfterDays: 0 },
      { ...preview, perRunLimit: 0 }, { ...preview, remainingDueCount: -1 }, { ...preview, asOf: '오늘' }, { orderCount: 1 },
      /* 넘어가는 주문 수가 없는 옛 모양은 받지 않는다(화면은 읽지 못한 것으로 다룬다). */
      { autoAfterDays: 7, orderCount: 12, storeCreditTotal: 3400, perRunLimit: 1000, asOf: preview.asOf }]) {
      expect(parsePurchaseConfirmationAutoPreview(bad)).toBeNull();
    }
  });
});

describe('자동 거래확정을 켜기 전 확인창', () => {
  it('확정될 주문 수와 지급될 적립금, 되돌릴 수 없음, 지금 기준임을 말한다', () => {
    const confirm = purchaseConfirmationAutoEnableConfirm(preview);
    expect(confirm.title).toBe('자동 거래확정을 켤까요?');
    expect(confirm.message.split('\n')).toEqual([
      '지금 켜면 주문 12건이 다음 03:00 (KST) 자동 처리 때 거래확정되고, 적립금 3,400원이 지급됩니다. 되돌릴 수 없습니다.',
      '대상은 배송완료 뒤 7일이 지난 주문입니다. 전에 자동 확정 기한을 받은 주문은 그 기한을 따릅니다.',
      '지금 기준 수치입니다. 자동 처리 때까지 기한이 되는 주문이 더 있거나 취소·반품·교환이 접수되면 달라집니다.',
    ]);
    expect(confirm).toMatchObject({ confirmLabel: '자동 거래확정 켜기', cancelLabel: '돌아가기', destructive: true });
  });

  it('지급할 적립금이 없으면 없다고 말한다', () => {
    expect(purchaseConfirmationAutoEnableConfirm({ ...preview, storeCreditTotal: 0 }).message)
      .toContain('주문 12건이 다음 03:00 (KST) 자동 처리 때 거래확정되고, 지급할 적립금은 없습니다. 되돌릴 수 없습니다.');
  });

  /* 건수와 적립금은 다음 실행 한 번의 값이다. 넘어가는 주문이 있으면 그 범위를 사실대로 말한다. */
  it('자동 처리 한 번의 한도를 넘으면 다음 실행분의 수치와 넘어가는 주문 수를 나눠 말한다', () => {
    const lines = purchaseConfirmationAutoEnableConfirm({ ...preview, orderCount: 1000, storeCreditTotal: 84660, remainingDueCount: 1300 }).message.split('\n');
    expect(lines).toEqual([
      '지금 켜면 주문 1,000건이 다음 03:00 (KST) 자동 처리 때 거래확정되고, 적립금 84,660원이 지급됩니다. 되돌릴 수 없습니다.',
      '한 번에 1,000건까지 거래확정합니다. 기한이 지난 배송완료 주문이 1,300건 더 있고, 취소·반품·교환이 진행 중인 주문 등을 뺀 나머지는 다음 날부터 차례로 거래확정됩니다. 그 주문의 적립금은 위 금액에 들어 있지 않습니다.',
      '대상은 배송완료 뒤 7일이 지난 주문입니다. 전에 자동 확정 기한을 받은 주문은 그 기한을 따릅니다.',
      '지금 기준 수치입니다. 자동 처리 때까지 기한이 되는 주문이 더 있거나 취소·반품·교환이 접수되면 달라집니다.',
    ]);
    /* 넘어가는 주문이 없으면 한도를 말하지 않는다(다음 실행분이 대상의 전부다). */
    expect(purchaseConfirmationAutoEnableConfirm({ ...preview, orderCount: 1000 }).message).not.toContain('한 번에');
  });

  it('주문 수를 읽지 못했으면 수치 없이 저장하면 일어나는 일만 말하고 [그래도 저장]으로 묻는다', () => {
    const confirm = purchaseConfirmationAutoEnableUnreadConfirm(7);
    expect(confirm.title).toBe('자동 거래확정을 켤까요?');
    expect(confirm.message.split('\n')).toEqual([
      '지금 켜면 거래확정될 주문 수와 지급될 적립금을 읽지 못했습니다.',
      '그래도 저장하면 배송완료 뒤 7일이 지난 주문이 다음 03:00 (KST) 자동 처리부터 거래확정되고, 주문할 때의 적립 조건대로 적립금이 지급됩니다. 되돌릴 수 없습니다.',
      '[돌아가기]를 누른 뒤 [저장]을 다시 누르면 주문 수를 다시 읽습니다.',
    ]);
    expect(confirm).toMatchObject({ confirmLabel: '그래도 저장', cancelLabel: '돌아가기', destructive: true });
    expect(confirm.message).not.toMatch(/[0-9,]+건/);
  });

  it('바로 확정될 주문이 없으면 앞으로 일어날 일만 말하고 위험색을 쓰지 않는다', () => {
    const confirm = purchaseConfirmationAutoEnableConfirm({ ...preview, orderCount: 0, storeCreditTotal: 0 });
    expect(confirm.message.split('\n')).toEqual([
      '지금 기준으로 바로 거래확정되는 주문은 없습니다.',
      '켜 두면 배송완료 뒤 7일이 지난 주문이 매일 03:00 (KST)에 거래확정되고, 주문할 때의 적립 조건대로 적립금이 지급됩니다.',
    ]);
    expect(confirm.destructive).toBeUndefined();
    expect(confirm.confirmLabel).toBe('자동 거래확정 켜기');
  });
});

describe('정책 한 줄 요약과 저장 결과', () => {
  it('기간은 1~36,500의 숫자만 받는다', () => {
    for (const ok of ['1', '8', '36500']) expect(validConfirmationDays(ok)).toBe(true);
    for (const bad of ['', '0', '08', '1.5', '-3', '36501', '8일']) expect(validConfirmationDays(bad)).toBe(false);
  });

  it('적은 기간을 문장으로 되읽는다', () => {
    expect(purchaseConfirmationPolicyReadback({ autoEnabled: true, days: '8', extension: '' }))
      .toBe('배송완료 뒤 8일이 지난 주문을 매일 03:00 (KST)에 거래확정하고 적립금을 지급합니다. 구매자는 자동 확정을 미룰 수 없습니다.');
    expect(purchaseConfirmationPolicyReadback({ autoEnabled: true, days: '8', extension: '3' }))
      .toBe('배송완료 뒤 8일이 지난 주문을 매일 03:00 (KST)에 거래확정하고 적립금을 지급합니다. 구매자는 자동 확정을 한 번, 3일 미룰 수 있습니다.');
    /* 연장 칸이 틀린 값이면 지어내지 않고 기간까지만 말한다. */
    expect(purchaseConfirmationPolicyReadback({ autoEnabled: true, days: '8', extension: '0' }))
      .toBe('배송완료 뒤 8일이 지난 주문을 매일 03:00 (KST)에 거래확정하고 적립금을 지급합니다.');
    expect(purchaseConfirmationPolicyReadback({ autoEnabled: true, days: '', extension: '3' })).toBeNull();
    expect(purchaseConfirmationPolicyReadback({ autoEnabled: false, days: '8', extension: '3' })).toBeNull();
  });

  it('저장 결과는 켰는지·껐는지·기간만 바꿨는지에 따라 달라진 것을 말한다', () => {
    const on = { autoEnabled: true }, off = { autoEnabled: false };
    expect(purchaseConfirmationPolicySavedMessage(off, on)).toBe('자동 거래확정을 켰습니다. 기한이 지난 주문은 다음 03:00 (KST) 자동 처리부터 거래확정됩니다.');
    expect(purchaseConfirmationPolicySavedMessage(on, off)).toBe('자동 거래확정을 껐습니다. 앞으로는 자동으로 거래확정하지 않습니다. 이미 거래확정된 주문은 그대로입니다.');
    expect(purchaseConfirmationPolicySavedMessage(on, on)).toBe('저장했습니다. 지금부터 배송완료되는 주문에 적용합니다. 이미 기한을 받은 주문은 그 기한 그대로입니다.');
    expect(purchaseConfirmationPolicySavedMessage(off, off)).toBe('저장했습니다. 자동 거래확정은 꺼져 있습니다.');
  });
});
