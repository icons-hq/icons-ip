import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClaimActionPanel, type ClaimActionPanelProps } from './ClaimActionPanel';
vi.mock('@/app/admin/claim-actions', () => ({ decideOrderClaimAction: vi.fn(), recordOrderClaimCollectionAction: vi.fn(), recordOrderClaimOriginCollectionAction: vi.fn(), recordOrderClaimRefundAction: vi.fn(), recordOrderClaimReshipmentAction: vi.fn(), planClaimDefectiveStockAction: vi.fn(), retryClaimDefectiveStockAction: vi.fn() }));
const base: ClaimActionPanelProps = { claimId: '10000000-0000-4000-8000-000000000001', claimType: 'cancel', orderId: '10000000-0000-4000-8000-000000000002', stage: 'requested', paymentProvider: null, recordedRefundMethod: null, carriers: [], heldFrom: null, cancellationForm: null, refundLedgerOpen: false, refundFiled: false, refundCompleted: false, collectionPolicy: 'origin', collectionComplete: true, collections: [] };
describe('claim collection guidance', () => {
  it('철회 이후에는 수거 재개 안내와 처리 폼을 보여주지 않는다', () => {
    const html = renderToStaticMarkup(<ClaimActionPanel {...base} claimType="return" stage="withdrawn" />);
    expect(html).toContain('요청 철회로 처리가 종료'); expect(html).not.toContain('수거를 승인하면'); expect(html).not.toContain('<form');
  });
  it('철회된 반품은 환불 읽기 내역을 유지하되 접수 양식·복사·환불 조작을 모두 닫는다', () => {
    const html = renderToStaticMarkup(<ClaimActionPanel {...base} claimType="return" stage="withdrawn"
      cancellationForm="폐기된 요청의 결제 취소 본문" refundLedgerOpen refundFiled
      returnRefundSummary={<p>기존 환불 원장 읽기</p>} />);
    expect(html).toContain('기존 환불 원장 읽기');
    expect(html).not.toContain('폐기된 요청의 결제 취소 본문');
    expect(html).not.toContain('양식 복사'); expect(html).not.toContain('결제사 취소 접수 양식');
    expect(html).not.toContain('<form');
  });
  it('does not report a physical collection for a pre-shipment cancellation', () => {
    const html = renderToStaticMarkup(<ClaimActionPanel {...base} />);
    expect(html).toContain('상품 회수가 필요하지 않은 취소');
    expect(html).not.toContain('출고지별 회수 확인');
    expect(html).not.toContain('모든 출고지의 회수를 확인했습니다');
    expect(html).toContain('승인하고 환불 처리 시작');
  });
  it('keeps historical cancellation collection gates visible when recovery remains incomplete', () => {
    const html = renderToStaticMarkup(<ClaimActionPanel {...base} stage="processing" collectionComplete={false} />);
    expect(html).toContain('출고지별 회수 확인');
    expect(html).not.toContain('상품 회수가 필요하지 않은 취소');
  });
  /* 1027T-033·T11b 리뷰: 회수 생략을 결정한 출고지는 회수가 끝난 것으로 보지만, 요청이 열려 있는 동안 늦게 도착한 입고를
     기록할 수 있다(재고 변화 없음). 나머지 출고지를 다 확인해 전체 회수가 끝난 뒤에도 그 칸의 양식이 남는다. */
  it('회수 생략 출고지의 늦은 입고 확인 양식은 전체 회수가 끝난 뒤에도 열린 단계에서 보인다', () => {
    const collections = [
      { shipmentId: '20000000-0000-4000-8000-000000000001', originId: 'o1', originName: 'TEST 김포', returnAddress: '김포 반송지', items: [],
        collectedAt: '2026-11-11T00:00:00.000Z', collectedBy: null, collectorName: null, evidence: '김포 입고', receivedOn: '2026-11-11', collectionWaived: false },
      { shipmentId: '20000000-0000-4000-8000-000000000002', originId: 'o2', originName: 'TEST 남양주', returnAddress: '남양주 반송지', items: [],
        collectedAt: null, collectedBy: null, collectorName: null, evidence: null, receivedOn: null, collectionWaived: true },
    ];
    const open = renderToStaticMarkup(<ClaimActionPanel {...base} claimType="exchange" stage="collected" collectionComplete collections={collections} />);
    expect(open).toContain('TEST 남양주 늦은 입고 확인');
    expect(open).toContain('회수 생략으로 결정한 출고지입니다.');
    expect(open).not.toContain('TEST 김포 회수 확인</button>');
    expect(open).toContain('실제 입고일 <span class="tabular-nums">2026-11-11</span>');
    const closed = renderToStaticMarkup(<ClaimActionPanel {...base} claimType="exchange" stage="completed" collectionComplete collections={collections} />);
    expect(closed).not.toContain('늦은 입고 확인');
  });

  it('레거시 회수 입고 확인은 실제 입고일과 선택 근거(감사 기록)를 받는다', () => {
    const html = renderToStaticMarkup(<ClaimActionPanel {...base} claimType="return" stage="collecting" collectionPolicy="legacy" collectionComplete={false} />);
    expect(html).toMatch(/name="receivedOn"[^>]*type="date"|type="date"[^>]*name="receivedOn"/);
    expect(html).toContain('회수 확인 근거 (선택)');
    expect(html).toMatch(/<textarea[^>]*name="evidence"/);
    expect(html).toContain('적은 근거는 처리 이력(감사 기록)에 남습니다.');
  });

  it('does not call an empty pre-approval collection complete', () => {
    const html = renderToStaticMarkup(<ClaimActionPanel {...base} claimType="return" />);
    expect(html).not.toContain('모든 출고지의 회수를 확인했습니다');
    expect(html).toContain('수거를 승인하면 출고지별');
  });
});
