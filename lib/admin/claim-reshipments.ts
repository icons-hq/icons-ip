import type { AdminClaimDetail } from './claims.server';

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
    const reshipped = claim.reshippedAt && claim.reshipTrackingNumber ? 1 : 0;
    return { total: Math.max(1, (claim.reshipmentTargets ?? []).length), reshipped, delivered: claim.reshipDeliveredAt ? 1 : 0, waived: 0, legacy: reshipped > 0 };
  }
  return {
    total: Math.max(rows.length, (claim.reshipmentTargets ?? []).length),
    reshipped: rows.length,
    delivered: rows.filter(row => row.deliveredAt !== null).length,
    waived: rows.filter(row => row.collectionWaived).length,
    legacy: false,
  };
}

/** 지금 재출고를 등록할 수 있는 배송 건. 회수 확인 전 배송 건은 하자·오배송 교환일 때만 회수 없이 보낼 수 있다. */
export interface AdminClaimPendingReshipment {
  shipmentId: string | null;
  originName: string | null;
  collected: boolean;
  waivable: boolean;
  orderItemIds: string[];
}

export function adminClaimPendingReshipments(claim: Claim): AdminClaimPendingReshipment[] {
  if (claim.claimType !== 'exchange' || (claim.stage !== 'collecting' && claim.stage !== 'collected') || claim.reshipTrackingNumber) return [];
  return (claim.reshipmentTargets ?? []).filter(target => !target.reshipped).flatMap((target) => {
    const collected = target.collectionTracked ? target.collectedAt !== null : claim.stage === 'collected';
    const waivable = target.collectionTracked && !collected && claim.collectionWaiverAllowed === true;
    return collected || waivable
      ? [{ shipmentId: target.shipmentId, originName: target.originName, collected, waivable, orderItemIds: target.orderItemIds }]
      : [];
  });
}
