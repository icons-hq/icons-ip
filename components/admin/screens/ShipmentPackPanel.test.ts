import { describe, expect, it, vi } from 'vitest';
import type { ShipmentPackDocument, ShipmentPackRow } from '@/lib/admin/shipment-packs';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/shipment-pack-actions', () => ({ changeShipmentPackAction: vi.fn(), readShipmentPacksAction: vi.fn() }));
vi.mock('@/components/claim-contact/ClaimContactSession', () => ({ ClaimContactSession: () => null }));
import { shipmentPackCreateBlockers } from './ShipmentPackPanel';

/*
 * S-11: 합포장을 만들 수 없을 때 "출고지시 전달 전인지, 같은 배송 조건인지 확인해주세요"라고만 하지 않고
 * 어느 배송 건이 왜 안 되는지 줄마다 말한다. 판정은 조회가 돌려준 값만 쓴다(서버의 canCreate 조건과 같다).
 */
const row = (overrides: Partial<ShipmentPackRow> = {}): ShipmentPackRow => ({ id: '60000000-0000-4000-8000-000000000001', orderId: '50000000-0000-4000-8000-000000000001',
  originName: '김포', buyerName: '구매자', recipientName: '수령인', status: 'ready', exportedAt: null, updatedAt: '2026-11-20T00:00:00Z', shippingFee: 3000, collectFee: 0, ready: true, pack: null, ...overrides });
const document = (rows: ShipmentPackRow[]): ShipmentPackDocument => ({ version: 'a'.repeat(64), canCreate: false, rows });
const second = '60000000-0000-4000-8000-000000000002';

describe('합포장을 만들 수 없는 이유', () => {
  it('배송 건마다 걸리는 조건을 그 줄의 이유로 돌려준다', () => {
    const pack = { id: '70000000-0000-4000-8000-000000000001', revision: 1, count: 2, shipmentIds: [], collectFee: 0, canRelease: true };
    const result = shipmentPackCreateBlockers(document([
      row({ exportedAt: '2026-11-20T01:00:00Z' }),
      row({ id: second, ready: false }),
      row({ id: '60000000-0000-4000-8000-000000000003', status: 'shipping' }),
      row({ id: '60000000-0000-4000-8000-000000000004', pack }),
      row({ id: '60000000-0000-4000-8000-000000000005' }),
    ]));
    expect(result.general).toBeNull();
    expect(result.rows).toEqual({
      '60000000-0000-4000-8000-000000000001': '출고지시를 이미 보냈습니다.',
      [second]: '지금은 묶을 수 없습니다. 발주확인 전이거나 취소 요청·출고 보류·예약 입고 확인 전·택배 외 배송 건인지 확인해주세요.',
      '60000000-0000-4000-8000-000000000003': '이미 발송한 배송 건입니다.',
      '60000000-0000-4000-8000-000000000004': '이미 합포장에 묶여 있습니다.',
    });
  });

  it('한 건만 골랐으면 2건 이상 골라야 한다고 말한다', () => {
    expect(shipmentPackCreateBlockers(document([row()]))).toEqual({ rows: {}, general: '합포장은 배송 건을 2건 이상 골라야 만들 수 있습니다.' });
  });

  it('줄마다 걸리는 것이 없으면 서로 다른 조건(구매자·수령인·출고지, 그 밖에는 주소·선물 포장·착불)을 말한다', () => {
    expect(shipmentPackCreateBlockers(document([row(), row({ id: second, originName: '남양주', recipientName: '다른 수령인' })])).general)
      .toBe('수령인·출고지 정보가 서로 달라 함께 포장할 수 없습니다.');
    expect(shipmentPackCreateBlockers(document([row(), row({ id: second })])).general)
      .toBe('주소나 선물 포장·착불 조건이 서로 달라 함께 포장할 수 없습니다.');
  });
});
