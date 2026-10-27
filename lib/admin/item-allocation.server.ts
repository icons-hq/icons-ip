import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import type { ShipmentExportData } from './shipment-dispatch';
import {
  orderItemAllocations, parseOrderAllocationInputs, smartStoreItemDiscount,
  type OrderAllocationInput, type OrderItemAllocation,
} from './item-allocation';

type Client = Awaited<ReturnType<typeof createClient>>;
export interface LoadedItemAllocation { allocation: OrderItemAllocation; item: OrderAllocationInput['items'][number] }

/**
 * 주문 당시 기록을 읽어 품목별 쿠폰·적립금 배분 후 금액을 계산한다(공통 규칙 `orderItemAllocations`).
 * 배분할 수 없는 주문의 품목은 Map에 없다. 조회가 실패하면 던진다 — 화면은 받아서 빈칸으로 두고,
 * 엑셀은 일부 빈칸 파일을 만들지 않고 실패시킨다.
 */
export async function loadOrderItemAllocations(orderIds: readonly string[], client?: Client): Promise<Map<string, LoadedItemAllocation>> {
  const ids = [...new Set(orderIds.filter(id => isUuid(id)).map(id => id.toLowerCase()))];
  const result = new Map<string, LoadedItemAllocation>();
  if (!ids.length) return result;
  const supabase = client ?? await createClient();
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const { data, error } = await supabase.rpc('admin_order_item_allocation_inputs', { p_order_ids: ids.slice(offset, offset + 1000) });
    if (error) throw new Error('order_item_allocation_load_failed');
    for (const order of parseOrderAllocationInputs(data)) {
      const allocations = orderItemAllocations(order);
      for (const item of order.items) {
        const allocation = allocations.get(item.id);
        if (allocation) result.set(item.id, { allocation, item });
      }
    }
  }
  return result;
}

/** 화면용: 실패해도 주문 화면을 막지 않고 배분 칸만 비운다. */
export async function loadOrderItemAllocationsForScreen(orderIds: readonly string[]): Promise<Map<string, LoadedItemAllocation>> {
  try { return await loadOrderItemAllocations(orderIds); } catch { return new Map(); }
}

/**
 * 스마트스토어 74·53열에서 DB가 비워 둔 버전 1 할인 주문 품목의 `상품별 총 주문금액`·`상품별 할인액`을
 * 공통 배분으로 채운다. 이미 값이 있는 행(버전 2 원장·할인 없는 버전 1)은 그대로 둔다.
 */
export function withLegacyItemAmounts<T extends { itemId: string; itemTotal: number | null; itemDiscount: number | null; sellerDiscount: number | null }>(
  line: T, loaded: ReadonlyMap<string, LoadedItemAllocation>,
): T {
  if (line.itemTotal !== null) return line;
  const found = loaded.get(line.itemId);
  if (!found || found.allocation.source !== 'legacy') return line;
  const discount = smartStoreItemDiscount(found.item, found.allocation);
  return { ...line, itemTotal: found.allocation.paidGoodsTotal, itemDiscount: discount, sellerDiscount: discount };
}

/** 74열 출고지시: 버전 1 할인 주문의 비어 있는 품목 금액을 채운 사본을 돌려준다. */
export async function withSmartStoreLegacyAllocations(data: ShipmentExportData, client?: Client): Promise<ShipmentExportData> {
  const pending = data.shipments.flatMap(shipment => shipment.lines ?? []).filter(line => line.smartstore && line.smartstore.itemTotal === null);
  if (!pending.length) return data;
  const loaded = await loadOrderItemAllocations(pending.map(line => line.orderId), client);
  return { ...data, shipments: data.shipments.map(shipment => ({ ...shipment, lines: shipment.lines.map(line => line.smartstore
    ? { ...line, smartstore: withLegacyItemAmounts(line.smartstore, loaded) } : line) })) };
}
