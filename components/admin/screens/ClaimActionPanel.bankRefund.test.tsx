import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClaimActionPanel, type ClaimActionPanelProps } from './ClaimActionPanel';

vi.mock('@/app/admin/claim-actions', () => ({
  decideOrderClaimAction: vi.fn(),
  recordOrderClaimCollectionAction: vi.fn(),
  recordOrderClaimOriginCollectionAction: vi.fn(),
  recordOrderClaimRefundAction: vi.fn(),
  readOrderClaimApprovalAmountAction: vi.fn(),
  planClaimDefectiveStockAction: vi.fn(),
  planExchangeDefectiveStockAction: vi.fn(),
  retryClaimDefectiveStockAction: vi.fn(),
}));
vi.mock('@/app/admin/claim-bulk-step-actions', () => ({
  previewOrderClaimBulkStepAction: vi.fn(), runOrderClaimBulkCollectionsAction: vi.fn(), runOrderClaimBulkRefundsAction: vi.fn(),
}));
/* 무통장 환불 칸은 클라이언트에서 환불 상태를 읽는다. 이 시험은 패널이 칸에 요청의 단계를 넘기는지만 본다. */
vi.mock('@/components/admin/BankTransferRefund', () => ({
  BankTransferRefund: (props: { stage?: string }) => <i data-bank-refund-stage={props.stage ?? ''} />,
}));

/* R-N2: 같은 화면에서 요청을 승인하면 단계가 바뀐다 — 무통장 환불 칸이 그 단계를 받아야 승인 전 상태로 남지 않고 다시 읽는다. */
const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
function render(overrides: Partial<ClaimActionPanelProps> = {}) {
  return renderToStaticMarkup(<ClaimActionPanel {...{
    cancellationForm: null, claimId: CLAIM_ID, claimType: 'cancel', collectionComplete: true, collectionPolicy: 'legacy', collections: [], heldFrom: null,
    orderId: ORDER_ID, paymentProvider: 'bank_transfer', recordedRefundMethod: null, refundCompleted: false, refundFiled: false, refundLedgerOpen: false,
    stage: 'requested', bankTransfer: true, actorId: 'staff-1', ...overrides,
  } as ClaimActionPanelProps} />);
}

describe('ClaimActionPanel — 무통장 환불 칸에 넘기는 단계', () => {
  it('요청의 지금 단계를 무통장 환불 칸에 넘긴다', () => {
    expect(render({ stage: 'requested' })).toContain('data-bank-refund-stage="requested"');
    expect(render({ stage: 'processing' })).toContain('data-bank-refund-stage="processing"');
  });

  it('철회된 요청이나 무통장이 아닌 결제에는 칸을 그리지 않는다', () => {
    expect(render({ stage: 'withdrawn' })).not.toContain('data-bank-refund-stage');
    expect(render({ bankTransfer: false, paymentProvider: 'toss' })).not.toContain('data-bank-refund-stage');
  });
});
