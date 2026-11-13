import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/orders/claim-collection-actions', () => ({ readClaimCollectionAction: vi.fn(), saveClaimCollectionAction: vi.fn() }));
import { ClaimReturnBundles, collectionHistoryMethodLabel, collectionRowMethodLabel } from './ClaimCollectionPlan';
import { claimStageNotice } from './OrderClaimRequest';
import { GoodAdditionalInfo } from '@/components/shop/GoodAdditionalInfo';
import { parseOrderReturnPickup } from '@/lib/orders/return-pickup';
import { parseClaimReturnBundles, type ClaimCollectionRow } from '@/lib/orders/claim-collection';
import type { OrderCancellationRequestSummary } from '@/lib/orders';

/*
 * 반품 자동 회수 접수(QNA-032·ADR-0034)의 고객 표면. 스위치를 켠 적 없으면(키 없음·false) 상품 상세의 반송 안내, 주문 상세의 수거중 안내,
 * 회수 정보의 회수 주소가 지금과 한 글자도 다르지 않다. 켜져 있으면 방문 회수 안내와 회수 송장을 보인다.
 */
const row: ClaimCollectionRow = { shipmentId: '00000000-0000-4000-8000-000000000003', originName: 'TEST 김포', revision: 0, method: 'not_requested', carrier: null,
  trackingNumber: null, evidence: '', requestedOnce: true, collectedAt: null, updatedAt: null };
const bundle = { bundleId: '00000000-0000-4000-8000-000000000010', returnName: '', returnAddress: '경기도 합성시 반품로 1', returnPhone: '',
  items: [{ name: 'TEST 굿즈', qty: 1 }], collectedAt: null };
const pickup = { carrier: 'hanjin', carrierLabel: '한진택배', trackingNumber: 'FAKE0123456789', requestedAt: '2026-11-12T03:00:00Z' };

describe('고객 회수 정보의 회수 송장', () => {
  it('접수되지 않은 묶음은 지금과 같고, 접수된 묶음은 방문 회수와 회수 송장을 보인다', () => {
    const before = renderToStaticMarkup(<ClaimReturnBundles row={{ ...row, returnBundles: [bundle] }} operator={false} />);
    expect(before).not.toContain('방문 회수');
    expect(before).toBe('<ul class="claim-collection-plan__bundles" aria-label="회수 주소"><li data-claim-return-bundle=""><small>회수 주소</small><span>경기도 합성시 반품로 1</span><small>TEST 굿즈 1개</small></li></ul>');
    const after = renderToStaticMarkup(<ClaimReturnBundles row={{ ...row, returnBundles: [{ ...bundle, pickup }] }} operator={false} />);
    expect(after).toContain('방문 회수 접수 · 한진택배 회수 송장 FAKE0123456789');
    // 행 상태 문구도 '접수 후 수거 협의'가 아니라 방문 회수 접수됨이다(접수되지 않은 묶음뿐이면 지금 문구).
    expect(collectionRowMethodLabel({ ...row, returnBundles: [bundle] })).toBe('접수 후 수거 협의');
    expect(collectionRowMethodLabel({ ...row, returnBundles: [bundle, { ...bundle, pickup }] })).toBe('방문 회수 접수됨');
    expect(collectionRowMethodLabel({ ...row, method: 'customer_sent', returnBundles: [{ ...bundle, pickup }] })).toBe('구매자가 이미 발송');
  });
  it('자동 회수가 취소된 행과 이력은 방문 회수 접수·취소로 말한다', () => {
    const history = [{ id: 'h1', shipmentId: row.shipmentId, createdAt: '2026-11-12T05:00:00Z', method: 'seller_arranged' as const, carrier: 'hanjin', trackingNumber: 'FAKE0123456789', evidence: '자동 회수 취소 · 요청 철회' }];
    expect(collectionRowMethodLabel({ ...row, returnBundles: [bundle] }, history)).toBe('방문 회수 취소됨');
    expect(collectionHistoryMethodLabel(history[0])).toBe('방문 회수 취소됨');
    expect(collectionHistoryMethodLabel({ ...history[0], evidence: '자동 회수 접수 · 한진택배' })).toBe('방문 회수 접수됨');
    expect(collectionHistoryMethodLabel({ ...history[0], evidence: '택배사 확인' })).toBe('판매자 별도 수거 예정');
  });
  it('회수 주소 읽기는 접수된 묶음의 pickup 키를 받고, 모양이 틀리면 읽지 않는다', () => {
    const shipmentId = row.shipmentId;
    expect(parseClaimReturnBundles([{ shipmentId, returnBundles: [bundle] }])?.get(shipmentId)).toEqual([bundle]);
    expect(parseClaimReturnBundles([{ shipmentId, returnBundles: [{ ...bundle, pickup }] }])?.get(shipmentId)).toEqual([{ ...bundle, pickup }]);
    expect(parseClaimReturnBundles([{ shipmentId, returnBundles: [{ ...bundle, pickup: { ...pickup, phone: '010' } }] }])).toBeNull();
    expect(parseClaimReturnBundles([{ shipmentId, returnBundles: [{ ...bundle, pickup: null }] }])).toBeNull();
  });
});

