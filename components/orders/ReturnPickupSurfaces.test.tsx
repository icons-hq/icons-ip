import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/orders/claim-collection-actions', () => ({ readClaimCollectionAction: vi.fn(), saveClaimCollectionAction: vi.fn() }));
import { ClaimReturnBundles } from './ClaimCollectionPlan';
import { claimStageNotice } from './OrderClaimRequest';
import { GoodAdditionalInfo } from '@/components/shop/GoodAdditionalInfo';
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
  it('방문 회수가 아니면 지금 문장 그대로다', () => {
    expect(claimStageNotice(claim)).toBe('요청이 승인됐습니다. 아래 회수 정보 확인에서 배송 묶음별 회수 주소를 확인하고, 안내받은 방법으로 굿즈를 반송해주세요.');
    expect(claimStageNotice(claim, null, { returnPickup: false })).toBe(claimStageNotice(claim));
  });
  it('방문 회수면 택배 기사 방문과 회수 송장을 안내한다', () => {
    expect(claimStageNotice(claim, null, { returnPickup: true })).toBe('요청이 승인됐습니다. 택배 기사가 방문해 굿즈를 회수합니다. 아래 회수 정보 확인에서 배송 묶음별 회수 송장을 확인하고 굿즈를 포장해 두세요.');
    expect(claimStageNotice(claim, null, { returnPickup: true, collectionWaived: true })).toContain('회수 없이 다시 보내드린 소포의 굿즈는 반송하지 않아도 됩니다.');
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
