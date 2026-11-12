import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { GiftDetail as GiftValue } from '@/lib/gifts';
vi.mock('@/components/wc/MypageShell', () => ({ MypageShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock('@/app/gifts/actions', () => ({ closeGiftAction: vi.fn(), issueGiftLinkAction: vi.fn(), placeGiftAction: vi.fn(), quoteGiftAction: vi.fn(), reloadGiftAction: vi.fn(), updateGiftAddressAction: vi.fn() }));
vi.mock('@/app/gifts/claim-actions', () => ({ reloadGiftClaimAction: vi.fn(), requestGiftClaimAction: vi.fn(), setGiftRefundAccountAction: vi.fn(), withdrawGiftClaimAction: vi.fn() }));
vi.mock('@/components/orders/ClaimCollectionPlan', () => ({ ClaimCollectionPlan: () => <p>회수 계획</p> }));
vi.mock('@/components/claim-contact/ClaimContactHistory', () => ({ ClaimContactHistory: () => null }));
vi.mock('@/components/orders/ClaimFeePanel', () => ({ OrderClaimFees: () => null }));
import { GiftDetail } from './GiftDetail';

const actorId = '10000000-0000-4000-8000-000000000001', orderId = '10000000-0000-4000-8000-000000000002', at = '2026-10-14T00:00:00Z';
function gift(party: 'sender' | 'recipient', shipment: Partial<GiftValue['shipments'][number]>): GiftValue {
  return { id: '10000000-0000-4000-8000-000000000004', revision: 1, message: '', senderLabel: '보낸 분', recipientLabel: '받는 분', party, isRecipient: party === 'recipient',
    state: 'ordered', expiresAt: at, createdAt: at, acceptedAt: at, address: null, addressRevision: null, items: [],
    shipments: [{ id: '10000000-0000-4000-8000-000000000005', status: 'shipping', shippedAt: at, deliveredAt: null, expectedShipDate: null, carrier: null, trackingNumber: null, ...shipment }],
    order: { id: orderId, status: 'shipping', createdAt: at, expiresAt: null, total: party === 'sender' ? 1000 : null, paymentMethod: party === 'sender' ? 'card' : null } };
}

/* QNA-019: 나눠 보낸 상자의 추가 운송장은 상자를 받는 수령인에게만 보인다. */
describe('선물 상세의 추가 운송장', () => {
  it('수령인은 대표 운송장 아래에 추가 운송장을 본다', () => {
    const html = renderToStaticMarkup(<GiftDetail actorId={actorId} coupons={[]} initialClaimContext={null} initialGift={gift('recipient', { carrier: 'hanjin', trackingNumber: '123456789012',
      extraTrackings: [{ carrier: 'hanjin', trackingNumber: '223456789012' }, { carrier: 'hanjin', trackingNumber: '323456789012' }] })} />);
    expect(html).toContain('hanjin · 123456789012');
    expect(html).toContain('추가 운송장(나눠 보낸 상자) hanjin · 223456789012, hanjin · 323456789012');
  });
  it('추가 운송장이 없으면 종전과 같고, 보내는 분에게는 운송장이 없다', () => {
    expect(renderToStaticMarkup(<GiftDetail actorId={actorId} coupons={[]} initialClaimContext={null} initialGift={gift('recipient', { carrier: 'hanjin', trackingNumber: '123456789012' })} />))
      .not.toContain('추가 운송장');
    const sent = renderToStaticMarkup(<GiftDetail actorId={actorId} coupons={[]} initialClaimContext={null} initialGift={gift('sender', {})} />);
    expect(sent).not.toContain('추가 운송장');
    expect(sent).not.toContain('123456789012');
  });
});

/* T13b: 받는 분의 반품 칸도 방문 회수 안내 문장을 묶음별 규칙대로 말한다(주문 상세와 같은 문장). */
describe('선물 받는 분의 방문 회수 안내', () => {
  const context = (stage: 'collecting' | 'requested') => ({ giftId: '10000000-0000-4000-8000-000000000004', isSender: false, isRecipient: true, canRequest: false,
    claim: { id: '10000000-0000-4000-8000-000000000009', type: 'return' as const, stage, revision: 1, requestedAt: at, isRequester: true, canWithdraw: false,
      refundAccountNeeded: false, maskedRefundAccount: null, reshipCarrier: null, reshipTrackingNumber: null } });
  const render = (stage: 'collecting' | 'requested', returnPickup: { pickupBundles: number; directBundles: number }) =>
    renderToStaticMarkup(<GiftDetail actorId={actorId} coupons={[]} initialClaimContext={context(stage)} returnPickup={returnPickup} initialGift={gift('recipient', {})} />);
  it('모두 방문 회수면 방문 회수 문장을 보인다', () => {
    const html = render('collecting', { pickupBundles: 2, directBundles: 0 });
    expect(html).toContain('택배 기사가 방문해 굿즈를 회수합니다');
    expect(html).not.toContain('회수 송장이 없는 묶음은');
  });
  it('섞이면 직접 보낼 묶음 안내를 더하고, 방문 회수 묶음이 없거나 수거 단계가 아니면 문장이 없다', () => {
    expect(render('collecting', { pickupBundles: 1, directBundles: 1 })).toContain('회수 송장이 없는 묶음은 회수 정보의 회수 주소로 보내주세요.');
    expect(render('collecting', { pickupBundles: 0, directBundles: 1 })).not.toContain('택배 기사가 방문해');
    expect(render('requested', { pickupBundles: 1, directBundles: 0 })).not.toContain('택배 기사가 방문해');
  });
});
