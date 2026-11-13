import type { GoodsTransactionDisplay } from '@/lib/goods-transaction';
import { isUuid } from '@/lib/uuid';

/*
 * 클레임 상세의 주문 품목과 원 거래 영수증(버전 2 주문의 불변 결제 기록)의 대조.
 *
 * 영수증은 결제 당시 그대로다. 클레임 상세(admin_order_claim_detail)의 품목은 재고 부족 부분 취소(ADR-0032) 뒤 '살아 있는 수량'이고,
 * 모두 취소된 품목은 빠진다. 그래서 대조식은 영수증 줄마다 '원 수량 − 적용된 부분 취소 수량'이다. 같은 RPC가 품목별 적용된 부분 취소
 * 수량(partialCancels)을 함께 싣는다(20261113170000). 대조는 느슨하게 하지 않는다 — 줄 하나라도 어긋나면 환불·재출고를 시작하지
 * 않도록 로더가 멈춘다(돈 안전).
 *
 * 버전 1 주문은 영수증이 없어(admin_get_order_transaction_receipts가 null) 이 대조를 지나지 않는다. 버전 1 부분 취소(T12c)의 파생
 * 배분 원장은 영수증이 아니므로 여기에 끼어들지 않는다.
 */

export interface ClaimSnapshotItem {
  id: string;
  variantId: string;
  qty: number;
  unitPrice: number;
}

export interface ClaimPartialCancelQty {
  orderItemId: string;
  canceledQty: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

/**
 * RPC의 order.partialCancels를 좁힌다. 없으면(부분 취소 기능 이전 응답) 빈 배열 — 그때도 대조는 원 수량 그대로라 느슨해지지 않는다.
 * 모양이 어긋나면 null(로더가 멈춘다).
 */
export function parseClaimPartialCancels(value: unknown): ClaimPartialCancelQty[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const rows: ClaimPartialCancelQty[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!record(entry) || Object.keys(entry).length !== 2 || typeof entry.orderItemId !== 'string' || !isUuid(entry.orderItemId)
      || !count(entry.canceledQty, 1)) return null;
    const id = entry.orderItemId.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    rows.push({ orderItemId: id, canceledQty: entry.canceledQty });
  }
  return rows;
}

/** RPC의 order.items를 대조에 쓰는 칸만 좁힌다. 한 줄이라도 모양이 어긋나면 null이다. */
export function parseClaimSnapshotItems(value: unknown): ClaimSnapshotItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: ClaimSnapshotItem[] = [];
  for (const entry of value) {
    if (!record(entry) || typeof entry.id !== 'string' || typeof entry.variantId !== 'string') return null;
    const qty = typeof entry.qty === 'string' ? Number(entry.qty) : entry.qty;
    const unitPrice = typeof entry.unitPrice === 'string' ? Number(entry.unitPrice) : entry.unitPrice;
    if (!count(qty, 1) || !count(unitPrice, 0)) return null;
    items.push({ id: entry.id, variantId: entry.variantId, qty, unitPrice });
  }
  return items;
}

/**
 * 영수증과 클레임 상세 품목이 맞는가.
 * - 온라인 결제 총액이 주문 총액과 같다(부분 취소는 주문 총액을 바꾸지 않는다 — 환불은 원장에서 뺀다).
 * - 부분 취소 수량은 영수증에 있는 줄만, 그 줄의 원 수량 이하로만 있다.
 * - 영수증 줄마다 남은 수량(원 수량 − 부분 취소 수량)이 1 이상이면 같은 품목·옵션·단가·남은 수량의 상세 품목이 정확히 하나 있고,
 *   0이면(모두 취소) 상세 품목에 없다. 상세 품목은 이 줄들 말고 더 없다.
 */
export function claimItemsMatchTransaction(
  transaction: Pick<GoodsTransactionDisplay, 'lines' | 'totals'>,
  order: { total: number; items: readonly ClaimSnapshotItem[]; partialCancels: readonly ClaimPartialCancelQty[] },
): boolean {
  if (transaction.totals.onlineTotal !== order.total) return false;
  const canceled = new Map(order.partialCancels.map((row) => [row.orderItemId.toLowerCase(), row.canceledQty]));
  const lineIds = new Set(transaction.lines.map((line) => line.lineId.toLowerCase()));
  if (lineIds.size !== transaction.lines.length) return false;
  for (const id of canceled.keys()) if (!lineIds.has(id)) return false;
  let activeLines = 0;
  for (const line of transaction.lines) {
    const id = line.lineId.toLowerCase();
    const remaining = line.qty - (canceled.get(id) ?? 0);
    if (remaining < 0) return false;
    const matches = order.items.filter((item) => item.id.toLowerCase() === id);
    if (remaining === 0) {
      if (matches.length) return false;
      continue;
    }
    activeLines += 1;
    if (matches.length !== 1) return false;
    const [item] = matches;
    if (item.variantId !== line.variantId || item.qty !== remaining || item.unitPrice !== line.unitPrice) return false;
  }
  return order.items.length === activeLines;
}

/* ---- 로더 실패 이유 ---------------------------------------------------------------------------------------------- */

/** 클레임 상세 로더가 멈춘 이유. 처리 액션(단건·일괄)이 이 코드로 운영자 문구를 고른다. */
export type AdminClaimDetailLoadCode =
  | 'claim_unavailable'
  | 'claim_access_denied'
  | 'transaction_receipt_unavailable'
  | 'transaction_snapshot_mismatch'
  | 'gift_requester_invalid'
  | 'seller_intake_invalid';

export class AdminClaimDetailLoadError extends Error {
  readonly code: AdminClaimDetailLoadCode;

  constructor(code: AdminClaimDetailLoadCode, message: string) {
    super(message);
    this.name = 'AdminClaimDetailLoadError';
    this.code = code;
  }
}

const UNCHANGED = '환불·재고·재출고는 진행하지 않았고 그대로입니다.';

const LOAD_FAILURE_COPY: Record<AdminClaimDetailLoadCode, string> = {
  claim_unavailable: `요청 정보를 읽지 못해 처리하지 않았습니다. ${UNCHANGED} 새로고침한 뒤 다시 시도해주세요.`,
  claim_access_denied: `이 요청을 처리할 권한이 없습니다. ${UNCHANGED} 반품·교환 처리 권한을 확인해주세요.`,
  transaction_receipt_unavailable: `주문의 결제 기록(거래 영수증)을 읽지 못해 처리하지 않았습니다. ${UNCHANGED} 잠시 뒤 다시 시도해주세요.`,
  transaction_snapshot_mismatch: `주문 상품·수량이 결제 기록(거래 영수증)과 맞지 않아 처리하지 않았습니다. ${UNCHANGED} 주문 상세에서 상품과 부분 취소 이력을 확인한 뒤 개발 담당자에게 알려주세요.`,
  gift_requester_invalid: `선물 요청자 정보를 확인하지 못해 처리하지 않았습니다. ${UNCHANGED} 새로고침한 뒤 다시 시도해주세요.`,
  seller_intake_invalid: `판매자 대리 접수 근거를 확인하지 못해 처리하지 않았습니다. ${UNCHANGED} 새로고침한 뒤 다시 시도해주세요.`,
};

/** 로더 실패를 운영자 문구로 옮긴다. 이유를 알 수 없는 실패는 fallback이다. 원문 코드는 노출하지 않는다. */
export function adminClaimDetailLoadFailureMessage(error: unknown, fallback: string): string {
  return error instanceof AdminClaimDetailLoadError ? LOAD_FAILURE_COPY[error.code] : fallback;
}
