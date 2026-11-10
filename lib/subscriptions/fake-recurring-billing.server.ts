import 'server-only';

import { createHash } from 'node:crypto';
import { isUuid } from '../uuid';
import type { PaymentOperationOutcome } from '../payments/gateway';
import {
  assertBoundBillingAttempt, billingOpaque, billingOutcome, billingProfileMatches, billingProfileValid,
  billingWriteRecoverable, type BillingProfileIdentity, type BoundBillingAttempt, type RecurringBilling,
} from './billing-types.server';

/** 합성 provider 원장에는 키·authKey·고객 원문 대신 purpose-separated hash만 전달한다. */
export interface FakeBillingCommand {
  readonly kind: 'register' | 'charge' | 'inspect' | 'refund' | 'revoke';
  readonly profileId: string;
  readonly operationRef?: string;
  readonly payloadHash?: string;
  readonly credentialRef?: string;
  readonly customerRef?: string;
  readonly orderRef?: string;
  readonly attemptId?: string;
  readonly amount?: number;
  readonly at: string;
  readonly decline?: boolean;
}
export interface FakeBillingReceipt {
  readonly state: 'registered' | 'approved' | 'declined' | 'canceled' | 'revoked' | 'not_found' | 'conflict';
  readonly attemptId?: string;
  readonly amount?: number;
  readonly paymentKey?: string;
  readonly transactionId?: string;
  readonly at: string;
}
export interface FakeBillingLedger {
  /** 로컬 DB Adapter도 이 단일 원자적 command를 구현하여 프로세스 재시작을 재현할 수 있다. */
  execute(command: FakeBillingCommand): Promise<FakeBillingReceipt>;
}

export function createMemoryFakeBillingLedger(): FakeBillingLedger {
  const credentials = new Map<string, { customerRef: string; revoked: boolean }>();
  const operations = new Map<string, { hash: string; receipt: FakeBillingReceipt }>();
  const payments = new Map<string, FakeBillingReceipt>();
  return {
    async execute(command) {
      const result = (state: FakeBillingReceipt['state']): FakeBillingReceipt => ({ state, at: command.at });
      const scoped = (reference: string) => `${command.profileId}:${reference}`;
      if (command.kind === 'inspect') return payments.get(scoped(command.orderRef ?? '')) ?? result('not_found');
      if (command.kind === 'revoke') {
        const found = credentials.get(scoped(command.credentialRef ?? ''));
        if (!found) return result('not_found');
        found.revoked = true; return result('revoked');
      }
      if (!command.operationRef || !command.payloadHash) return result('conflict');
      const operationKey = scoped(command.operationRef); const existing = operations.get(operationKey);
      if (existing) return existing.hash === command.payloadHash ? { ...existing.receipt } : result('conflict');
      const remember = (receipt: FakeBillingReceipt): FakeBillingReceipt => {
        operations.set(operationKey, { hash: command.payloadHash!, receipt }); return { ...receipt };
      };
      if (command.kind === 'register') {
        if (!command.credentialRef || !command.customerRef) return result('conflict');
        const key = scoped(command.credentialRef); const current = credentials.get(key);
        if (current && current.customerRef !== command.customerRef) return result('conflict');
        if (current?.revoked) return result('conflict');
        credentials.set(key, { customerRef: command.customerRef, revoked: false });
        return remember(result('registered'));
      }
      if (!command.orderRef || !command.attemptId || !Number.isSafeInteger(command.amount) || command.amount! < 100) return result('conflict');
      const paymentKey = scoped(command.orderRef);
      if (command.kind === 'charge') {
        const credential = credentials.get(scoped(command.credentialRef ?? ''));
        if (!credential || credential.revoked || credential.customerRef !== command.customerRef) return remember(result('declined'));
        // 같은 provider orderId를 새 key/version으로 보내도 두 번째 결제는 만들지 않는다.
        if (payments.has(paymentKey)) return result('conflict');
        const receipt: FakeBillingReceipt = { state: command.decline ? 'declined' : 'approved', attemptId: command.attemptId,
          amount: command.amount, paymentKey: `fake_payment_${command.attemptId.replaceAll('-', '')}`,
          transactionId: `fake_approval_${command.attemptId.replaceAll('-', '')}`, at: command.at };
        payments.set(paymentKey, receipt); return remember(receipt);
      }
      const payment = payments.get(paymentKey);
      if (!payment || payment.attemptId !== command.attemptId || payment.amount !== command.amount) return result('not_found');
      if (payment.state === 'canceled') return remember(payment);
      if (payment.state !== 'approved') return result('conflict');
      const receipt: FakeBillingReceipt = { ...payment, state: 'canceled', transactionId: `fake_cancel_${command.attemptId.replaceAll('-', '')}`, at: command.at };
      payments.set(paymentKey, receipt); return remember(receipt);
    },
  };
}

