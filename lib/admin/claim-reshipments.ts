import type { AdminClaimDetail, AdminClaimReshipItem } from './claims.server';
import type { ClaimDefectiveItem } from './defective-stock';

/*
 * 교환 재출고 진행(TKT-166·QNA-039, ADR-0041).
 *
 * 재출고는 배송 건(출고지)마다 기록한다. 배송 건 기록이 없는 클레임은 이 기능 전의 클레임 단위 기록(옛 단일 열)이
 * 그대로 진실원이다. 화면은 이 모듈 하나에서 '재출고 n/m'·'도착 확인 n/m'과 지금 등록할 수 있는 배송 건을 읽는다.
 */

type Claim = AdminClaimDetail['claim'];

export interface AdminClaimReshipmentProgress {
  /** 재출고할 배송 건 수. 옛 클레임 단위 기록은 1이다. */
  total: number;
  reshipped: number;
  delivered: number;
  waived: number;
  /** 배송 건 기록 없이 옛 단일 열로만 남은 재출고. */
  legacy: boolean;
}

export function adminClaimReshipmentProgress(claim: Claim): AdminClaimReshipmentProgress {
  const rows = claim.reshipments ?? [];
  if (rows.length === 0) {
    /* 이 기능 전에 종결된 교환은 출고지가 몇 곳이었든 클레임당 한 쌍(택배사·운송장)이 기록 전부다. */
    const reshipped = claim.reshippedAt && claim.reshipTrackingNumber ? 1 : 0;
    return { total: reshipped ? 1 : Math.max(1, (claim.reshipmentTargets ?? []).length), reshipped, delivered: claim.reshipDeliveredAt ? 1 : 0, waived: 0, legacy: reshipped > 0 };
  }
  return {
    total: Math.max(rows.length, (claim.reshipmentTargets ?? []).length),
    reshipped: rows.length,
    delivered: rows.filter(row => row.deliveredAt !== null).length,
    waived: rows.filter(row => row.collectionWaived).length,
    legacy: false,
  };
}

/**
 * 지금 재출고를 등록할 수 있는 배송 건.
 *
 * - 회수를 확인했거나 회수 생략을 먼저 결정한(waived) 배송 건.
 * - 회수 확인 전이어도 하자·오배송 교환이면 같은 요청에서 회수 없이 보낼 수 있다(waivable). 다만 주문제작 상품이 있는
 *   배송 건은 교환품을 새로 만들어야 하므로 여기 넣지 않는다 — 먼저 회수 생략을 결정해 제작을 연다(adminClaimWaiverDecisions).
 * - 교환품 제작이 끝나지 않은 배송 건은 넣지 않는다(제작 완료 뒤 재출고, DB가 production_incomplete로 다시 막는다).
 */
export interface AdminClaimPendingReshipment {
  shipmentId: string | null;
  originName: string | null;
  collected: boolean;
  waivable: boolean;
  /** 회수 생략을 이미 결정했다. 재출고 때 사유·사진을 다시 받지 않는다. */
  waived: boolean;
  orderItemIds: string[];
  /** 회수품 재고 처리에서 불량으로 고른 품목(CLM-046). 재출고 때 판매 재고로 되돌리지 않고 불량 재고에 기록한다. */
  defectiveOrderItemIds: string[];
}

function reshipmentOpen(claim: Claim) {
  return claim.claimType === 'exchange' && (claim.stage === 'collecting' || claim.stage === 'collected') && !claim.reshipTrackingNumber;
}

/**
 * 반품지가 갈린 배송 건에서 묶음 일부만 입고된 상태(배송 건 행은 모든 묶음이 입고돼야 입고 처리된다). 입고된 묶음의 품목이 이미
 * 돌아왔으므로 회수 생략(결정·재출고)은 DB가 collection_waiver_partially_received로 거절한다 — 화면도 그 선택지를 열지 않는다.
 */
export function adminClaimShipmentPartiallyReceived(claim: Claim, shipmentId: string | null) {
  const collection = shipmentId ? (claim.collections ?? []).find(row => row.shipmentId === shipmentId) : undefined;
  return Boolean(collection && collection.collectedAt === null && (collection.bundles ?? []).some(bundle => bundle.collectedAt !== null));
}

function targetCollected(claim: Claim, target: NonNullable<Claim['reshipmentTargets']>[number]) {
  return target.collectionTracked ? target.collectedAt !== null : claim.stage === 'collected';
}

