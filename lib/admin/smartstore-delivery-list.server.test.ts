import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
import { loadSmartStoreDeliveryLines } from './smartstore-delivery-list.server';
import { smartStoreDeliveryLine } from './smartstore-delivery-list.fixture';
import { AdminListExportChangedError, AdminListExportLoadError } from './list-export-errors';
import type { ShipmentConsoleRow } from './shipment-dispatch';

const line = smartStoreDeliveryLine();
const row = { id: line.shipmentId, orderId: line.orderId, updatedAt: line.shipmentUpdatedAt,
  items: [{ id: line.itemId, qty: line.qty }] } as ShipmentConsoleRow;
beforeEach(() => { rpc.mockReset(); });
describe('배송 목록과 엑셀 행의 연결 검증', () => {
  it('현재 목록의 정확한 상품·배송 건만 읽고 빈 목록은 DB를 호출하지 않는다', async () => {
    expect(await loadSmartStoreDeliveryLines([])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: [line], error: null });
    expect(await loadSmartStoreDeliveryLines([row])).toEqual([line]);
    expect(rpc).toHaveBeenCalledWith('admin_delivery_list_export_lines', { p_ids: [line.shipmentId] });
  });
  it.each([
    ['배송 건 수정', [{ ...line, shipmentUpdatedAt: '2026-10-21T00:01:00Z' }]],
    ['품목 누락', []], ['중복 품목', [line, line]], ['수량 변경', [{ ...line, qty: 3 }]],
    ['다른 주문', [{ ...line, orderId: '60000000-0000-4000-8000-000000000009' }]],
  ])('%s이면 부분 파일을 반환하지 않는다', async (_name, data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(loadSmartStoreDeliveryLines([row])).rejects.toBeInstanceOf(AdminListExportChangedError);
  });
  it('버전 1 할인 주문의 비어 있는 품목 금액은 거래확정 엑셀과 같은 공통 배분으로 채운다', async () => {
    const legacy = { ...line, itemTotal: null, itemDiscount: null, sellerDiscount: null };
    rpc.mockImplementation(async (name: string) => name === 'admin_delivery_list_export_lines' ? { data: [legacy], error: null } : { data: [{
      orderId: line.orderId, calculationVersion: 1, couponDiscount: 2000, storeCredits: 0, volumeDiscount: 0,
      coupon: { discountAmount: 2000, eligibleSubtotal: 20000, terms: { goodsScope: 'all', targetGoodIds: [] } },
      items: [{ id: line.itemId, goodId: line.goodId, qty: 2, unitPrice: 10000, regularUnitPrice: 11000, allocation: null }],
    }], error: null });
    expect(await loadSmartStoreDeliveryLines([row])).toEqual([{ ...legacy, itemTotal: 18000, itemDiscount: 4000, sellerDiscount: 4000 }]);
    expect(rpc).toHaveBeenLastCalledWith('admin_order_item_allocation_inputs', { p_order_ids: [line.orderId] });
    rpc.mockImplementation(async (name: string) => name === 'admin_delivery_list_export_lines' ? { data: [legacy], error: null } : { data: null, error: { message: 'boom' } });
    await expect(loadSmartStoreDeliveryLines([row])).rejects.toBeInstanceOf(AdminListExportLoadError);
  });
  it('권한·조회 오류를 파일로 바꾸지 않는다', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } });
    await expect(loadSmartStoreDeliveryLines([row])).rejects.toBeInstanceOf(AdminListExportLoadError);
  });
});
