import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/claim-return-actions', () => ({ retryClaimReturnPickupAction: vi.fn() }));
vi.mock('@/app/admin/claim-actions', () => ({ recordOrderClaimOriginCollectionAction: vi.fn(), recordOrderClaimCarrierLossAction: vi.fn() }));
vi.mock('@/lib/admin/claim-evidence.client', () => ({ uploadClaimEvidence: vi.fn() }));
import { ClaimOriginCollection, originCollectionConfirmRequest } from './ClaimOriginCollection';
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
    expect(html).toContain('입고 전');
  });
  it('일부 발송 주문의 발송 전 배송 건은 창고 보관 확인으로 회수를 끝낸다', () => {
    const html = renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM} claimRevision={4} claimType="return" collection={collection({ shipmentDispatched: false })} />);
    expect(html).toContain('아직 발송 전인 배송 건입니다. 창고에 그대로 있는지 확인한 뒤 기록해 주세요.');
    expect(html).toContain('TEST 남양주 창고 보관 확인');
    expect(html).toContain('창고 보관을 확인한 날');
    expect(html).toContain('창고 보관 확인 근거 (필수)');
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

/* 화면 규칙(2026-11-26): 같은 것은 이름 하나(회수·입고·반품지), 못 하는 처리는 미리 잠그고 이유를 보이며, 되돌릴 수 없는 회수 확인은 확인창으로 한 번 묻는다. */
describe('출고지 회수 칸의 이름·잠금·근거', () => {
  const render = (overrides: Partial<AdminClaimCollection> = {}, claimType: 'return' | 'exchange' = 'return') =>
    renderToStaticMarkup(<ClaimOriginCollection canRecord claimId={CLAIM} claimRevision={4} claimType={claimType} collection={collection(overrides)} />);
  const bundle = collection().bundles![0];

  it('돌아올 곳은 반품지 주소, 상태는 입고 전·입고 확인으로 부른다', () => {
    const waiting = render();
    expect(waiting).toContain('반품지 주소');
    expect(waiting).not.toContain('반송 주소');
    expect(waiting).not.toContain('회수 대기');
    const received = render({ collectedAt: '2026-11-19T01:00:00Z', collectedBy: 'u1', evidence: '창고 회신 G-001', receivedOn: '2026-11-19' });
    expect(received).toContain('입고 확인</span>');
    expect(received).not.toContain('회수 확인 완료');
    const split = render({ bundles: [{ ...bundle, collectedAt: '2026-11-19T01:00:00Z', evidence: '입고' }, { ...bundle, bundleId: '30000000-0000-4000-8000-000000000003', returnAddressId: 'r2', returnName: '서울 반품지' }] });
    expect(split).toContain('일부 입고 1/2');
    expect(split).not.toContain('입고 대기');
    expect(split).toContain('서울 반품지 회수 확인</button>');
  });

  it('회수 확인 근거는 필수이고 어디에 남는지 말한다. 환불 기한 안내는 환불이 있는 요청에만 보인다', () => {
    const returned = render();
    expect(returned).toContain('회수 확인 근거 (필수)');
    expect(returned).toContain('이 출고지의 회수 기록에 남습니다. 고객에게는 보이지 않습니다.');
    expect(returned).toMatch(/<textarea[^>]*name="evidence"[^>]*required=""/u);
    expect(returned).toContain('환불 기한은 가장 늦은 입고일부터 셉니다.');
    expect(returned).not.toContain('환급 기한');
    expect(render({}, 'exchange')).not.toContain('환불 기한');
  });

  it('DB가 반품지 주소가 없다고 판정한 묶음은 회수 확인 양식 대신 등록하러 가는 길을 보인다', () => {
    const blocked = render({ returnAddress: '', bundles: [{ ...bundle, returnAddress: '', returnAddressReady: false } as typeof bundle] });
    expect(blocked).toContain('반품지 주소가 없어 회수를 확인할 수 없습니다.');
    expect(blocked).toContain('href="/admin/settings/origins"');
    expect(blocked).toContain('출고지 반품 주소 등록하러 가기');
    expect(blocked).not.toContain('TEST 남양주 회수 확인');
    expect(blocked).not.toContain('name="evidence"');
    /* 주소 스냅샷만 비었을 때(출고지에 반품 주소가 지금 있으면 DB가 채운다)는 양식을 닫지 않는다. */
    const unknown = render({ returnAddress: '', bundles: [{ ...bundle, returnAddress: '' }] });
    expect(unknown).toContain('반품지 주소가 비어 있습니다.');
    expect(unknown).toContain('href="/admin/settings/origins"');
    expect(unknown).toContain('TEST 남양주 회수 확인');
    const ready = render({ returnAddress: '', bundles: [{ ...bundle, returnAddress: '', returnAddressReady: true } as typeof bundle] });
    expect(ready).toContain('TEST 남양주 회수 확인');
  });

  it('이름표에 없는 회수 취소 사유는 내부 값을 내보이지 않는다', () => {
    const pickup = { pickupId: 'p1', state: 'canceled' as const, carrier: 'hanjin', carrierLabel: '한진택배', trackingNumber: null, requestedAt: null, attempts: 1, autoAttempts: 1, maxAttempts: 5,
      lastErrorCode: null, nextAttemptAt: null, inProgress: false, cancelReason: 'synthetic_internal_reason', canceledAt: '2026-11-19T01:00:00Z' };
    const html = render({ bundles: [{ ...bundle, pickup }] });
    expect(html).toContain('수거 취소 · 사유 확인 필요');
    expect(html).not.toContain('synthetic_internal_reason');
  });
});

