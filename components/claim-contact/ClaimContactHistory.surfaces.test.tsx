import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { OrderDetail as OrderValue, OrderCancellationRequestSummary } from '@/lib/orders';
import type { GiftDetail as GiftValue } from '@/lib/gifts';
import type { GiftClaimContext } from '@/lib/gift-claims';
const views = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock('./ClaimContactHistory', () => ({ ClaimContactHistory: (props: unknown) => { views.history(props); return <div data-contact-history="true" />; } }));
vi.mock('@/components/wc/MypageShell', () => ({ MypageShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock('@/app/gifts/actions', () => ({ closeGiftAction: vi.fn(), issueGiftLinkAction: vi.fn(), placeGiftAction: vi.fn(), quoteGiftAction: vi.fn(), reloadGiftAction: vi.fn(), updateGiftAddressAction: vi.fn() }));
vi.mock('@/app/gifts/claim-actions', () => ({ reloadGiftClaimAction: vi.fn(), requestGiftClaimAction: vi.fn(), setGiftRefundAccountAction: vi.fn(), withdrawGiftClaimAction: vi.fn() }));
import { OrderDetail } from '@/components/screens/OrderDetail';
import { GiftDetail } from '@/components/screens/gifts/GiftDetail';

const actorId = '10000000-0000-4000-8000-000000000001', orderId = '10000000-0000-4000-8000-000000000002', claimId = '10000000-0000-4000-8000-000000000003', giftId = '10000000-0000-4000-8000-000000000004';
const at = '2026-10-14T00:00:00Z';
function order(claimType: OrderCancellationRequestSummary['claimType']): OrderValue {
  return { id: orderId, status: 'delivered', total: 1000, shippingFee: 0, discountTotal: 0, storeCreditTotal: 0, paymentMethod: 'card', expiresAt: null,
    address: null, createdAt: at, deliveredAt: at, items: [{ id: '10000000-0000-4000-8000-000000000005', variantId: '10000000-0000-4000-8000-000000000006', goodId: 'test-physical', name: 'TEST 실물 굿즈', type: '문구', qty: 1, unitPrice: 1000 }], payment: null, refund: null, shipments: [], cardPacks: { issuedCount: 0, availableCount: 0 },
    claimEligibility: { cancel: false, return: true, exchange: true }, cancellationRequest: {
      id: claimId, status: 'requested', reference: 1, requestedAt: at, decidedAt: null, decisionNote: null, claimType, stage: 'requested',
      reshipCarrier: null, reshipTrackingNumber: null,
    } };
}
function gift(party: 'sender' | 'recipient'): GiftValue {
  return { id: giftId, revision: 1, message: '', senderLabel: '보낸 분', recipientLabel: '받는 분', party, isRecipient: party === 'recipient', state: 'ordered',
    expiresAt: at, createdAt: at, acceptedAt: at, address: null, addressRevision: null, items: [], shipments: [],
    order: { id: orderId, status: 'delivered', createdAt: at, expiresAt: null, total: party === 'sender' ? 1000 : null, paymentMethod: party === 'sender' ? 'card' : null } };
}
function giftContext(party: 'sender' | 'recipient'): GiftClaimContext {
  return { giftId, isSender: party === 'sender', isRecipient: party === 'recipient', canRequest: false, claim: { id: claimId, type: 'exchange', stage: 'requested', revision: 1,
    requestedAt: at, isRequester: false, canWithdraw: false, refundAccountNeeded: false, maskedRefundAccount: null, reshipCarrier: null, reshipTrackingNumber: null } };
}

describe('customer history surface integration', () => {
  it.each(['return', 'exchange'] as const)('connects an authenticated ordinary %s claim with IDs only', claimType => {
    views.history.mockClear(); renderToStaticMarkup(<OrderDetail viewerId={actorId} order={order(claimType)} />);
    expect(views.history).toHaveBeenCalledOnce(); expect(views.history.mock.calls[0][0]).toEqual({ actorId, orderId, claimId });
  });
  it('does not mount contact history for cancellation or absent viewer identity', () => {
    views.history.mockClear(); renderToStaticMarkup(<OrderDetail viewerId={actorId} order={order('cancel')} />); renderToStaticMarkup(<OrderDetail order={order('return')} />);
    expect(views.history).not.toHaveBeenCalled();
  });
  it.each(['sender', 'recipient'] as const)('passes gift order ID to the %s history without introducing a new source PII read', party => {
    views.history.mockClear(); renderToStaticMarkup(<GiftDetail actorId={actorId} initialGift={gift(party)} coupons={[]} initialClaimContext={giftContext(party)} />);
    expect(views.history).toHaveBeenCalledOnce(); expect(views.history.mock.calls[0][0]).toEqual({ actorId, orderId, claimId });
  });
});
