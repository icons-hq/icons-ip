import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';

export interface OrderReshipmentItem {
  orderItemId: string;
  goodId: string;
  name: string;
  variantId: string;
  variantName: string;
  variantCode: string;
  qty: number;
}
export interface OrderReshipmentReceipt {
  claimId: string;
  reshippedAt: string;
  items: OrderReshipmentItem[];
}

const label = (value: unknown, max: number): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

/** Actual shipment snapshots; never substitute current catalog or purchase labels. */
export function parseOrderReshipmentHistory(value: unknown): OrderReshipmentReceipt[] | null {
  if (!Array.isArray(value) || value.length > 1000) return null;
  const claims = new Set<string>();
  for (const receipt of value) {
    if (!transactionRecord(receipt) || !transactionExactKeys(receipt, ['claimId', 'reshippedAt', 'items'])
      || !isUuid(receipt.claimId) || claims.has(receipt.claimId) || !transactionInstant(receipt.reshippedAt)
      || !Array.isArray(receipt.items) || !receipt.items.length || receipt.items.length > 1000) return null;
    claims.add(receipt.claimId);
    const items = new Set<string>();
    for (const item of receipt.items) {
      if (!transactionRecord(item) || !transactionExactKeys(item, ['orderItemId', 'goodId', 'name', 'variantId', 'variantName', 'variantCode', 'qty'])
        || !isUuid(item.orderItemId) || items.has(item.orderItemId) || !isUuid(item.variantId)
        || !label(item.goodId, 200) || !label(item.name, 200) || !label(item.variantName, 200) || !label(item.variantCode, 120)
        || !transactionInteger(item.qty) || item.qty < 1 || item.qty > 2147483647) return null;
      items.add(item.orderItemId);
    }
  }
  return value as OrderReshipmentReceipt[];
}

/**
 * 교환으로 다시 보낸 소포(TKT-166·QNA-039). 배송 건(출고지)마다 하나씩이라 한 교환에 여러 개일 수 있고,
 * 교환이 끝나기 전에도 먼저 보낸 소포가 보인다. 이 기능 전의 교환은 택배사·운송장 한 쌍이 소포 하나다.
 * 출고지 이름·처리자·회수 생략 사유·근거는 고객에게 내려오지 않는다.
 */
export interface OrderReshipmentParcelItem {
  orderItemId: string;
  name: string;
  variantName: string;
  qty: number;
}
export interface OrderReshipmentParcel {
  claimId: string;
  /** 배송 건 재출고 기록 id. 이 기능 전의 클레임 단위 기록이면 null이다. */
  reshipmentId: string | null;
  carrier: string;
  trackingNumber: string;
  reshippedAt: string;
  deliveredAt: string | null;
  /** 회수 없이 다시 보낸 소포(하자·오배송 교환). */
  collectionWaived: boolean;
  items: OrderReshipmentParcelItem[];
}
/** 화면용: 택배사 레지스트리로 고친 표시 이름과 조회 링크가 붙는다. 등록되지 않은 택배사면 링크가 없다. */
export interface OrderReshipmentParcelView extends OrderReshipmentParcel {
  carrierLabel: string;
  trackingUrl: string | null;
}

export function parseOrderReshipmentParcels(value: unknown): OrderReshipmentParcel[] | null {
  if (!Array.isArray(value) || value.length > 1000) return null;
  const parcels = new Set<string>();
  for (const parcel of value) {
    if (!transactionRecord(parcel) || !transactionExactKeys(parcel, ['claimId', 'reshipmentId', 'carrier', 'trackingNumber', 'reshippedAt', 'deliveredAt', 'collectionWaived', 'items'])
      || !isUuid(parcel.claimId) || !(parcel.reshipmentId === null || isUuid(parcel.reshipmentId))
      || !label(parcel.carrier, 40) || typeof parcel.trackingNumber !== 'string' || !/^[A-Z0-9]{8,30}$/.test(parcel.trackingNumber)
      || !transactionInstant(parcel.reshippedAt) || !(parcel.deliveredAt === null || transactionInstant(parcel.deliveredAt))
      || typeof parcel.collectionWaived !== 'boolean' || !Array.isArray(parcel.items) || parcel.items.length > 1000) return null;
    const key = `${parcel.claimId}:${parcel.reshipmentId ?? 'claim'}`;
    if (parcels.has(key)) return null;
    parcels.add(key);
    for (const item of parcel.items) {
      if (!transactionRecord(item) || !transactionExactKeys(item, ['orderItemId', 'name', 'variantName', 'qty']) || !isUuid(item.orderItemId)
        || !label(item.name, 200) || !label(item.variantName, 200) || !transactionInteger(item.qty) || item.qty < 1 || item.qty > 2147483647) return null;
    }
  }
  return value as OrderReshipmentParcel[];
}
