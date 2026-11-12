import { describe, expect, it } from 'vitest';
import type { AdminClaimDetail, AdminClaimReshipment, AdminClaimReshipmentTarget } from './claims.server';
import { adminClaimPendingReshipments, adminClaimReshipmentProgress } from './claim-reshipments';

const target = (n: number, overrides: Partial<AdminClaimReshipmentTarget> = {}): AdminClaimReshipmentTarget => ({
  shipmentId: `00000000-0000-4000-8000-00000000000${n}`, originName: n === 1 ? '김포' : '남양주', collectionTracked: true,
  collectedAt: null, reshipped: false, orderItemIds: [`00000000-0000-4000-8000-00000000001${n}`], ...overrides,
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
});
