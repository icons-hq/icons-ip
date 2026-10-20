import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClaimActionPanel, type ClaimActionPanelProps } from './ClaimActionPanel';
vi.mock('@/app/admin/claim-actions', () => ({ decideOrderClaimAction: vi.fn(), recordOrderClaimCollectionAction: vi.fn(), recordOrderClaimRefundAction: vi.fn(), recordOrderClaimReshipmentAction: vi.fn() }));
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
  it('does not call an empty pre-approval collection complete', () => {
    const html = renderToStaticMarkup(<ClaimActionPanel {...base} claimType="return" />);
    expect(html).not.toContain('모든 출고지의 회수를 확인했습니다');
    expect(html).toContain('수거를 승인하면 출고지별');
  });
});
