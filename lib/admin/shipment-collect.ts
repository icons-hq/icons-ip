import type { GoodsTransactionCollector } from '@/lib/goods-transaction';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';

/**
 * 배송 건의 착불(2026-11-12 사용자 결정 "착불 금액은 보이게"): 창고·택배사가 수령인에게 받을 착불 배송비와 착불 수납 정보.
 * 발송·배송현황 목록이 `admin_shipment_collect_summaries`(sales.dispatch)로 읽어 읽기 전용으로 보인다. 값과 출처는 출고지시 파일의
 * 배송 운영 안내 시트(계약상 착불 배송비·착불 수납 주체·수납 방법·고객 안내·착불 환급 문의)와 같다. 선결제 배송비는 담지 않는다.
 * 수납 정보가 주문 영수증에 없으면(옛 주문) collector는 null이다.
 */
export interface ShipmentCollectSummary { collectFee: number; collector: GoodsTransactionCollector | null }

/** 배송 운영 안내 시트의 머리글과 같은 이름이다. */
export const SHIPMENT_COLLECTOR_LABELS: readonly [keyof GoodsTransactionCollector, string][] = [
  ['name', '착불 수납 주체'], ['method', '수납 방법'], ['instructions', '고객 안내'], ['refundContact', '착불 환급 문의'],
];

const COLLECTOR_LIMITS: Record<keyof GoodsTransactionCollector, number> = { name: 100, method: 200, refundContact: 200, instructions: 500 };

function collectorText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && [...value].length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

export function parseShipmentCollectSummary(value: unknown): ShipmentCollectSummary | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['collectFee', 'collector']) || !transactionInteger(value.collectFee, 1)) return null;
  const collector = value.collector;
  if (collector === null) return { collectFee: value.collectFee, collector: null };
  if (!transactionRecord(collector) || !transactionExactKeys(collector, Object.keys(COLLECTOR_LIMITS))
    || !(Object.keys(COLLECTOR_LIMITS) as (keyof GoodsTransactionCollector)[]).every(key => collectorText(collector[key], COLLECTOR_LIMITS[key]))) return null;
  return { collectFee: value.collectFee, collector: { name: collector.name as string, method: collector.method as string, refundContact: collector.refundContact as string, instructions: collector.instructions as string } };
}

/**
 * `admin_shipment_collect_summaries` 응답(배송 건 id → 요약 또는 착불 없음 null)을 읽는다. 요청한 배송 건은 모두 키가 있어야 하고,
 * 모르는 키나 모양이 틀린 값이 하나라도 있으면 null을 돌려 화면이 잘못된 착불 금액을 그리지 않게 한다.
 */
export function parseShipmentCollectSummaries(value: unknown, ids: readonly string[]): Map<string, ShipmentCollectSummary | null> | null {
  if (!transactionRecord(value)) return null;
  const wanted = new Set(ids.map(id => id.toLowerCase()));
  const result = new Map<string, ShipmentCollectSummary | null>();
  for (const [key, entry] of Object.entries(value)) {
    if (!wanted.has(key.toLowerCase())) return null;
    if (entry === null) { result.set(key.toLowerCase(), null); continue; }
    const summary = parseShipmentCollectSummary(entry);
    if (!summary) return null;
    result.set(key.toLowerCase(), summary);
  }
  return result.size === wanted.size ? result : null;
}
