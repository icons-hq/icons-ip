export const PAYMENT_OUTCOMES = [
  'approved',
  'declined',
  'canceled',
  'unknown',
  'needs_review',
] as const;

export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];
export type PaymentProvider = 'toss' | 'korpay';
export type PaymentPurpose = 'order' | 'ticket' | 'prize_sale';

export interface PaymentAttempt {
  readonly id: string;
  readonly provider: PaymentProvider;
  readonly purpose: PaymentPurpose;
  readonly refId: string;
  readonly amount: number;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly providerOrderId: string;
  readonly providerProductCode: string;
  readonly expiresAt: string;
}

export type CheckoutAction =
  | {
      readonly kind: 'form_post';
      readonly url: string;
      readonly fields: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: 'redirect';
      readonly url: string;
    }
  | {
      readonly kind: 'client_sdk';
      readonly payload: Readonly<Record<string, string | number | boolean>>;
    };

export interface PreparedCheckout {
  readonly attemptId: string;
  readonly provider: PaymentProvider;
  readonly action: CheckoutAction;
  readonly expiresAt: string;
}

export interface PaymentReturnInput {
  readonly attempt: PaymentAttempt;
  readonly idempotencyKey: string;
  readonly providerOrderId: string;
  readonly callbackNonce: string;
  readonly providerPayload: unknown;
}

export interface PaymentProviderEvidence {
  readonly providerPaymentKey?: string;
  readonly providerTransactionId?: string;
  readonly providerApprovalReference?: string;
  readonly resultCode?: string;
  readonly paymentMethod?: string;
  readonly maskedPaymentMethod?: string;
  readonly approvedAt?: string;
}

export interface PaymentOperationOutcome {
  readonly attemptId: string;
  readonly provider: PaymentProvider;
  readonly outcome: PaymentOutcome;
  readonly reasonCode?: string;
  readonly evidence?: PaymentProviderEvidence;
}

export type ConfirmOutcome = PaymentOperationOutcome;
export type ReconcileOutcome = PaymentOperationOutcome;

export interface PaymentRefundRequest {
  readonly attempt: PaymentAttempt;
  readonly idempotencyKey: string;
  readonly amount: number;
  readonly reason: string;
}

export interface RefundOutcome extends PaymentOperationOutcome {
  readonly refundedAmount?: number;
}

export interface PaymentGateway {
  prepare(attempt: PaymentAttempt): Promise<PreparedCheckout>;
  confirm(returnInput: PaymentReturnInput): Promise<ConfirmOutcome>;
  reconcile(attempt: PaymentAttempt): Promise<ReconcileOutcome>;
  refund(request: PaymentRefundRequest): Promise<RefundOutcome>;
}
