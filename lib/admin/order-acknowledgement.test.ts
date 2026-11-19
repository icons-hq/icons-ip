import { describe, expect, it } from 'vitest';
import { parseAdminOrderAcknowledgement } from './order-acknowledgement';

const ORDER = '10000000-0000-4000-8000-000000004141';
const valid = {
  orderId: ORDER,
  acknowledgedAt: '2026-11-19T01:02:03.456789+00:00',
  noticeVersion: '2026-11-19',
  restrictedGoods: [{ goodId: 'g1', name: '각인 키링', returnAllowed: false, exchangeAllowed: null, reason: '각인 주문 제작' }],
};

describe('parseAdminOrderAcknowledgement', () => {
  it('DB가 돌려준 모양을 그대로 받는다', () => {
    expect(parseAdminOrderAcknowledgement(valid)).toEqual(valid);
    expect(parseAdminOrderAcknowledgement({ ...valid, restrictedGoods: [] })).not.toBeNull();
  });

  it('모르는 키·잘못된 값은 거절한다', () => {
    expect(parseAdminOrderAcknowledgement({ ...valid, extra: 1 })).toBeNull();
    expect(parseAdminOrderAcknowledgement({ ...valid, orderId: 'x' })).toBeNull();
    expect(parseAdminOrderAcknowledgement({ ...valid, acknowledgedAt: '어제' })).toBeNull();
    expect(parseAdminOrderAcknowledgement({ ...valid, noticeVersion: '' })).toBeNull();
    expect(parseAdminOrderAcknowledgement({ ...valid, restrictedGoods: 'none' })).toBeNull();
    expect(parseAdminOrderAcknowledgement({ ...valid, restrictedGoods: [{ goodId: 'g1' }] })).toBeNull();
    expect(parseAdminOrderAcknowledgement(null)).toBeNull();
  });
});
