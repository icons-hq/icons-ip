import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminClaimCollection, AdminClaimDetail } from '@/lib/admin/claims.server';
import type { AdminClaimOperationalFee } from '@/lib/admin/claims';

/*
 * m27 G4-5: 목록 위 클레임 팝업(R8, ClaimPreviewDialog) 안의 하위 패널도 서버 액션을 기다리는 동안
 * 팝업에 처리 중을 알려 Esc·×로 닫히지 않게 한다. T2-F3은 ClaimActionPanel만 연결했다.
 * 독립 상세 라우트처럼 팝업 밖에서 그려질 때 훅은 아무 일도 하지 않는다.
 */

vi.mock('@/app/admin/claim-actions', () => ({
  recordOrderClaimOriginCollectionAction: vi.fn(),
  recordOrderClaimReshipmentDeliveryAction: vi.fn(),
  recordOrderClaimOperationalFeeAction: vi.fn(),
}));

const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fee: AdminClaimOperationalFee = { kind: null, amount: null, note: null, evidence: null, confirmedBy: null, confirmedAt: null, updatedAt: '2026-10-27T00:00:00Z' };
const collection: AdminClaimCollection = {
  shipmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', originId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', originName: '김포 창고',
  returnAddress: '경기도 김포시 합성로 1', items: [{ orderItemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: '[합성] 아크릴 스탠드', qty: 1 }],
  collectedAt: null, collectedBy: null, collectorName: null, evidence: null,
};
const exchange = {
  id: CLAIM_ID, claimType: 'exchange', stage: 'completed', reshipTrackingNumber: '123456789012', reshipCarrier: 'cj', reshippedAt: '2026-10-26T00:00:00Z',
  reshipDeliveredAt: null, reshipDeliveredByName: null, reshipDeliveryEvidence: null,
} as unknown as AdminClaimDetail['claim'];

async function panels(pending: boolean, busy?: (value: boolean) => void) {
  vi.resetModules();
  if (busy) vi.doMock('./ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    return { ...actual, useActionState: (_action: unknown, initial: unknown) => [initial, () => {}, pending] };
  });
  const [{ ClaimOriginCollection }, { ClaimReshipmentDelivery }, { ClaimOperationalFeePanel }] = await Promise.all([
    import('./ClaimOriginCollection'), import('./ClaimReshipmentDelivery'), import('./ClaimOperationalFeePanel'),
  ]);
  return {
    origin: () => renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM_ID} claimType="return" collection={collection} />),
    reshipment: () => renderToStaticMarkup(<ClaimReshipmentDelivery claim={exchange} />),
    fee: () => renderToStaticMarkup(<ClaimOperationalFeePanel claimId={CLAIM_ID} claimType="return" fee={fee} />),
  };
}

afterEach(() => {
  vi.doUnmock('./ClaimPreviewDialog');
  vi.doUnmock('react');
});

describe('클레임 팝업 하위 패널의 처리 중 알림', () => {
  it.each(['origin', 'reshipment', 'fee'] as const)('%s 패널은 서버 액션 대기 여부를 팝업에 그대로 알린다', async (panel) => {
    for (const pending of [true, false]) {
      const busy = vi.fn();
      const render = (await panels(pending, busy))[panel];
      render();
      expect(busy).toHaveBeenCalledWith(pending);
    }
  });

  it('재출고 패널은 훅을 배송완료 양식마다 두고, 교환이 아니면 아무 훅 없이 비운다(조기 반환이 훅 순서를 바꾸지 않는다)', async () => {
    const busy = vi.fn();
    vi.resetModules();
    vi.doMock('./ClaimPreviewDialog', () => ({ useClaimPreviewBusy: busy }));
    const { ClaimReshipmentDelivery } = await import('./ClaimReshipmentDelivery');
    expect(renderToStaticMarkup(<ClaimReshipmentDelivery claim={{ ...exchange, claimType: 'return' } as AdminClaimDetail['claim']} />)).toBe('');
    expect(busy).not.toHaveBeenCalled();
    const row = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', shipmentId: collection.shipmentId, originName: '김포 창고', carrier: 'cj', carrierLabel: 'CJ대한통운',
      trackingNumber: '123456789012', reshippedAt: '2026-10-26T00:00:00Z', reshippedByName: null, collectionWaived: false, waiverReason: null, waiverEvidence: [],
      deliveredAt: null, deliveredByName: null, deliveryEvidence: null, items: [] };
    const perOrigin = { ...exchange, reshipTrackingNumber: null, reshipCarrier: null,
      reshipmentTargets: [{ shipmentId: collection.shipmentId, originName: '김포 창고', collectionTracked: true, collectedAt: '2026-10-25T00:00:00Z', reshipped: true, orderItemIds: [] },
        { shipmentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', originName: '남양주 창고', collectionTracked: true, collectedAt: '2026-10-25T00:00:00Z', reshipped: true, orderItemIds: [] }],
      reshipments: [row, { ...row, id: 'abababab-abab-4bab-8bab-abababababab', shipmentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', originName: '남양주 창고', trackingNumber: '223456789012' }],
    } as AdminClaimDetail['claim'];
    const html = renderToStaticMarkup(<ClaimReshipmentDelivery claim={perOrigin} />);
    expect(html).toContain('출고지별 재출고'); expect(html).toContain('김포 창고 배송완료 확인 근거'); expect(html).toContain('남양주 창고 배송완료 확인 근거');
    expect(busy).toHaveBeenCalledTimes(2);
  });

  it('팝업 밖(독립 상세 라우트)에서는 처리 중이어도 아무것도 막지 않고 그대로 그린다', async () => {
    const { origin, reshipment, fee: operationalFee } = await panels(true);
    expect(origin()).toContain('김포 창고 회수 확인');
    expect(reshipment()).toContain('교환품 배송완료 확인');
    expect(operationalFee()).toContain('저장 중…');
  });
});
