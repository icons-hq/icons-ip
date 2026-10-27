import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
import { loadOrderItemAllocations, loadOrderItemAllocationsForScreen, withLegacyItemAmounts, withSmartStoreLegacyAllocations } from './item-allocation.server';
import type { ShipmentExportData } from './shipment-dispatch';

const ORDER = '10000000-0000-4000-8000-000000002714';
const input = {
  orderId: ORDER, calculationVersion: 1, couponDiscount: 1000, storeCredits: 500, volumeDiscount: 0,
  coupon: { discountAmount: 1000, eligibleSubtotal: 10000, terms: { goodsScope: 'all', targetGoodIds: [] } },
  items: [
    { id: 'item-a', goodId: 'g', qty: 1, unitPrice: 6000, regularUnitPrice: 7000, allocation: null },
    { id: 'item-b', goodId: 'g', qty: 2, unitPrice: 2000, regularUnitPrice: null, allocation: null },
  ],
};
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: [input], error: null }); });

it('주문 당시 기록을 읽어 버전 1 할인 주문을 품목별로 나눈다', async () => {
  const loaded = await loadOrderItemAllocations([ORDER, ORDER.toUpperCase(), 'not-a-uuid']);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_order_item_allocation_inputs', { p_order_ids: [ORDER] });
  expect(loaded.get('item-a')?.allocation).toEqual({ source: 'legacy', volumeDiscount: 0, couponDiscount: 600, storeCreditDiscount: 300, paidGoodsTotal: 5100 });
  expect(loaded.get('item-b')?.allocation).toEqual({ source: 'legacy', volumeDiscount: 0, couponDiscount: 400, storeCreditDiscount: 200, paidGoodsTotal: 3400 });
  await expect(loadOrderItemAllocations([])).resolves.toEqual(new Map());
  expect(rpc).toHaveBeenCalledTimes(1);
});

it('조회 실패는 화면에서만 빈칸으로 낮추고 엑셀 경로에는 그대로 알린다', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } });
  await expect(loadOrderItemAllocations([ORDER])).rejects.toThrow('order_item_allocation_load_failed');
  await expect(loadOrderItemAllocationsForScreen([ORDER])).resolves.toEqual(new Map());
});

it('스마트스토어 양식의 비어 있는 버전 1 품목 금액만 채우고 정가가 없으면 할인액은 비운다', async () => {
  const loaded = await loadOrderItemAllocations([ORDER]);
  expect(withLegacyItemAmounts({ itemId: 'item-a', itemTotal: null, itemDiscount: null, sellerDiscount: null }, loaded))
    .toEqual({ itemId: 'item-a', itemTotal: 5100, itemDiscount: 1900, sellerDiscount: 1900 });
  expect(withLegacyItemAmounts({ itemId: 'item-b', itemTotal: null, itemDiscount: null, sellerDiscount: null }, loaded))
    .toEqual({ itemId: 'item-b', itemTotal: 3400, itemDiscount: null, sellerDiscount: null });
  const recorded = { itemId: 'item-a', itemTotal: 9999, itemDiscount: 1, sellerDiscount: 1 };
  expect(withLegacyItemAmounts(recorded, loaded)).toBe(recorded);
});

it('74열 출고지시는 비어 있는 품목이 있을 때만 배분을 읽는다', async () => {
  const line = { shipmentId: 's', orderId: ORDER, recipient: '', phone: '', postalCode: '', address: '', goodCode: '', variantCode: '', goodName: '', optionName: '', qty: 1, unitPrice: 6000, deliveryNote: '', carrier: '' };
  const smartstore = { itemId: 'item-a', itemTotal: null, itemDiscount: null, sellerDiscount: null } as unknown as NonNullable<ShipmentExportData['shipments'][number]['lines'][number]['smartstore']>;
  const data = { shipments: [{ id: 's', updatedAt: '', originId: 'o', originName: '김포', shippingFee: 0, template: 'standard', columns: [], lines: [{ ...line, smartstore }] }] } as ShipmentExportData;
  const filled = await withSmartStoreLegacyAllocations(data);
  expect(filled.shipments[0].lines[0].smartstore).toMatchObject({ itemTotal: 5100, itemDiscount: 1900, sellerDiscount: 1900 });
  rpc.mockClear();
  const complete = { shipments: [{ ...data.shipments[0], lines: [{ ...line, smartstore: { ...smartstore, itemTotal: 6000 } }] }] } as ShipmentExportData;
  expect(await withSmartStoreLegacyAllocations(complete)).toBe(complete);
  expect(rpc).not.toHaveBeenCalled();
});
