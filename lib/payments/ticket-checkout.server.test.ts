import { describe, expect, it } from 'vitest';
import type { ConfirmOutcome, RefundOutcome } from './gateway';
import { createTicketPaymentAttemptRepository } from './ticket-checkout.server';

const ATTEMPT_ID = '30000000-0000-4000-8000-000000000206';
const ORDER_ID = '20000000-0000-4000-8000-000000000206';
const REQUEST_ID = '40000000-0000-4000-8000-000000000206';
const USER_ID = '00000000-0000-4000-8000-000000000206';
const CLAIM_TOKEN = '50000000-0000-4000-8000-000000000206';

const attemptRow = {
  id: ATTEMPT_ID,
  provider: 'korpay',
  purpose: 'ticket',
  ref_id: ORDER_ID,
  amount: 44_000,
  currency: 'KRW',
  idempotency_key: `ticket:${ORDER_ID}`,
  provider_order_id: 'T30000000000040008000000000000206',
  provider_product_code: 'P30000000000040008000000000000206',
  expires_at: '2099-08-13T10:10:00.000Z',
};

function client(results: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({ data: results[name], error: null });
    },
  };
}

describe('TicketPaymentAttemptRepository', () => {
  it('티켓 attempt 준비와 callback claim을 전용 RPC에만 위임한다', async () => {
    const rpc = client({
      prepare_ticket_payment_attempt: attemptRow,
      bind_ticket_payment_callback_nonce: null,
      claim_ticket_payment_attempt: { claim_status: 'claimed', attempt: attemptRow },
    });
    const repository = createTicketPaymentAttemptRepository(rpc);

    await expect(repository.prepareTicketAttempt({
      userId: USER_ID,
      ticketOrderId: ORDER_ID,
      provider: 'korpay',
    })).resolves.toMatchObject({ id: ATTEMPT_ID, purpose: 'ticket', refId: ORDER_ID });
    await repository.bindCallbackNonce({ attemptId: ATTEMPT_ID, callbackNonceDigest: 'a'.repeat(64) });
    await expect(repository.claimTicketAttempt({
      provider: 'korpay',
      providerOrderId: attemptRow.provider_order_id,
      callbackNonceDigest: 'a'.repeat(64),
      claimToken: CLAIM_TOKEN,
    })).resolves.toMatchObject({ status: 'claimed', claimToken: CLAIM_TOKEN });

    expect(rpc.calls.map((call) => call.name)).toEqual([
      'prepare_ticket_payment_attempt',
      'bind_ticket_payment_callback_nonce',
      'claim_ticket_payment_attempt',
    ]);
  });

  it('승인 evidence allowlist만 finalization RPC로 전달한다', async () => {
    const rpc = client({ finalize_ticket_payment_attempt: 'approved' });
    const repository = createTicketPaymentAttemptRepository(rpc);
    const outcome: ConfirmOutcome = {
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'approved',
      evidence: {
        providerTransactionId: 'tid-206',
        maskedPaymentMethod: '1234-****-****-5678',
        approvedAt: '2025-12-11T06:11:01.000Z',
        resultCode: '3001',
      },
    };

    await expect(repository.finalizeTicketAttempt({
      attemptId: ATTEMPT_ID,
      claimToken: CLAIM_TOKEN,
      outcome,
    })).resolves.toEqual(outcome);
    expect(rpc.calls[0]).toEqual({
      name: 'finalize_ticket_payment_attempt',
      args: expect.objectContaining({
        p_attempt_id: ATTEMPT_ID,
        p_claim_token: CLAIM_TOKEN,
        p_outcome: 'approved',
        p_provider_transaction_id: 'tid-206',
        p_masked_payment_method: '1234-****-****-5678',
        p_approved_at: '2025-12-11T06:11:01.000Z',
        p_result_code: '3001',
      }),
    });
    expect(JSON.stringify(rpc.calls[0])).not.toContain('raw');
  });

  it('모호 결제 reconciliation은 전용 claim/finalization RPC와 allowlist만 사용한다', async () => {
    const rpc = client({
      claim_ticket_payment_reconciliation: { claim_status: 'claimed', attempt: attemptRow },
      finalize_ticket_payment_reconciliation: 'approved',
    });
    const repository = createTicketPaymentAttemptRepository(rpc);

    await expect(repository.claimTicketReconciliation({
      attemptId: ATTEMPT_ID,
      claimToken: CLAIM_TOKEN,
      caseRef: 'case_ticket_opaque_206',
    })).resolves.toMatchObject({ status: 'claimed', claimToken: CLAIM_TOKEN });

    expect(rpc.calls[0].args).toMatchObject({
      p_case_ref: 'case_ticket_opaque_206',
    });

    await repository.finalizeTicketReconciliation({
      attemptId: ATTEMPT_ID,
      claimToken: CLAIM_TOKEN,
      outcome: {
        attemptId: ATTEMPT_ID,
        provider: 'korpay',
        outcome: 'approved',
        evidence: { providerTransactionId: 'reconcile-tid-206' },
      },
    });

    expect(rpc.calls.map((call) => call.name)).toEqual([
      'claim_ticket_payment_reconciliation',
      'finalize_ticket_payment_reconciliation',
    ]);
    expect(rpc.calls[1].args).toMatchObject({
      p_provider_transaction_id: 'reconcile-tid-206',
    });
    expect(JSON.stringify(rpc.calls)).not.toContain('raw');
  });

  it('legacy와 Korpay 환급 claim을 구분하고 전액 결과를 멱등 finalization한다', async () => {
    const rpc = client({
      claim_ticket_payment_refund: { claim_status: 'claimed', attempt: attemptRow },
      finalize_ticket_payment_refund: 'approved',
    });
    const repository = createTicketPaymentAttemptRepository(rpc);
    await expect(repository.claimTicketRefund({
      requestId: REQUEST_ID,
      userId: USER_ID,
      claimToken: CLAIM_TOKEN,
    })).resolves.toMatchObject({ status: 'claimed', claimToken: CLAIM_TOKEN });

    const outcome: RefundOutcome = {
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'approved',
      refundedAmount: 44_000,
      evidence: { providerTransactionId: 'refund-tid-206' },
    };
    await expect(repository.finalizeTicketRefund({
      requestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      claimToken: CLAIM_TOKEN,
      outcome,
    })).resolves.toEqual(outcome);
    expect(rpc.calls[1].args).toMatchObject({
      p_request_id: REQUEST_ID,
      p_refunded_amount: 44_000,
      p_provider_transaction_id: 'refund-tid-206',
    });

    const legacy = client({ claim_ticket_payment_refund: { claim_status: 'legacy' } });
    await expect(createTicketPaymentAttemptRepository(legacy).claimTicketRefund({
      requestId: REQUEST_ID,
      userId: USER_ID,
      claimToken: CLAIM_TOKEN,
    })).resolves.toEqual({ status: 'legacy' });
  });

  it('refund reconciliation은 결제 reconciliation과 별도 request claim/finalizer를 사용한다', async () => {
    const rpc = client({
      claim_ticket_refund_reconciliation: { claim_status: 'claimed', attempt: attemptRow },
      finalize_ticket_refund_reconciliation: 'approved',
    });
    const repository = createTicketPaymentAttemptRepository(rpc);

    await expect(repository.claimTicketRefundReconciliation({
      requestId: REQUEST_ID,
      claimToken: CLAIM_TOKEN,
      caseRef: 'case_refund_opaque_206',
    })).resolves.toMatchObject({ status: 'claimed', claimToken: CLAIM_TOKEN });

    expect(rpc.calls[0].args).toMatchObject({
      p_case_ref: 'case_refund_opaque_206',
    });

    await repository.finalizeTicketRefundReconciliation({
      requestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      claimToken: CLAIM_TOKEN,
      outcome: {
        attemptId: ATTEMPT_ID,
        provider: 'korpay',
        outcome: 'approved',
        refundedAmount: 44_000,
      },
    });

    expect(rpc.calls.map((call) => call.name)).toEqual([
      'claim_ticket_refund_reconciliation',
      'finalize_ticket_refund_reconciliation',
    ]);
  });

  it('DB guard가 outcome을 낮추면 승인으로 가장하지 않는다', async () => {
    const rpc = client({ finalize_ticket_payment_attempt: 'needs_review' });
    const repository = createTicketPaymentAttemptRepository(rpc);
    await expect(repository.finalizeTicketAttempt({
      attemptId: ATTEMPT_ID,
      claimToken: CLAIM_TOKEN,
      outcome: { attemptId: ATTEMPT_ID, provider: 'korpay', outcome: 'approved' },
    })).resolves.toMatchObject({
      outcome: 'needs_review',
      reasonCode: 'database_finalization_guard',
    });
  });
});