const digest = (purpose: string, value: unknown): string => createHash('sha256').update(JSON.stringify([`icons:fake-billing:${purpose}`, value])).digest('hex');
const MASK = '43301234****123*';
export type FakeBillingScenario = 'approved' | 'declined' | 'timeout_before_charge' | 'timeout_after_charge';

/** 명시적으로 주입하는 테스트 Adapter. 실제 API·카드·상점 키에 접근하지 않는다. */
export function createFakeRecurringBilling(options: {
  readonly identity: BillingProfileIdentity;
  readonly ledger?: FakeBillingLedger;
  readonly now?: () => Date;
  readonly scenario?: (attemptId: string) => FakeBillingScenario;
}): RecurringBilling {
  if (!billingProfileValid(options.identity) || options.identity.environment !== 'test') throw new Error('invalid_fake_billing_profile');
  const ledger = options.ledger ?? createMemoryFakeBillingLedger(); const now = options.now ?? (() => new Date());
  const identityValid = (identity: BillingProfileIdentity) => billingProfileMatches(identity, options.identity);
  const orderRef = (bound: BoundBillingAttempt) => digest('order', bound.attempt.providerOrderId);
  function outcome(bound: BoundBillingAttempt, receipt: FakeBillingReceipt): PaymentOperationOutcome {
    if (receipt.state === 'not_found') return billingOutcome(bound.attempt, 'unknown', 'billing_inquiry_not_found');
    if (receipt.state === 'declined') return billingOutcome(bound.attempt, 'declined', 'billing_declined');
    if (!['approved', 'canceled'].includes(receipt.state) || receipt.attemptId !== bound.attempt.id || receipt.amount !== bound.attempt.amount
      || !receipt.paymentKey || (bound.binding.providerPaymentKey !== null && receipt.paymentKey !== bound.binding.providerPaymentKey)) {
      return billingOutcome(bound.attempt, 'needs_review', 'billing_identity_mismatch');
    }
    return billingOutcome(bound.attempt, receipt.state === 'approved' ? 'approved' : 'canceled',
      receipt.state === 'approved' ? 'billing_approved' : 'billing_fully_canceled', {
        providerPaymentKey: receipt.paymentKey, providerTransactionId: receipt.transactionId,
        ...(receipt.state === 'approved' ? { providerApprovalReference: '12345678', maskedPaymentMethod: MASK } : {}),
        paymentMethod: '카드', resultCode: receipt.state === 'approved' ? 'DONE' : 'CANCELED', approvedAt: receipt.at });
  }
  async function inspect(input: BoundBillingAttempt) {
    assertBoundBillingAttempt(input);
    if (!identityValid(input.binding)) return billingOutcome(input.attempt, 'needs_review', 'billing_profile_unavailable');
    return outcome(input, await ledger.execute({ kind: 'inspect', profileId: options.identity.profileId, orderRef: orderRef(input), at: now().toISOString() }));
  }
  return {
    async register(input) {
      if (!identityValid(input) || !isUuid(input.customerKey) || !/^fake_auth_[A-Za-z0-9_-]{1,200}$/.test(input.authKey)
        || !billingOpaque(input.idempotencyKey, 300) || !billingWriteRecoverable(input.firstDispatchedAt, now())) {
        return { state: 'needs_review', reasonCode: 'billing_registration_request_invalid' };
      }
      const billingKey = `fake_billing_${digest('credential', [input.profileId, input.customerKey, input.authKey])}`;
      const receipt = await ledger.execute({ kind: 'register', profileId: input.profileId, at: now().toISOString(),
        operationRef: digest('register-operation', [input.writeKeyVersion, input.idempotencyKey]),
        payloadHash: digest('register-payload', [input.customerKey, input.authKey]),
        credentialRef: digest('credential-ref', billingKey), customerRef: digest('customer', input.customerKey) });
      return receipt.state === 'registered'
        ? { state: 'ready', billingKey, card: { issuerCode: '61', number: MASK }, authenticatedAt: receipt.at }
        : { state: 'needs_review', reasonCode: 'billing_registration_evidence_invalid' };
    },
    async charge(input) {
      assertBoundBillingAttempt(input);
      if (!identityValid(input.binding) || !/^fake_billing_[0-9a-f]{64}$/.test(input.billingKey) || !isUuid(input.customerKey)
        || !billingWriteRecoverable(input.binding.firstDispatchedAt, now())) return billingOutcome(input.attempt, 'needs_review', 'billing_charge_request_invalid');
      const scenario = options.scenario?.(input.attempt.id) ?? 'approved';
      if (scenario === 'timeout_before_charge') return billingOutcome(input.attempt, 'unknown', 'billing_charge_unavailable');
      const receipt = await ledger.execute({ kind: 'charge', profileId: input.binding.profileId, at: now().toISOString(),
        operationRef: digest('charge-operation', [input.binding.writeKeyVersion, input.attempt.idempotencyKey, digest('credential-ref', input.billingKey)]),
        payloadHash: digest('charge-payload', [input.attempt.providerOrderId, input.attempt.amount, input.customerKey]),
        orderRef: orderRef(input), attemptId: input.attempt.id, amount: input.attempt.amount, decline: scenario === 'declined',
        credentialRef: digest('credential-ref', input.billingKey), customerRef: digest('customer', input.customerKey) });
      return scenario === 'timeout_after_charge'
        ? billingOutcome(input.attempt, 'unknown', 'billing_charge_unavailable') : outcome(input, receipt);
    },
    inspect,
    async refund(input) {
      assertBoundBillingAttempt(input);
      if (!identityValid(input.binding) || input.amount !== input.attempt.amount || !billingOpaque(input.idempotencyKey, 300)) {
        return billingOutcome(input.attempt, 'needs_review', 'billing_refund_request_invalid');
      }
      const before = await inspect(input);
      if (before.outcome === 'canceled') return { ...before, outcome: 'approved', refundedAmount: input.amount };
      if (before.outcome !== 'approved') return before;
      if (!billingWriteRecoverable(input.firstDispatchedAt, now())) return billingOutcome(input.attempt, 'needs_review', 'billing_refund_write_unavailable');
      await ledger.execute({ kind: 'refund', profileId: input.binding.profileId, at: now().toISOString(),
        operationRef: digest('refund-operation', [input.writeKeyVersion, input.idempotencyKey]), payloadHash: digest('refund-payload', [input.attempt.providerOrderId, input.amount, input.reason]),
        orderRef: orderRef(input), attemptId: input.attempt.id, amount: input.amount });
      const after = await inspect(input);
      return after.outcome === 'canceled' ? { ...after, outcome: 'approved', refundedAmount: input.amount }
        : billingOutcome(input.attempt, 'unknown', 'billing_refund_unsettled');
    },
    async revoke(input) {
      if (!identityValid(input) || !/^fake_billing_[0-9a-f]{64}$/.test(input.billingKey)) {
        return { state: 'needs_review', reasonCode: 'billing_revoke_request_invalid' };
      }
      const receipt = await ledger.execute({ kind: 'revoke', profileId: input.profileId, at: now().toISOString(), credentialRef: digest('credential-ref', input.billingKey) });
      return receipt.state === 'revoked' ? { state: 'revoked', reasonCode: 'billing_revoked' }
        : { state: 'unknown', reasonCode: 'billing_revoke_unsettled' };
    },
  };
}
