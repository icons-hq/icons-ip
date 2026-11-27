import { describe, expect, it } from 'vitest';
import type { AdminClaimDetail, AdminClaimReshipItem, AdminClaimReshipment, AdminClaimReshipmentTarget, AdminClaimStockDecision } from './claims.server';
import { adminClaimExchangeStockTargets, adminClaimPendingReshipments, adminClaimRemainingReshipments, adminClaimReshipSelectableOptions, adminClaimReshipmentProgress, adminClaimShipmentPartiallyReceived, adminClaimStockDecisionPending, adminClaimWaiverDecisions } from './claim-reshipments';

const target = (n: number, overrides: Partial<AdminClaimReshipmentTarget> = {}): AdminClaimReshipmentTarget => ({
  shipmentId: `00000000-0000-4000-8000-00000000000${n}`, originName: n === 1 ? '김포' : '남양주', collectionTracked: true,
  collectedAt: null, reshipped: false, orderItemIds: [`00000000-0000-4000-8000-00000000001${n}`], waiver: null, productionRequired: false, productionPending: false, ...overrides,
});
const row = (n: number, overrides: Partial<AdminClaimReshipment> = {}): AdminClaimReshipment => ({
  id: `00000000-0000-4000-8000-00000000002${n}`, shipmentId: target(n).shipmentId, originName: target(n).originName, carrier: 'hanjin', carrierLabel: '한진택배',
  trackingNumber: `EXCHANGE000${n}`, reshippedAt: '2026-11-10T00:00:00.000Z', reshippedByName: null, collectionWaived: false, waiverReason: null, waiverEvidence: [],
  deliveredAt: null, deliveredByName: null, deliveryEvidence: null, items: [], ...overrides,
});
const claim = (overrides: Partial<AdminClaimDetail['claim']>) => ({
  claimType: 'exchange', stage: 'collecting', reshipTrackingNumber: null, reshippedAt: null, reshipDeliveredAt: null,
  collectionWaiverAllowed: false, reshipmentTargets: [], reshipments: [], ...overrides,
}) as AdminClaimDetail['claim'];

