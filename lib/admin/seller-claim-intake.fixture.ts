import type { SellerClaimContext, SellerClaimInput, SellerClaimReceipt } from './seller-claim-intake';
export const SELLER_CLAIM_TEST_ORDER = '10000000-0000-4000-8000-000000070101';
export const SELLER_CLAIM_TEST_REQUEST = '20000000-0000-4000-8000-000000070101';
export const SELLER_CLAIM_TEST_SHIPMENT = '30000000-0000-4000-8000-000000070101';
export const sellerClaimAddress = { recipientName: '합성 고객', phone: '01000000000', postalCode: '00000', address1: '합성 수거지', address2: '실제 주소 아님' };
export const sellerClaimContextFixture: SellerClaimContext = {
  orderId: SELLER_CLAIM_TEST_ORDER, orderStatus: 'delivered', orderTotal: 23000, buyerName: '합성 고객',
  createdAt: '2026-10-10T00:00:00Z', deliveredAt: '2026-10-12T00:00:00Z', observedAt: '2026-10-13T00:00:00Z', address: sellerClaimAddress,
  blockedReasons: { change_of_mind: null, defect: null }, cancelBlockedReason: 'not_cancelable', digitalExchangeBlocked: false, activeClaim: null,
  collections: [{ shipmentId: SELLER_CLAIM_TEST_SHIPMENT, originId: '40000000-0000-4000-8000-000000070101', originName: '합성 출고지', returnAddress: '합성 반송지', status: 'delivered',
    items: [{ id: '50000000-0000-4000-8000-000000070101', name: '합성 주문 상품', qty: 2 }] }],
  carriers: [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }],
  inquiries: [{ id: '60000000-0000-4000-8000-000000070101', reference: 100, title: '합성 전체 반품 문의', createdAt: '2026-10-12T00:30:00Z' }],
};
export const sellerClaimInputFixture: SellerClaimInput = {
  requestId: SELLER_CLAIM_TEST_REQUEST, orderId: SELLER_CLAIM_TEST_ORDER, claimType: 'return', reasonType: 'defect', reason: '전체 상품 하자 확인',
  source: 'phone', inquiryId: null, customerRequestedAt: '2026-10-13T08:30', agreementEvidence: '고객이 주문 전체 반품에 동의한 합성 상담 기록', agreementConfirmed: true,
  collectionAddress: sellerClaimAddress, collections: [{ shipmentId: SELLER_CLAIM_TEST_SHIPMENT, method: 'not_requested', carrier: null, trackingNumber: null, note: '승인 이후 수거 협의' }], refundAccount: null,
};
export const sellerClaimReceiptFixture: SellerClaimReceipt = {
  requestId: SELLER_CLAIM_TEST_REQUEST, claimId: SELLER_CLAIM_TEST_REQUEST, orderId: SELLER_CLAIM_TEST_ORDER, reference: 12, claimType: 'return', stage: 'requested',
  requestedAt: '2026-10-13T00:00:00Z', actorId: '70000000-0000-4000-8000-000000070101', actorName: '합성 담당자', source: 'phone', inquiryId: null,
  customerRequestedAt: '2026-10-12T23:30:00Z', agreementEvidence: sellerClaimInputFixture.agreementEvidence, collectionAddress: sellerClaimAddress,
  collections: [{ ...sellerClaimInputFixture.collections[0], originId: sellerClaimContextFixture.collections[0].originId, originName: '합성 출고지', items: sellerClaimContextFixture.collections[0].items }],
};
