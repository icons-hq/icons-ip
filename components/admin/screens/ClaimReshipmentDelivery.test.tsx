import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminClaimDetail, AdminClaimReshipment, AdminClaimReshipmentTarget } from '@/lib/admin/claims.server';

vi.mock('@/app/admin/claim-actions', () => ({ recordOrderClaimReshipmentDeliveryAction: vi.fn(), waiveOrderClaimCollectionAction: vi.fn() }));
vi.mock('@/lib/admin/claim-evidence.client', () => ({ uploadClaimEvidence: vi.fn() }));
import { ClaimReshipmentDelivery, reshipmentDeliveryConfirmRequest } from './ClaimReshipmentDelivery';

/* 교환품 배송완료 확인(화면 규칙 2026-11-26): 되돌릴 수 없고 마지막 운송장이면 주문이 배송완료가 되므로 확인창으로 한 번 묻는다.
 * 근거 글은 DB가 요구해 필수로 남기되, 어디에 남는 기록인지와 고객에게 무엇이 보이는지를 칸 아래에 사실대로 적는다. */

const CLAIM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', GIMPO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', NAMYANGJU = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const target = (shipmentId: string, originName: string, overrides: Partial<AdminClaimReshipmentTarget> = {}): AdminClaimReshipmentTarget => ({
  shipmentId, originName, collectionTracked: true, collectedAt: null, reshipped: false, orderItemIds: [], waiver: null, productionRequired: false, productionPending: false, ...overrides,
});
const row = (shipmentId: string, originName: string, overrides: Partial<AdminClaimReshipment> = {}): AdminClaimReshipment => ({
  id: `dddddddd-dddd-4ddd-8ddd-${shipmentId.slice(0, 12)}`, shipmentId, originName, carrier: 'hanjin', carrierLabel: '한진택배', trackingNumber: 'EXCHANGE0001',
  reshippedAt: '2026-11-20T00:00:00Z', reshippedByName: null, collectionWaived: false, waiverReason: null, waiverEvidence: [],
  deliveredAt: null, deliveredByName: null, deliveryEvidence: null, items: [], ...overrides,
});
const claim = (overrides: Partial<AdminClaimDetail['claim']>) => ({
  id: CLAIM, claimType: 'exchange', stage: 'collecting', reshipTrackingNumber: null, reshipCarrier: null, reshippedAt: null,
  reshipDeliveredAt: null, reshipDeliveredByName: null, reshipDeliveryEvidence: null, collectionWaiverAllowed: false, reshipmentTargets: [], reshipments: [], ...overrides,
}) as AdminClaimDetail['claim'];

describe('교환품 배송완료 확인창', () => {
  it('어느 출고지의 어느 운송장인지와 모두 확인했을 때 일어나는 일을 말한다', () => {
    const request = reshipmentDeliveryConfirmRequest('김포', '한진택배 EXCHANGE0001');
    expect(request).toMatchObject({ title: '김포 교환품 배송완료로 기록할까요?', confirmLabel: '배송완료 기록', cancelLabel: '돌아가기' });
    expect(request.message).toContain('운송장 한진택배 EXCHANGE0001의 교환품이 고객에게 도착한 것으로 기록합니다.');
    expect(request.message).toContain('모든 운송장을 확인하면 배송중이던 주문이 배송완료가 되고, 고객은 신청 기한 안에서 새 반품·교환을 신청할 수 있습니다.');
    expect(request.message).toContain('기록한 뒤에는 고치거나 되돌릴 수 없습니다.');
  });
  it('출고지 이름이 없는 옛 기록은 이름 없이 묻는다', () => {
    expect(reshipmentDeliveryConfirmRequest(null, null)).toMatchObject({ title: '교환품 배송완료로 기록할까요?' });
    expect(reshipmentDeliveryConfirmRequest(null, null).message).toMatch(/^교환품이 고객에게 도착한 것으로 기록합니다\./u);
  });
});

describe('출고지별 재출고 칸', () => {
  it('배송완료 확인 근거는 필수이고 어디에 남는지, 고객에게 무엇이 보이는지 말한다', () => {
    const html = renderToStaticMarkup(<ClaimReshipmentDelivery claim={claim({ stage: 'completed',
      reshipmentTargets: [target(GIMPO, '김포', { reshipped: true, collectedAt: '2026-11-19T00:00:00Z' })], reshipments: [row(GIMPO, '김포')] })} />);
    expect(html).toContain('김포 배송완료 확인 근거 (필수)');
    expect(html).toMatch(/<textarea[^>]*name="evidence"[^>]*required=""/u);
    expect(html).toContain('placeholder="예: 11/26 택배사 배송 조회에서 배송완료 확인"');
    expect(html).toContain('이 운송장의 배송완료 기록에 남습니다. 고객에게는 도착을 확인한 시각만 보입니다.');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>교환품 배송완료 확인<\/button>/u);
  });
  it('옛 클레임 단위 재출고도 같은 근거 칸으로 확인한다', () => {
    const html = renderToStaticMarkup(<ClaimReshipmentDelivery claim={claim({ stage: 'completed', reshipTrackingNumber: 'LEGACY000001', reshipCarrier: 'hanjin', reshippedAt: '2026-10-01T00:00:00Z' })} />);
    expect(html).toContain('배송완료 확인 근거 (필수)');
    expect(html).toContain('고객에게는 도착을 확인한 시각만 보입니다.');
  });
  it('아직 보내지 않은 출고지는 어디서 재출고를 등록하는지 지금 화면의 이름으로 말한다', () => {
    const html = renderToStaticMarkup(<ClaimReshipmentDelivery claim={claim({
      reshipmentTargets: [target(GIMPO, '김포', { collectedAt: '2026-11-19T00:00:00Z' }), target(NAMYANGJU, '남양주', { collectionTracked: false })] })} />);
    expect(html).toContain('아래 &#x27;재출고 등록&#x27;에서 등록합니다.');
    expect(html).toContain('입고를 확인한 뒤 아래 &#x27;재출고 등록&#x27;에서 등록합니다.');
    expect(html).not.toContain('재배송');
  });
});
