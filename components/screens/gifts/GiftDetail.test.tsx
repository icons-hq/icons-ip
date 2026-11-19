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
  const carriers = [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }, { code: 'epost', label: '우체국택배', active: true, trackingUrlTemplate: 'https://post.example.test/{trackingNumber}' }];
  it('수령인은 대표 운송장 아래에 추가 운송장을 택배사 이름과 조회 링크로 본다(QA2)', () => {
    const html = renderToStaticMarkup(<GiftDetail actorId={actorId} coupons={[]} initialClaimContext={null} carriers={carriers} initialGift={gift('recipient', { carrier: 'hanjin', trackingNumber: '123456789012',
      extraTrackings: [{ carrier: 'epost', trackingNumber: '223456789012' }, { carrier: 'hanjin', trackingNumber: '323456789012' }] })} />);
    expect(html).toMatch(/한진택배 · <a[^>]*href="https:\/\/example.test\/123456789012"[^>]*>123456789012<\/a>/);
    expect(html).toMatch(/href="https:\/\/post.example.test\/223456789012"[^>]*>우체국택배 223456789012<\/a>/);
    expect(html).toMatch(/href="https:\/\/example.test\/323456789012"[^>]*>한진택배 323456789012<\/a>/);
    expect(html).toContain('추가 운송장');expect(html).toContain('나눠 보낸 상자 · 번호를 누르면 배송조회');
    expect(html).not.toContain('epost');
  });
  it('택배사 목록을 모르면 코드 그대로 두되 링크는 만들지 않는다', () => {
    const html = renderToStaticMarkup(<GiftDetail actorId={actorId} coupons={[]} initialClaimContext={null} initialGift={gift('recipient', { carrier: 'hanjin', trackingNumber: '123456789012',
      extraTrackings: [{ carrier: 'hanjin', trackingNumber: '223456789012' }] })} />);
    expect(html).toContain('hanjin · 123456789012');expect(html).toContain('hanjin 223456789012');expect(html).not.toContain('배송조회');
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

/* 선물 결제도 주문서와 같은 줄별 청약철회·교환 제한 고지를 보인 뒤에만 그 목록을 보인 고지로 보낸다(P2). */
describe('선물 결제 품목의 청약철회·교환 제한 고지', () => {
  const VARIANT = '10000000-0000-4000-8000-000000000031';
  const item = (goodId: string, name: string) => ({ goodId, variantId: VARIANT, name, variantName: '기본', qty: 1, imagePath: null, customInputs: null });
  const payable = (): GiftValue => ({ ...gift('sender', {}), state: 'accepted', order: null, shipments: [], items: [item('g1', '각인 키링'), item('g2', '일반 스티커'), item('g3', '교환 불가 포토')] });
  const restrictions = {
    g1: { goodId: 'g1', returnAllowed: false, exchangeAllowed: false, reason: '각인 주문 제작' },
    g3: { goodId: 'g3', returnAllowed: null, exchangeAllowed: false, reason: '교환 불가 사유' },
  };
  const render = (claimRestrictions?: Record<string, { goodId: string; returnAllowed: boolean | null; exchangeAllowed: boolean | null; reason: string }> | null) =>
    renderToStaticMarkup(<GiftDetail actorId={actorId} coupons={[]} initialClaimContext={null} initialGift={payable()} claimRestrictions={claimRestrictions} />);

  it('제한 굿즈 줄에만 사유와 반품·교환 구분을 보인다', () => {
    const html = render(restrictions);
    expect(html).toContain('청약철회·교환 제한 — 각인 주문 제작');
    expect(html).toContain('교환 제한 · 청약철회 가능 — 교환 불가 사유');
    expect(html.match(/data-claim-restriction/g)).toHaveLength(2);
    expect(html.slice(html.indexOf('일반 스티커'), html.indexOf('교환 불가 포토'))).not.toContain('data-claim-restriction');
  });

  it('제한이 없거나 읽지 못했으면(null) 줄 고지가 없다', () => {
    expect(render({})).not.toContain('data-claim-restriction');
    expect(render(null)).not.toContain('data-claim-restriction');
  });
});