describe('회수 확인 확인창', () => {
  const items = [{ name: 'TEST 굿즈', qty: 2 }];

  it('반품은 대상 상품·입고일과 환불 기한·고객 알림·되돌릴 수 없음을 말한다', () => {
    const request = originCollectionConfirmRequest({ label: 'TEST 남양주', kind: 'collect', claimType: 'return', items, receivedOn: '2026-11-26' });
    expect(request).toMatchObject({ title: 'TEST 남양주 회수를 확인할까요?', confirmLabel: '회수 확인', cancelLabel: '돌아가기' });
    expect(request.message).toContain('TEST 굿즈 2개를 2026-11-26 입고로 기록합니다.');
    expect(request.message).toContain('환불 기한은 모든 출고지 가운데 가장 늦은 입고일부터 셉니다.');
    expect(request.message).toContain('고객에게 입고 알림이 가고 환불을 처리할 수 있습니다.');
    expect(request.message).toContain('재고는 환불을 확정할 때 바뀝니다.');
    expect(request.message).toContain('기록한 뒤에는 고치거나 되돌릴 수 없습니다.');
  });

  it('교환은 환불 대신 재출고가 다음이라고 말한다', () => {
    const request = originCollectionConfirmRequest({ label: 'TEST 김포', kind: 'collect', claimType: 'exchange', items, receivedOn: '2026-11-26' });
    expect(request.message).toContain('회수를 확인한 출고지부터 재출고할 수 있습니다.');
    expect(request.message).toContain('재고는 재출고를 등록할 때 바뀝니다.');
    expect(request.message).not.toContain('환불');
  });

  it('창고 보관 확인과 늦은 입고 확인은 각자의 일을 말한다', () => {
    const stored = originCollectionConfirmRequest({ label: 'TEST 남양주', kind: 'stored', claimType: 'return', items, receivedOn: '2026-11-26' });
    expect(stored).toMatchObject({ title: 'TEST 남양주 창고 보관을 확인할까요?', confirmLabel: '창고 보관 확인' });
    expect(stored.message).toContain('TEST 굿즈 2개가 2026-11-26에 창고에 그대로 있는 것으로 기록합니다.');
    const late = originCollectionConfirmRequest({ label: 'TEST 남양주', kind: 'late', claimType: 'exchange', items, receivedOn: '2026-11-26' });
    expect(late).toMatchObject({ title: 'TEST 남양주 늦은 입고를 기록할까요?', confirmLabel: '늦은 입고 확인' });
    expect(late.message).toContain('재고는 바뀌지 않습니다.');
    expect(late.message).not.toContain('환불 기한');
  });
});
