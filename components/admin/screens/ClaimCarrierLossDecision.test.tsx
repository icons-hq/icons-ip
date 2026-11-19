import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/claim-return-actions', () => ({ retryClaimReturnPickupAction: vi.fn() }));
vi.mock('@/app/admin/claim-actions', () => ({ recordOrderClaimOriginCollectionAction: vi.fn(), recordOrderClaimCarrierLossAction: vi.fn() }));
vi.mock('@/lib/admin/claim-evidence.client', () => ({ uploadClaimEvidence: vi.fn() }));
import { ClaimOriginCollection } from './ClaimOriginCollection';
import type { AdminClaimCollection } from '@/lib/admin/claims.server';

const CLAIM = '10000000-0000-4000-8000-000000000001';
const collection = (overrides: Partial<AdminClaimCollection> = {}): AdminClaimCollection => ({
  shipmentId: '20000000-0000-4000-8000-000000000002', originId: 'o2', originName: 'TEST 남양주', returnAddress: '남양주 반송지',
  items: [{ orderItemId: 'i2', name: 'TEST 굿즈', qty: 1 }], collectedAt: null, collectedBy: null, collectorName: null, evidence: null, receivedOn: null,
  collectionWaived: false, shipmentDispatched: true, carrierLoss: null,
  bundles: [{ bundleId: '30000000-0000-4000-8000-000000000002', returnAddressId: null, returnName: '', returnAddress: '남양주 반송지', returnPhone: '',
    items: [{ orderItemId: 'i2', name: 'TEST 굿즈', qty: 1 }], collectedAt: null, collectorName: null, evidence: null, receivedOn: null }],
  ...overrides,
});

/* 배송 분실(원장 #15 SHP-095): 반품의 발송된 배송 건만 분실로 기록할 수 있고, 기록하면 '배송 분실'로 보인다. */
describe('출고지 회수 칸의 배송 분실', () => {
  it('반품의 발송된 배송 건이 입고 전이면 분실 기록 진입점을 보인다', () => {
    const html = renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM} claimRevision={4} claimType="return" collection={collection()} />);
    expect(html).toContain('TEST 남양주 배송 분실로 기록');
    expect(html).toContain('택배사가 분실을 확인해 물건이 돌아올 수 없을 때만 씁니다.');
    expect(html).toContain('TEST 남양주 회수 확인');
  });
  it.each([
    ['교환', { claimType: 'exchange' as const }],
    ['발송 전 배송 건', { collection: collection({ shipmentDispatched: false }) }],
    ['이미 입고', { collection: collection({ collectedAt: '2026-11-19T01:00:00Z', collectedBy: 'u1', evidence: '입고' }) }],
    ['회수 생략 결정', { collection: collection({ collectionWaived: true }) }],
    ['리비전을 읽지 못함', { claimRevision: null }],
    ['처리 권한 없음', { canRecord: false }],
  ])('%s이면 분실 기록 진입점이 없다', (_label, override) => {
    const props = { canRecord: true, claimId: CLAIM, claimRevision: 4 as number | null, claimType: 'return' as const, collection: collection(), ...override };
    expect(renderToStaticMarkup(<ClaimOriginCollection {...props} />)).not.toContain('배송 분실로 기록');
  });
  it('효력을 잃은 분실 기록(회수 생략 아님)은 배송 분실로 그리지 않는다', () => {
    const html = renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM} claimRevision={5} claimType="exchange" collection={collection({
      collectionWaived: false,
      carrierLoss: { accidentNumber: 'HJ-ACC-20261119-01', reason: 'TEST 한진 고객센터 분실 확인 회신', evidenceFileIds: ['f1'], recordedAt: '2026-11-19T02:00:00Z', recordedByName: 'TEST 운영자' },
    })} />);
    expect(html).not.toContain('HJ-ACC-20261119-01');
    expect(html).not.toContain('배송 분실</span>');
    expect(html).toContain('회수 대기');
  });
  it('일부 발송 주문의 발송 전 배송 건은 창고 보관 확인으로 회수를 끝낸다', () => {
    const html = renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM} claimRevision={4} claimType="return" collection={collection({ shipmentDispatched: false })} />);
    expect(html).toContain('아직 발송 전인 배송 건입니다. 창고에 그대로 보관 중인지 확인하고');
    expect(html).toContain('TEST 남양주 창고 보관 확인');
    expect(html).not.toContain('배송 분실로 기록');
  });
  it('기록한 배송 건은 배송 분실 배지와 사고 번호·메모를 보인다', () => {
    const html = renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM} claimRevision={5} claimType="return" collection={collection({
      collectionWaived: true,
      carrierLoss: { accidentNumber: 'HJ-ACC-20261119-01', reason: 'TEST 한진 고객센터 분실 확인 회신', evidenceFileIds: ['f1'], recordedAt: '2026-11-19T02:00:00Z', recordedByName: 'TEST 운영자' },
    })} />);
    expect(html).toContain('배송 분실</span>');
    expect(html).toContain('HJ-ACC-20261119-01');
    expect(html).toContain('TEST 한진 고객센터 분실 확인 회신');
    expect(html).toContain('회수 없이 환불합니다. 분실 상품은 판매 재고로 되돌리지 않습니다.');
    expect(html).not.toContain('배송 분실로 기록');
  });
});