export function adminClaimPendingReshipments(claim: Claim): AdminClaimPendingReshipment[] {
  if (!reshipmentOpen(claim)) return [];
  return (claim.reshipmentTargets ?? []).filter(target => !target.reshipped).flatMap((target) => {
    const collected = targetCollected(claim, target);
    const waived = target.waiver !== null;
    const waivable = target.collectionTracked && !collected && !waived && claim.collectionWaiverAllowed === true && !target.productionRequired
      && !adminClaimShipmentPartiallyReceived(claim, target.shipmentId);
    if ((collected || waived) && target.productionPending) return [];
    /* 하자·오배송 교환의 회수품은 재고 처리(불량 분리·정상 복원)를 정해야 재출고한다(CLM-046). DB도 exchange_stock_decision_required로 막는다. */
    if (adminClaimStockDecisionPending(claim, target)) return [];
    return collected || waived || waivable
      ? [{ shipmentId: target.shipmentId, originName: target.originName, collected, waivable, waived, orderItemIds: target.orderItemIds,
        defectiveOrderItemIds: collected && !waived ? target.stockDecision?.defectiveOrderItemIds ?? [] : [] }]
      : [];
  });
}

type Target = NonNullable<Claim['reshipmentTargets']>[number];

/** 회수품 재고 처리를 고를 수 있는 배송 건: 회수를 확인했고(회수 생략 아님) 아직 재출고하지 않았다. */
function stockChoiceOpen(claim: Claim, target: Target) {
  return reshipmentOpen(claim) && !target.reshipped && target.waiver === null && targetCollected(claim, target) && Boolean(target.stockDecision);
}

/**
 * 재출고 전에 회수품 재고 처리를 정해야 하는 배송 건(CLM-046): 하자·오배송 교환에서 회수를 확인했고 회수 생략이 아니며 아직 정하지 않았다.
 * 결정이 없는 옛 응답(stockDecision 없음)은 막지 않는다 — 그때는 DB가 재출고에서 다시 막는다.
 */
export function adminClaimStockDecisionPending(claim: Claim, target: Target) {
  return stockChoiceOpen(claim, target) && target.stockDecision?.required === true && !target.stockDecision.decided;
}

/** 출고지 하나의 회수품 재고 처리 칸. 품목은 그 배송 건의 회수 품목(살아 있는 수량)이다. */
export interface AdminClaimExchangeStockTarget {
  shipmentId: string | null;
  originName: string | null;
  /** 하자·오배송 교환이라 재출고 전에 정해야 한다. */
  required: boolean;
  decided: boolean;
  decidedAt: string | null;
  decidedByName: string | null;
  items: ClaimDefectiveItem[];
}

/** 교환 상세의 '회수품 재고 처리' 칸에 그릴 배송 건. 단순 변심 교환도 원하면 불량을 고를 수 있다. */
export function adminClaimExchangeStockTargets(claim: Claim, orderItems: readonly AdminClaimReshipItem[]): AdminClaimExchangeStockTarget[] {
  if (claim.claimType !== 'exchange') return [];
  return (claim.reshipmentTargets ?? []).filter(target => stockChoiceOpen(claim, target)).map((target) => {
    const decision = target.stockDecision!;
    return {
      shipmentId: target.shipmentId, originName: target.originName, required: decision.required, decided: decision.decided,
      decidedAt: decision.decidedAt, decidedByName: decision.decidedByName,
      items: orderItems.filter(item => target.orderItemIds.includes(item.id)).map((item) => {
        const defective = decision.defectiveOrderItemIds.includes(item.id);
        return { orderItemId: item.id, name: item.name, variantName: item.variantName, qty: item.qty, defective, state: defective ? 'planned' as const : null };
      }),
    };
  });
}

/** 아직 재출고하지 않은 대상 배송 건 수. 1이면 지금 등록하는 재출고가 교환을 종결한다. */
export function adminClaimRemainingReshipments(claim: Claim) {
  return (claim.reshipmentTargets ?? []).filter(target => !target.reshipped).length;
}

/**
 * 회수 생략을 먼저 결정해야 하는 배송 건: 하자·오배송 교환에서 아직 회수하지 않은, 주문제작 상품이 있는 배송 건.
 * 결정하면 교환품 제작이 열리고, 제작이 끝나면 회수 확인 없이 재출고한다.
 */
export function adminClaimWaiverDecisions(claim: Claim) {
  if (!reshipmentOpen(claim) || claim.collectionWaiverAllowed !== true) return [];
  return (claim.reshipmentTargets ?? []).filter(target => !target.reshipped && target.collectionTracked && target.shipmentId !== null
    && !targetCollected(claim, target) && target.waiver === null && target.productionRequired && !adminClaimShipmentPartiallyReceived(claim, target.shipmentId));
}
