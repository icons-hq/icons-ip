import type {
  ConfirmOutcome,
  PaymentAttempt,
  PaymentGateway,
  PaymentRefundRequest,
  PaymentReturnInput,
  PreparedCheckout,
  ReconcileOutcome,
  RefundOutcome,
} from './gateway';

type IdempotentOperation = 'prepare' | 'confirm' | 'refund';

interface ReplayEntry<T> {
  readonly fingerprint: string;
  readonly result: T;
}

export interface FakePaymentGatewayScript {
  readonly prepare?: readonly PreparedCheckout[];
  readonly confirm?: readonly ConfirmOutcome[];
  readonly reconcile?: readonly ReconcileOutcome[];
  readonly refund?: readonly RefundOutcome[];
}

export class PaymentGatewayIdempotencyConflictError extends Error {
  constructor(operation: IdempotentOperation, idempotencyKey: string) {
    super(`Payment gateway ${operation} idempotency conflict: ${idempotencyKey}`);
    this.name = 'PaymentGatewayIdempotencyConflictError';
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { number: String(value) };
    return value;
  }
  if (typeof value === 'bigint') return { bigint: value.toString() };
  if (typeof value === 'undefined') return { undefined: true };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return { date: value.toISOString() };
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, canonicalize(entryValue)]);
    return Object.fromEntries(entries);
  }
  return { unsupported: typeof value };
}

function fingerprint(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Provider network calls are a system boundary. This deterministic adapter lets
 * checkout modules exercise that public boundary without provider credentials.
 * Idempotent operations replay their first result and reject key reuse with a
 * different request; reconcile intentionally consumes successive observations.
 */
export class FakePaymentGateway implements PaymentGateway {
  private readonly prepareResults: PreparedCheckout[];
  private readonly confirmResults: ConfirmOutcome[];
  private readonly reconcileResults: ReconcileOutcome[];
  private readonly refundResults: RefundOutcome[];
  private readonly replayEntries = new Map<string, ReplayEntry<unknown>>();

  constructor(script: FakePaymentGatewayScript = {}) {
    this.prepareResults = [...(script.prepare ?? [])];
    this.confirmResults = [...(script.confirm ?? [])];
    this.reconcileResults = [...(script.reconcile ?? [])];
    this.refundResults = [...(script.refund ?? [])];
  }

  async prepare(attempt: PaymentAttempt): Promise<PreparedCheckout> {
    return this.replay('prepare', attempt.idempotencyKey, attempt, () => (
      this.takeNext(this.prepareResults, 'prepare')
    ));
  }

  async confirm(returnInput: PaymentReturnInput): Promise<ConfirmOutcome> {
    return this.replay('confirm', returnInput.idempotencyKey, returnInput, () => (
      this.takeNext(this.confirmResults, 'confirm')
    ));
  }

  async reconcile(attempt: PaymentAttempt): Promise<ReconcileOutcome> {
    void attempt;
    return this.takeNext(this.reconcileResults, 'reconcile');
  }

  async refund(request: PaymentRefundRequest): Promise<RefundOutcome> {
    return this.replay('refund', request.idempotencyKey, request, () => (
      this.takeNext(this.refundResults, 'refund')
    ));
  }

  private replay<T>(
    operation: IdempotentOperation,
    idempotencyKey: string,
    input: unknown,
    produce: () => T,
  ): T {
    const cacheKey = `${operation}:${idempotencyKey}`;
    const inputFingerprint = fingerprint(input);
    const existing = this.replayEntries.get(cacheKey) as ReplayEntry<T> | undefined;
    if (existing) {
      if (existing.fingerprint !== inputFingerprint) {
        throw new PaymentGatewayIdempotencyConflictError(operation, idempotencyKey);
      }
      return existing.result;
    }

    const result = produce();
    this.replayEntries.set(cacheKey, { fingerprint: inputFingerprint, result });
    return result;
  }

  private takeNext<T>(queue: T[], operation: string): T {
    const result = queue.shift();
    if (result === undefined) {
      throw new Error(`Fake payment gateway has no scripted ${operation} result`);
    }
    return result;
  }
}