describe('주문 상세 수거중 안내', () => {
  const claim = { id: 'c', claimType: 'return', stage: 'collecting' } as unknown as OrderCancellationRequestSummary;
  const direct = '요청이 승인됐습니다. 아래 회수 정보 확인에서 배송 묶음별 회수 주소를 확인하고, 안내받은 방법으로 굿즈를 반송해주세요.';
  const visit = '요청이 승인됐습니다. 택배 기사가 방문해 굿즈를 회수합니다. 아래 회수 정보 확인에서 배송 묶음별 회수 송장을 확인하고 굿즈를 포장해 두세요.';
  it('방문 회수 묶음이 없으면 지금 문장 그대로다(모두 직접 발송)', () => {
    expect(claimStageNotice(claim)).toBe(direct);
    expect(claimStageNotice(claim, null, { returnPickup: { pickupBundles: 0, directBundles: 0 } })).toBe(direct);
    expect(claimStageNotice(claim, null, { returnPickup: { pickupBundles: 0, directBundles: 2 } })).toBe(direct);
  });
  it('모든 묶음이 방문 회수면 택배 기사 방문과 회수 송장을 안내한다', () => {
    expect(claimStageNotice(claim, null, { returnPickup: { pickupBundles: 2, directBundles: 0 } })).toBe(visit);
    expect(claimStageNotice(claim, null, { returnPickup: { pickupBundles: 1, directBundles: 0 }, collectionWaived: true })).toContain('회수 없이 다시 보내드린 소포의 굿즈는 반송하지 않아도 됩니다.');
  });
  it('섞여 있으면 방문 회수 문장에 회수 송장이 없는 묶음의 직접 발송을 덧붙인다', () => {
    expect(claimStageNotice(claim, null, { returnPickup: { pickupBundles: 1, directBundles: 1 } }))
      .toBe(`${visit} 회수 송장이 없는 묶음은 회수 정보의 회수 주소로 보내주세요.`);
  });
});

describe('주문 상세 회수 요약 읽기', () => {
  it('키가 정확히 둘이고 0 이상 정수일 때만 읽는다. 아니면 null(지금 문장)', () => {
    expect(parseOrderReturnPickup({ pickupBundles: 1, directBundles: 0 })).toEqual({ pickupBundles: 1, directBundles: 0 });
    for (const bad of [true, false, null, [], {}, { pickupBundles: 1 }, { pickupBundles: -1, directBundles: 0 }, { pickupBundles: 1.5, directBundles: 0 },
      { pickupBundles: '1', directBundles: 0 }, { pickupBundles: 1, directBundles: 0, extra: 1 }]) expect(parseOrderReturnPickup(bad)).toBeNull();
  });
});

describe('상품 상세 교환·반품 안내', () => {
  const policy = { originId: 'o', originName: '김포', baseFee: 3000, freeThreshold: null, feeType: 'policy' as const, individualFee: 0 };
  it('방문 회수가 꺼져 있으면 착불 반송 안내 그대로다', () => {
    const html = renderToStaticMarkup(<GoodAdditionalInfo goods={[]} notice={null} shippingPolicy={policy} />);
    expect(html).toContain('<li>단순 변심으로 반품하는 경우 반송비는 구매자가 부담하며 착불로 보내주세요.</li>');
    expect(html).not.toContain('택배 기사가 방문');
  });
  it('굿즈의 출고지에 방문 회수가 켜져 있으면 방문 회수를 안내한다', () => {
    const html = renderToStaticMarkup(<GoodAdditionalInfo goods={[]} notice={null} shippingPolicy={{ ...policy, returnPickup: true }} />);
    expect(html).toContain('교환·반품이 승인되면 택배 기사가 방문해 회수하니 굿즈를 포장해 두세요.');
    expect(html).not.toContain('착불로 보내주세요');
  });
});
