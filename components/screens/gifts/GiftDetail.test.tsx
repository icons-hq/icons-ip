import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { GiftDetail as GiftValue } from '@/lib/gifts';
vi.mock('@/components/wc/MypageShell', () => ({ MypageShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));
vi.mock('@/app/gifts/actions', () => ({ closeGiftAction: vi.fn(), issueGiftLinkAction: vi.fn(), placeGiftAction: vi.fn(), quoteGiftAction: vi.fn(), reloadGiftAction: vi.fn(), updateGiftAddressAction: vi.fn() }));
vi.mock('@/app/gifts/claim-actions', () => ({ reloadGiftClaimAction: vi.fn(), requestGiftClaimAction: vi.fn(), setGiftRefundAccountAction: vi.fn(), withdrawGiftClaimAction: vi.fn() }));
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
