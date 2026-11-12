import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/claim-return-actions', () => ({ previewClaimReturnIntakeAction: vi.fn(), confirmClaimReturnIntakeAction: vi.fn(), retryClaimReturnPickupAction: vi.fn() }));
vi.mock('@/app/admin/claim-actions', () => ({ recordOrderClaimOriginCollectionAction: vi.fn() }));
import { ClaimReturnOperationsPanel } from './ClaimReturnOperationsPanel';
import { ClaimOriginCollection } from './ClaimOriginCollection';
import { CLAIM_RETURN_OPERATIONS_OFF } from '@/lib/admin/claim-return-pickup';
import type { AdminClaimCollection } from '@/lib/admin/claims.server';

const CLAIM = '10000000-0000-4000-8000-000000000001';
const columns = { trackingNumber: ['회수송장번호'], orderNumber: ['주문번호'], phone: ['연락처'], receivedOn: ['입고일'] };

/* QNA-032·QNA-034: 스위치가 꺼져 있으면 반품·교환 목록 위에 아무것도 더하지 않는다(목록은 지금과 같다). */
describe('반품 회수 운영 칸', () => {
  it('꺼져 있으면 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<ClaimReturnOperationsPanel operations={CLAIM_RETURN_OPERATIONS_OFF} />)).toBe('');
  });
  it('자동 수거 실패 건수와 상세로 가는 요청번호를 보인다', () => {
    const html = renderToStaticMarkup(<ClaimReturnOperationsPanel operations={{ pickup: { enabled: true, failed: 1, pending: 2, items: [{ claimId: CLAIM, claimType: 'return',
      reference: 12, orderNumber: '2026111210000003', bundleId: '10000000-0000-4000-8000-000000000002', state: 'failed', lastErrorCode: 'pickup_timeout', attempts: 3,
      updatedAt: '2026-11-12T03:00:00Z' }] }, intake: { enabled: false } }} />);
    expect(html).toContain('자동 수거 실패');
    expect(html).toMatch(/자동 수거 실패<\/span><strong[^>]*text-destructive[^>]*>1<span[^>]*>건<\/span><\/strong>/u);
    expect(html).toContain(`href="/admin/sales/claims/returns?claimId=${CLAIM}"`);
    expect(html).toContain('C00012');
    expect(html).toContain('택배사 응답 시간이 지났습니다');
    expect(html).toContain('접수 대기 2건');
    expect(html).not.toContain('반품입고 회신 업로드');
  });
  it('반품입고 회신 업로드는 대응표의 열 이름을 보이고, 확인 전에는 확정 버튼이 잠긴다', () => {
    const html = renderToStaticMarkup(<ClaimReturnOperationsPanel operations={{ pickup: { enabled: false }, intake: { enabled: true, columns } }} />);
    expect(html).toContain('반품입고 회신 업로드');
    expect(html).toContain('회수송장번호');
    expect(html).toContain('등록 전 확인');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>입고 확정<\/button>/u);
    expect(html).not.toContain('자동 수거 실패');
  });
});

const collection = (pickup?: object): AdminClaimCollection => ({
  shipmentId: '20000000-0000-4000-8000-000000000001', originId: 'o1', originName: 'TEST 김포', returnAddress: '김포 반송지',
  items: [{ orderItemId: 'i1', name: 'TEST 굿즈', qty: 1 }], collectedAt: null, collectedBy: null, collectorName: null, evidence: null, receivedOn: null,
  collectionWaived: false,
  bundles: [{ bundleId: '30000000-0000-4000-8000-000000000001', returnAddressId: null, returnName: '', returnAddress: '김포 반송지', returnPhone: '',
    items: [{ orderItemId: 'i1', name: 'TEST 굿즈', qty: 1 }], collectedAt: null, collectorName: null, evidence: null, receivedOn: null,
    ...(pickup ? { pickup: pickup as never } : {}) }],
});
const pickup = { pickupId: 'p1', carrier: 'hanjin', carrierLabel: '한진택배', requestedAt: null, attempts: 2, autoAttempts: 2, maxAttempts: 5, lastErrorCode: null,
  nextAttemptAt: null, inProgress: false, cancelReason: null, canceledAt: null, trackingNumber: null };

describe('출고지 회수 칸의 자동 회수 접수', () => {
  it('접수 큐에 없는 묶음은 지금과 같게 그린다', () => {
    const html = renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM} claimType="return" collection={collection()} />);
    expect(html).not.toContain('자동 회수 접수');
    expect(html).not.toContain('data-claim-return-pickup');
    expect(html).toContain('TEST 김포 회수 확인');
  });
  it('접수되면 회수 운송장을 보인다', () => {
    const html = renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM} claimType="return"
      collection={collection({ ...pickup, state: 'requested', trackingNumber: 'FAKE0123456789', requestedAt: '2026-11-12T03:00:00Z' })} />);
    expect(html).toContain('회수 접수됨');
    expect(html).toContain('한진택배 · 회수 운송장 FAKE0123456789');
    expect(html).not.toContain('회수 다시 접수');
  });
  it('자동 수거 실패는 이유·시도 횟수와 다시 접수 버튼을 보인다(권한이 없으면 버튼 없음)', () => {
    const failed = collection({ ...pickup, state: 'failed', lastErrorCode: 'upstream_error', nextAttemptAt: '2026-11-12T04:00:00Z' });
    const html = renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM} claimType="return" collection={failed} />);
    expect(html).toContain('자동 수거 실패');
    expect(html).toContain('택배사가 접수를 거절했습니다 · 자동 시도 2/5회');
    expect(html).toContain('회수 다시 접수');
    expect(renderToStaticMarkup(<ClaimOriginCollection canRecord={false} claimId={CLAIM} claimType="return" collection={failed} />)).not.toContain('회수 다시 접수');
    const canceled = renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM} claimType="return"
      collection={collection({ ...pickup, state: 'canceled', cancelReason: 'withdrawn', canceledAt: '2026-11-12T05:00:00Z' })} />);
    expect(canceled).toContain('수거 취소 · 요청 철회');
  });
});