describe('교환 재출고 진행(출고지별, TKT-166)', () => {
  it('출고지 둘 중 한 곳만 보냈으면 재출고 1/2로 센다', () => {
    expect(adminClaimReshipmentProgress(claim({ reshipmentTargets: [target(1, { reshipped: true }), target(2)], reshipments: [row(1)] })))
      .toEqual({ total: 2, reshipped: 1, delivered: 0, waived: 0, legacy: false });
    expect(adminClaimReshipmentProgress(claim({ stage: 'completed', reshipmentTargets: [target(1, { reshipped: true }), target(2, { reshipped: true })],
      reshipments: [row(1, { deliveredAt: '2026-11-11T00:00:00.000Z' }), row(2, { collectionWaived: true })] })))
      .toEqual({ total: 2, reshipped: 2, delivered: 1, waived: 1, legacy: false });
  });
  it('이 기능 전의 클레임 단위 기록은 한 쌍으로 센다', () => {
    expect(adminClaimReshipmentProgress(claim({ stage: 'completed', reshipTrackingNumber: 'LEGACY0001', reshippedAt: '2026-10-01T00:00:00.000Z', reshipDeliveredAt: null })))
      .toEqual({ total: 1, reshipped: 1, delivered: 0, waived: 0, legacy: true });
    /* 출고지가 둘이던 옛 교환도 기록은 클레임당 한 쌍이다 — '재출고 1/2'로 보이면 안 된다(리뷰 #4). */
    expect(adminClaimReshipmentProgress(claim({ stage: 'completed', reshipTrackingNumber: 'LEGACY0002', reshippedAt: '2026-10-01T00:00:00.000Z',
      reshipDeliveredAt: '2026-10-03T00:00:00.000Z', reshipmentTargets: [target(1), target(2)] })))
      .toEqual({ total: 1, reshipped: 1, delivered: 1, waived: 0, legacy: true });
    /* 아직 아무 데도 보내지 않은 새 교환은 대상 출고지 수가 분모다. */
    expect(adminClaimReshipmentProgress(claim({ reshipmentTargets: [target(1), target(2)] })))
      .toEqual({ total: 2, reshipped: 0, delivered: 0, waived: 0, legacy: false });
  });
  it('교환을 종결하는 재출고는 등록할 수 있는 수가 아니라 아직 보내지 않은 대상 전체로 정한다', () => {
    /* 단순 변심 두 출고지에서 김포만 입고되면 등록할 수 있는 곳은 하나지만 남양주가 남아 종결이 아니다(리뷰 #5). */
    const partial = claim({ reshipmentTargets: [target(1, { collectedAt: '2026-11-09T00:00:00.000Z' }), target(2)] });
    expect(adminClaimPendingReshipments(partial)).toHaveLength(1);
    expect(adminClaimRemainingReshipments(partial)).toBe(2);
    expect(adminClaimRemainingReshipments(claim({ reshipmentTargets: [target(1, { reshipped: true }), target(2, { collectedAt: '2026-11-09T00:00:00.000Z' })] }))).toBe(1);
  });
  it('반품지가 갈린 배송 건은 묶음 일부가 입고됐으면 회수 생략(재출고·결정)을 열지 않는다', () => {
    const bundle = (collectedAt: string | null) => ({ bundleId: '00000000-0000-4000-8000-0000000000b1', returnAddressId: null, returnName: '', returnAddress: '주소', returnPhone: '', items: [], collectedAt, collectorName: null, evidence: null, receivedOn: null });
    const collection = (bundles: ReturnType<typeof bundle>[]) => ({ shipmentId: target(1).shipmentId as string, originId: 'o', originName: '김포', returnAddress: '', items: [], collectedAt: null, collectedBy: null, collectorName: null, evidence: null, bundles });
    const open = (bundles: ReturnType<typeof bundle>[], overrides: Partial<AdminClaimReshipmentTarget> = {}) =>
      claim({ collectionWaiverAllowed: true, collections: [collection(bundles)], reshipmentTargets: [target(1, overrides)] });
    const partial = open([bundle('2026-11-12T00:00:00.000Z'), bundle(null)]);
    expect(adminClaimShipmentPartiallyReceived(partial, target(1).shipmentId)).toBe(true);
    expect(adminClaimPendingReshipments(partial)).toEqual([]);
    const madeToOrder = open([bundle('2026-11-12T00:00:00.000Z'), bundle(null)], { productionRequired: true, productionPending: true });
    expect(adminClaimWaiverDecisions(madeToOrder)).toEqual([]);
    /* 아무 묶음도 입고되지 않았으면 그대로 회수 생략을 연다. */
    const none = open([bundle(null), bundle(null)]);
    expect(adminClaimShipmentPartiallyReceived(none, target(1).shipmentId)).toBe(false);
    expect(adminClaimPendingReshipments(none)).toMatchObject([{ waivable: true }]);
    expect(adminClaimShipmentPartiallyReceived(none, null)).toBe(false);
  });
  it('주문제작 출고지는 회수 생략을 먼저 결정하고, 교환품 제작이 끝나야 재출고 버튼이 생긴다', () => {
    const waiver = { reason: '고객 사진으로 인쇄 불량 확인', waivedAt: '2026-11-10T00:00:00.000Z', waivedByName: null, evidence: [] };
    const madeToOrder = target(1, { productionRequired: true, productionPending: true });
    const defect = (targets: AdminClaimReshipmentTarget[]) => claim({ collectionWaiverAllowed: true, reshipmentTargets: targets });
    /* 결정 전: 같은 요청의 회수 생략 버튼 대신 결정(회수 없이 제작 시작)이 먼저다. */
    expect(adminClaimPendingReshipments(defect([madeToOrder, target(2)])).map(item => item.originName)).toEqual(['남양주']);
    expect(adminClaimWaiverDecisions(defect([madeToOrder, target(2)])).map(item => item.originName)).toEqual(['김포']);
    /* 결정 뒤 제작 대기: 버튼도 결정 양식도 없다. */
    const decided = { ...madeToOrder, waiver };
    expect(adminClaimPendingReshipments(defect([decided]))).toEqual([]);
    expect(adminClaimWaiverDecisions(defect([decided]))).toEqual([]);
    /* 제작 완료: 회수 없이(결정된 회수 생략) 재출고한다. */
    expect(adminClaimPendingReshipments(defect([{ ...decided, productionPending: false }])))
      .toMatchObject([{ originName: '김포', collected: false, waived: true, waivable: false }]);
    /* 회수 확인한 주문제작 출고지도 제작이 끝나야 등록한다. */
    expect(adminClaimPendingReshipments(claim({ reshipmentTargets: [{ ...madeToOrder, collectedAt: '2026-11-09T00:00:00.000Z' }] }))).toEqual([]);
    /* 단순 변심 교환은 결정 양식이 없다. */
    expect(adminClaimWaiverDecisions(claim({ reshipmentTargets: [madeToOrder] }))).toEqual([]);
  });
  it('회수를 확인한 배송 건만 등록할 수 있고, 하자·오배송 교환은 회수 전 배송 건을 회수 없이 보낼 수 있다', () => {
    const targets = [target(1, { collectedAt: '2026-11-09T00:00:00.000Z' }), target(2)];
    expect(adminClaimPendingReshipments(claim({ reshipmentTargets: targets })).map(item => [item.originName, item.collected, item.waivable]))
      .toEqual([['김포', true, false]]);
    expect(adminClaimPendingReshipments(claim({ reshipmentTargets: targets, collectionWaiverAllowed: true })).map(item => [item.originName, item.collected, item.waivable]))
      .toEqual([['김포', true, false], ['남양주', false, true]]);
    expect(adminClaimPendingReshipments(claim({ reshipmentTargets: [targets[0], { ...targets[1], reshipped: true }], collectionWaiverAllowed: true }))).toHaveLength(1);
  });
  it('보류·종결·옛 단일 기록·출고지별 회수를 쓰지 않는 수거중 교환에는 등록할 배송 건이 없다', () => {
    const targets = [target(1, { collectedAt: '2026-11-09T00:00:00.000Z' })];
    for (const stage of ['on_hold', 'completed', 'requested'] as const) expect(adminClaimPendingReshipments(claim({ stage, reshipmentTargets: targets }))).toEqual([]);
    expect(adminClaimPendingReshipments(claim({ reshipmentTargets: targets, reshipTrackingNumber: 'LEGACY0001' }))).toEqual([]);
    expect(adminClaimPendingReshipments(claim({ reshipmentTargets: [target(1, { collectionTracked: false })] }))).toEqual([]);
    expect(adminClaimPendingReshipments(claim({ stage: 'collected', reshipmentTargets: [target(1, { collectionTracked: false, shipmentId: null })] })))
      .toMatchObject([{ shipmentId: null, collected: true }]);
  });

  describe('회수품 재고 처리(CLM-046)', () => {
    const collected = '2026-11-09T00:00:00.000Z';
    const decision = (overrides: Partial<AdminClaimStockDecision> = {}): AdminClaimStockDecision => ({
      required: true, decided: false, decidedAt: null, decidedByName: null, defectiveOrderItemIds: [], recordedOrderItemIds: [], ...overrides,
    });
    const item = (n: number): AdminClaimReshipItem => ({
      id: target(n).orderItemIds[0], goodId: `g${n}`, name: `굿즈 ${n}`, qty: n, unitPrice: 1000, variantId: `v${n}`, variantName: n === 1 ? '파랑' : null,
      currentVariantId: `v${n}`, options: [],
    });

    it('하자·오배송 교환은 회수를 확인한 출고지도 재고 처리를 정하기 전에는 재출고 대상이 아니다', () => {
      const undecided = claim({ reshipmentTargets: [target(1, { collectedAt: collected, stockDecision: decision() }), target(2, { collectedAt: collected, stockDecision: decision({ decided: true }) })] });
      expect(adminClaimPendingReshipments(undecided).map(row => row.originName)).toEqual(['남양주']);
      expect(adminClaimStockDecisionPending(undecided, undecided.reshipmentTargets![0])).toBe(true);
      expect(adminClaimStockDecisionPending(undecided, undecided.reshipmentTargets![1])).toBe(false);
    });

    it('불량으로 고른 품목을 재출고 대상에 싣는다', () => {
      const decided = claim({ reshipmentTargets: [target(1, { collectedAt: collected, stockDecision: decision({ decided: true, defectiveOrderItemIds: [target(1).orderItemIds[0]] }) })] });
      expect(adminClaimPendingReshipments(decided)).toMatchObject([{ originName: '김포', defectiveOrderItemIds: [target(1).orderItemIds[0]] }]);
    });

    it('단순 변심 교환·회수 생략 출고지·옛 응답은 결정을 기다리지 않는다', () => {
      const waiver = { reason: '고객 사진으로 인쇄 불량 확인', waivedAt: collected, waivedByName: null, evidence: [] };
      const optional = claim({ reshipmentTargets: [target(1, { collectedAt: collected, stockDecision: decision({ required: false }) })] });
      expect(adminClaimPendingReshipments(optional)).toHaveLength(1);
      const waived = claim({ collectionWaiverAllowed: true, reshipmentTargets: [target(1, { waiver, stockDecision: decision() })] });
      expect(adminClaimPendingReshipments(waived)).toMatchObject([{ waived: true, defectiveOrderItemIds: [] }]);
      expect(adminClaimExchangeStockTargets(waived, [item(1)])).toEqual([]);
      const legacyResponse = claim({ reshipmentTargets: [target(1, { collectedAt: collected })] });
      expect(adminClaimPendingReshipments(legacyResponse)).toHaveLength(1);
      expect(adminClaimExchangeStockTargets(legacyResponse, [item(1)])).toEqual([]);
    });

    it('재고 처리 칸은 회수를 확인했고 재출고 전인 출고지만 그리고 저장된 불량을 기본값으로 싣는다', () => {
      const open = claim({ reshipmentTargets: [
        target(1, { collectedAt: collected, stockDecision: decision({ decided: true, decidedByName: '담당', defectiveOrderItemIds: [target(1).orderItemIds[0]] }) }),
        target(2, { stockDecision: decision() }),
      ] });
      expect(adminClaimExchangeStockTargets(open, [item(1), item(2)])).toEqual([{
        shipmentId: target(1).shipmentId, originName: '김포', required: true, decided: true, decidedAt: null, decidedByName: '담당',
        items: [{ orderItemId: target(1).orderItemIds[0], name: '굿즈 1', variantName: '파랑', qty: 1, defective: true, state: 'planned' }],
      }]);
      expect(adminClaimExchangeStockTargets(claim({ ...open, reshipmentTargets: [{ ...open.reshipmentTargets![0], reshipped: true }] }), [item(1)])).toEqual([]);
      expect(adminClaimExchangeStockTargets(claim({ ...open, claimType: 'return' }), [item(1)])).toEqual([]);
    });
  });
});

describe('재출고 상품으로 고를 수 있는 옵션(화면 규칙 2)', () => {
  const option = (n: number, stockQty: number) => ({ id: `00000000-0000-4000-8000-0000000000a${n}`, name: `옵션 ${n}`, code: `OPT${n}`, stockQty });
  const item = (options: ReturnType<typeof option>[]): AdminClaimReshipItem => ({ id: '00000000-0000-4000-8000-000000000011', goodId: 'good', name: '교환 상품', qty: 2, unitPrice: 1000,
    variantId: option(1, 0).id, variantName: '옵션 1', currentVariantId: option(1, 0).id, options });
  it('재고가 없는 다른 옵션은 빼고, 지금 옵션은 재고가 0이어도 남긴다', () => {
    expect(adminClaimReshipSelectableOptions(item([option(1, 0), option(2, 0), option(3, 5)])).map(row => row.code)).toEqual(['OPT1', 'OPT3']);
  });
  it('재고가 있는 옵션은 받은 순서 그대로 둔다', () => {
    expect(adminClaimReshipSelectableOptions(item([option(1, 4), option(2, 1), option(3, 5)])).map(row => row.code)).toEqual(['OPT1', 'OPT2', 'OPT3']);
  });
});
